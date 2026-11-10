/**
 * The SPA is served at `/s/<id>` and its API lives at `/s/<id>/api`. Code
 * written against upstream calls `/api/...`; this prefixes the session base.
 * Without a `/s/<id>` path (`vite dev` behind a proxy) paths stay unprefixed.
 */
const SESSION_PATH = /^\/s\/([A-Za-z0-9_-]+)(?:\/|$)/;

export function sessionBase(pathname: string = location.pathname): string {
  const match = SESSION_PATH.exec(pathname);
  return match ? `/s/${match[1]}` : "";
}

/** `/api/...` under the current session's base. */
export function apiUrl(path: string): string {
  return path.startsWith("/api/") || path === "/api" ? `${sessionBase()}${path}` : path;
}

/** Same-origin `/api/` URLs, absolute or relative, rewritten to the session base. */
function rewrite(url: string): string {
  if (url.startsWith("/api/")) return apiUrl(url);
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith("/api/")) return url;
    return `${parsed.origin}${apiUrl(parsed.pathname)}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** Route `fetch` calls to `/api/...` through the session base. */
export function installApiShim(): void {
  if (!sessionBase()) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") return nativeFetch(rewrite(input), init);
    if (input instanceof URL) return nativeFetch(rewrite(input.href), init);
    const next = rewrite(input.url);
    return nativeFetch(next === input.url ? input : new Request(next, input), init);
  };
}
