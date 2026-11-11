import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

/** The Worker variables that turn Access validation on. Both, or neither. */
export interface AccessVars {
  /** The Zero Trust team: `acme`, `acme.cloudflareaccess.com` or `https://acme.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. Several, separated by commas, if more than one application fronts the Worker. */
  ACCESS_AUD?: string;
}

/** What the variables say: validation off, on, or set up wrongly. */
export type AccessConfig =
  | { readonly kind: "off" }
  | { readonly kind: "on"; readonly issuer: string; readonly audiences: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Reads the Access settings from the Worker's variables.
 *
 * @param vars - The Worker's environment.
 * @returns `off` when neither variable is set, `on` with the issuer and audiences when both are,
 *   and `invalid` when only one is, so a half-configured deployment fails loudly instead of open.
 */
export function parseAccessConfig(vars: AccessVars): AccessConfig {
  const team = vars.ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audiences = (vars.ACCESS_AUD ?? "")
    .split(",")
    .map((aud) => aud.trim())
    .filter((aud) => aud !== "");
  if (team === "" && audiences.length === 0) return { kind: "off" };
  if (team === "" || audiences.length === 0) {
    return { kind: "invalid", reason: "Set both ACCESS_TEAM_DOMAIN and ACCESS_AUD, or neither." };
  }
  const host = team.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const scheme = team.startsWith("http://") ? "http" : "https";
  const issuer = `${scheme}://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
  return { kind: "on", issuer, audiences };
}

/** A request Access let through, or why this one is refused. */
export type Verified =
  | {
      readonly ok: true;
      /** The audience the token was issued for. */
      readonly aud: string;
      /** The signed-in user's email. Absent for a service token. */
      readonly email?: string;
    }
  | { readonly ok: false; readonly reason: string };

// One key set per issuer for the life of the isolate: jose caches the keys and refetches them
// when a token names a key it has not seen, which is how Access rotates.
const keySets = new Map<string, JWTVerifyGetKey>();

function remoteKeys(issuer: string): JWTVerifyGetKey {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    keySets.set(issuer, keys);
  }
  return keys;
}

/**
 * Checks the token Cloudflare Access attaches to every request it lets through
 * (`Cf-Access-Jwt-Assertion`): signed by the team's keys, issued for one of the audiences, and
 * not expired. A request that reached the Worker some way other than through Access has none.
 *
 * @param request - The incoming request.
 * @param config - The issuer and audiences to accept.
 * @param keys - The team's signing keys. Defaults to the ones Access publishes.
 * @returns The verified audience and email, or the reason the request is refused.
 */
export async function verifyAccess(
  request: Request,
  config: Extract<AccessConfig, { kind: "on" }>,
  keys: JWTVerifyGetKey = remoteKeys(config.issuer),
): Promise<Verified> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, reason: "the request did not come through Cloudflare Access" };
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: [...config.audiences],
      algorithms: ["RS256"],
    });
    const issuedFor = [payload.aud].flat().find((aud) => aud && config.audiences.includes(aud));
    const email = typeof payload.email === "string" && payload.email !== "" ? payload.email : null;
    return { ok: true, aud: issuedFor ?? config.audiences[0], ...(email && { email }) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "the Access token is invalid",
    };
  }
}
