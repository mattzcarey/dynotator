import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { describe, expect, test } from "vite-plus/test";
import { parseAccessConfig, verifyAccess } from "./access";

const ISSUER = "https://acme.cloudflareaccess.com";
const AUD = "aud-of-this-application";
const config = { kind: "on", issuer: ISSUER, audiences: [AUD] } as const;

const team = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(team.publicKey)), kid: "k1" }] });

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string | string[];
  expires?: string;
  key?: CryptoKey;
}

async function request({
  claims = { email: "reviewer@example.com" },
  issuer = ISSUER,
  audience = AUD,
  expires = "5m",
  key = team.privateKey,
}: TokenOptions = {}): Promise<Request> {
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
  return new Request("https://review.example.com/mcp", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

describe("parseAccessConfig", () => {
  test("is off when nothing is set", () => {
    expect(parseAccessConfig({})).toEqual({ kind: "off" });
    expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: " ", ACCESS_AUD: "" })).toEqual({ kind: "off" });
  });

  test("accepts the team as a name, a hostname or a URL", () => {
    for (const name of ["acme", "acme.cloudflareaccess.com", `${ISSUER}/`]) {
      expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: name, ACCESS_AUD: AUD })).toEqual(config);
    }
  });

  test("takes several audiences", () => {
    expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: "acme", ACCESS_AUD: "a, b ,," })).toEqual({
      kind: "on",
      issuer: ISSUER,
      audiences: ["a", "b"],
    });
  });

  test("refuses half a configuration", () => {
    expect(parseAccessConfig({ ACCESS_TEAM_DOMAIN: "acme" }).kind).toBe("invalid");
    expect(parseAccessConfig({ ACCESS_AUD: AUD }).kind).toBe("invalid");
  });
});

describe("verifyAccess", () => {
  test("accepts a token from the team for this application and reports the email", async () => {
    expect(await verifyAccess(await request(), config, keys)).toEqual({
      ok: true,
      aud: AUD,
      email: "reviewer@example.com",
    });
  });

  test("accepts a service token, which has no email", async () => {
    const serviceToken = await request({ claims: { common_name: "ci.access" } });
    expect(await verifyAccess(serviceToken, config, keys)).toEqual({ ok: true, aud: AUD });
  });

  test("accepts a token issued for any of several audiences", async () => {
    const both = { ...config, audiences: ["other", AUD] };
    expect(await verifyAccess(await request({ audience: [AUD, "x"] }), both, keys)).toMatchObject({
      ok: true,
      aud: AUD,
    });
  });

  test("refuses a request with no token", async () => {
    const bare = new Request("https://review.example.com/mcp");
    expect(await verifyAccess(bare, config, keys)).toMatchObject({ ok: false });
  });

  test.each([
    ["another application's token", { audience: "another-application" }],
    ["another team's token", { issuer: "https://evil.cloudflareaccess.com" }],
    ["an expired token", { expires: "-1m" }],
    ["a token signed by someone else", { key: stranger.privateKey }],
  ])("refuses %s", async (_name, options) => {
    expect(await verifyAccess(await request(options), config, keys)).toMatchObject({ ok: false });
  });

  test("refuses a token whose email claim was edited", async () => {
    const original = await request();
    const [header, payload, signature] = (
      original.headers.get("Cf-Access-Jwt-Assertion") ?? ""
    ).split(".");
    const claims = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    const edited = btoa(JSON.stringify({ ...claims, email: "admin@example.com" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const forged = new Request(original.url, {
      headers: { "Cf-Access-Jwt-Assertion": `${header}.${edited}.${signature}` },
    });
    expect(await verifyAccess(forged, config, keys)).toMatchObject({ ok: false });
  });
});
