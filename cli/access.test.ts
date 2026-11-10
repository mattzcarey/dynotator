import { expect, test } from "bun:test";
import { accessFetch } from "./access.ts";

const challenge = () =>
  new Response(null, {
    status: 302,
    headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/app" },
  });

function server(validToken: () => string) {
  const seen: (string | null)[] = [];
  const fetch = async (_input: string, init?: RequestInit) => {
    const token = new Headers(init?.headers).get("cf-access-token");
    seen.push(token);
    return token === validToken() ? Response.json({ ok: true }) : challenge();
  };
  return { fetch, seen };
}

test("an open server is never asked to sign in", async () => {
  let logins = 0;
  const fetch = accessFetch(
    async () => Response.json({ ok: true }),
    async () => `t${++logins}`,
  );
  expect((await fetch("https://d.example/api/sessions")).status).toBe(200);
  expect(logins).toBe(0);
});

test("signs in once on the Access redirect and reuses the token", async () => {
  let logins = 0;
  const { fetch: inner, seen } = server(() => "jwt1");
  const fetch = accessFetch(inner, async (origin) => {
    expect(origin).toBe("https://d.example");
    return `jwt${++logins}`;
  });
  expect((await fetch("https://d.example/api/sessions", { method: "POST" })).status).toBe(200);
  expect((await fetch("https://d.example/s/x/api/wait")).status).toBe(200);
  expect(logins).toBe(1);
  expect(seen).toEqual([null, "jwt1", "jwt1"]);
});

test("refreshes an expired token, and fails when the policy refuses the user", async () => {
  let valid = "jwt1";
  let logins = 0;
  const { fetch: inner } = server(() => valid);
  const fetch = accessFetch(inner, async () => `jwt${++logins}`);
  await fetch("https://d.example/a");
  valid = "jwt2";
  expect((await fetch("https://d.example/a")).status).toBe(200);
  expect(logins).toBe(2);
  valid = "never";
  expect(fetch("https://d.example/a")).rejects.toThrow("not allowed by the policy");
});

test("a redirect that is not Access is passed through", async () => {
  const fetch = accessFetch(
    async () =>
      new Response(null, { status: 302, headers: { location: "https://other.example/" } }),
    async () => {
      throw new Error("must not sign in");
    },
  );
  expect((await fetch("https://d.example/a")).status).toBe(302);
});
