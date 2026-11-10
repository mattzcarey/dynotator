import { describe, expect, test } from "vitest";
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
    ["POST", "/api/sessions", { kind: "create" }],
    ["GET", "/api/sessions", { kind: "api-not-found" }],
    ["GET", "/api/anything", { kind: "api-not-found" }],
    ["GET", `/s/${id}`, { kind: "page", id }],
    ["GET", `/s/${id}/`, { kind: "page", id }],
    ["POST", `/s/${id}/api/approve`, { kind: "session-api", id, path: "/api/approve" }],
    ["GET", "/s/bad/api/review", { kind: "api-not-found" }],
    ["GET", "/s/bad", { kind: "page-not-found" }],
    ["GET", `/s/${id}/assets/x.js`, { kind: "asset" }],
    ["GET", "/assets/index.js", { kind: "asset" }],
  ] as const)("%s %s", (method, path, expected) => {
    expect(matchRoute(method, path)).toEqual(expected);
  });
});

test("ttlSeconds defaults to 7 days", () => {
  expect(ttlSeconds(undefined)).toBe(604800);
  expect(ttlSeconds("abc")).toBe(604800);
  expect(ttlSeconds("0")).toBe(604800);
  expect(ttlSeconds("60")).toBe(60);
});
