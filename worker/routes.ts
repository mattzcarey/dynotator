const ID_BYTES = 20;
const ID_PATTERN = /^[A-Za-z0-9_-]{27}$/;

/** A 160-bit, URL-safe session id. Knowing it is the capability for the whole session. */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function isSessionId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export type HostRoute =
  | { kind: "create" }
  | { kind: "page"; id: string }
  | { kind: "session-api"; id: string; path: string }
  | { kind: "api-not-found" }
  | { kind: "page-not-found" }
  | { kind: "asset" };

export function matchRoute(method: string, pathname: string): HostRoute {
  if (pathname === "/api/sessions" && method === "POST") return { kind: "create" };
  if (pathname.startsWith("/api/")) return { kind: "api-not-found" };
  const m = /^\/s\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return { kind: "asset" };
  const rest = m[2] ?? "";
  const api = rest.startsWith("/api/");
  if (!isSessionId(m[1])) return { kind: api ? "api-not-found" : "page-not-found" };
  if (rest === "" || rest === "/") return { kind: "page", id: m[1] };
  if (api) return { kind: "session-api", id: m[1], path: rest };
  return { kind: "asset" };
}

/** Constant-time check of `Authorization: Bearer <token>`. No token configured means open. */
export function isAuthorized(header: string | null, token: string | undefined): boolean {
  if (!token) return true;
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= b[i] ^ (a[i] ?? 0);
  return diff === 0;
}

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function ttlSeconds(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SECONDS;
}
