import { describe, expect, test } from "vite-plus/test";
import { isSessionId, matchRoute, newSessionId, ttlSeconds } from "./routes";

test("session ids are 160-bit URL-safe and distinct", () => {
  const ids = new Set(Array.from({ length: 200 }, newSessionId));
  expect(ids.size).toBe(200);
  for (const id of ids) {
    expect(isSessionId(id)).toBe(true);
    expect(encodeURIComponent(id)).toBe(id);
  }
  expect(isSessionId("short")).toBe(false);
  expect(isSessionId("a".repeat(26) + "/")).toBe(false);
});

describe("matchRoute", () => {
  const id = newSessionId();
  test.each([
    ["/api/sessions", { kind: "api-not-found" }],
    ["/api/anything", { kind: "api-not-found" }],
    [`/s/${id}`, { kind: "page", id }],
    [`/s/${id}/`, { kind: "page", id }],
    [`/s/${id}/api/approve`, { kind: "session-api", id, path: "/api/approve" }],
    ["/s/bad/api/review", { kind: "api-not-found" }],
    ["/s/bad", { kind: "page-not-found" }],
    [`/s/${id}/assets/x.js`, { kind: "asset" }],
    ["/assets/index.js", { kind: "asset" }],
  ] as const)("%s", (path, expected) => {
    expect(matchRoute(path)).toEqual(expected);
  });
});

test("ttlSeconds defaults to 7 days", () => {
  expect(ttlSeconds(undefined)).toBe(604800);
  expect(ttlSeconds("abc")).toBe(604800);
  expect(ttlSeconds("0")).toBe(604800);
  expect(ttlSeconds("60")).toBe(60);
});
