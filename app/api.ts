/**
 * The SPA is served at `/s/<id>` and the review's API lives under `/s/<id>/api`. Off such a path
 * (a bare `vite` dev server behind a proxy) paths stay as given.
 */
const base = /^\/s\/[A-Za-z0-9_-]+/.exec(location.pathname)?.[0] ?? "";

/** An `/api/...` path under the current review. */
export const api = (path: `/api/${string}`): string => `${base}${path}`;
