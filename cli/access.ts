import { execFile } from "node:child_process";
import type { Fetch } from "./http.ts";

/** Returns a Cloudflare Access JWT for the app at `origin`, signing the user in if needed. */
export type AccessLogin = (origin: string) => Promise<string>;

function cloudflared(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("cloudflared", args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

const looksLikeJwt = (text: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(text);

// The identity is the user's own Access session, kept by cloudflared. Dynotator never stores or
// is configured with a credential.
export const cloudflaredLogin: AccessLogin = async (origin) => {
  try {
    const cached = await cloudflared(["access", "token", `-app=${origin}`]).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      return "";
    });
    if (looksLikeJwt(cached)) return cached;
    // Opens the browser for the Access sign-in and waits for it to finish.
    await cloudflared(["access", "login", origin]);
    const token = await cloudflared(["access", "token", `-app=${origin}`]);
    if (looksLikeJwt(token)) return token;
    throw new Error("cloudflared returned no token");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? `${origin} is behind Cloudflare Access; install cloudflared so the CLI can sign in`
        : `Cloudflare Access sign-in for ${origin} failed: ${(error as Error).message}`,
      { cause: error },
    );
  }
};

function isAccessChallenge(res: Response): boolean {
  if (res.status < 300 || res.status >= 400) return false;
  try {
    return new URL(res.headers.get("location") ?? "").hostname.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}

/**
 * Wraps fetch for a server that may sit behind Cloudflare Access. Requests go out as they are;
 * when Access answers with its sign-in redirect, the user's Access token is fetched once and the
 * request is retried with it. An expired token is refreshed the same way.
 */
export function accessFetch(inner: Fetch, login: AccessLogin = cloudflaredLogin): Fetch {
  let token: string | undefined;
  return async (input, init) => {
    const send = () => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("cf-access-token", token);
      return inner(input, { ...init, headers, redirect: "manual" });
    };
    const first = await send();
    if (!isAccessChallenge(first)) return first;
    token = await login(new URL(input).origin);
    const second = await send();
    if (isAccessChallenge(second)) {
      throw new Error(
        "Cloudflare Access rejected the request: your account is not allowed by the policy",
      );
    }
    return second;
  };
}
