import { describe, expect, test } from "bun:test";
import { isAuthorized, isSessionId, matchRoute, newSessionId, ttlSeconds } from "./routes";

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
    ["POST", "/api/sessions", { kind: "create" }],
    ["GET", "/api/sessions", { kind: "api-not-found" }],
    ["GET", "/api/anything", { kind: "api-not-found" }],
    ["GET", `/s/${id}`, { kind: "page", id }],
    ["GET", `/s/${id}/`, { kind: "page", id }],
    ["POST", `/s/${id}/api/approve`, { kind: "session-api", id, path: "/api/approve" }],
    ["GET", "/s/bad/api/plan", { kind: "api-not-found" }],
    ["GET", "/s/bad", { kind: "page-not-found" }],
    ["GET", `/s/${id}/assets/x.js`, { kind: "asset" }],
    ["GET", "/assets/index.js", { kind: "asset" }],
  ] as const)("%s %s", (method, path, expected) => {
    expect(matchRoute(method, path)).toEqual(expected);
  });
});

test("isAuthorized: open without a token, exact bearer match with one", () => {
  expect(isAuthorized(null, undefined)).toBe(true);
  expect(isAuthorized(null, "")).toBe(true);
  expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  expect(isAuthorized(null, "s3cret")).toBe(false);
  expect(isAuthorized("Bearer s3cre", "s3cret")).toBe(false);
  expect(isAuthorized("Bearer s3cretX", "s3cret")).toBe(false);
  expect(isAuthorized("s3cret", "s3cret")).toBe(false);
});

test("ttlSeconds defaults to 7 days", () => {
  expect(ttlSeconds(undefined)).toBe(604800);
  expect(ttlSeconds("abc")).toBe(604800);
  expect(ttlSeconds("0")).toBe(604800);
  expect(ttlSeconds("60")).toBe(60);
});
