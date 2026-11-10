import { describe, expect, test } from "vitest";
import { formatHash, isMarkdown, languageFor, parseHash, resolveLink } from "./paths";

describe("resolveLink", () => {
  const tree = new Set(["README.md", "docs/a.md", "docs/guide/b.md", "worker/api.ts", "docs/README.md"]);
  const has = (path: string) => tree.has(path);
  const from = (file: string, href: string) => resolveLink(file, href, has);

  test("relative paths against the current file's directory", () => {
    expect(from("README.md", "./docs/a.md")).toEqual({ path: "docs/a.md" });
    expect(from("README.md", "docs/a.md")).toEqual({ path: "docs/a.md" });
    expect(from("docs/a.md", "guide/b.md")).toEqual({ path: "docs/guide/b.md" });
    expect(from("docs/guide/b.md", "../../worker/api.ts")).toEqual({ path: "worker/api.ts" });
    expect(from("docs/guide/b.md", "../a.md")).toEqual({ path: "docs/a.md" });
  });

  test("anchors, line anchors and query strings", () => {
    expect(from("docs/a.md", "../README.md#set-up")).toEqual({ path: "README.md", anchor: "set-up" });
    expect(from("docs/a.md", "#usage")).toEqual({ path: "docs/a.md", anchor: "usage" });
    expect(from("README.md", "worker/api.ts#L10-L20")).toEqual({
      path: "worker/api.ts",
      lines: { start: 10, end: 20 },
    });
    expect(from("README.md", "worker/api.ts#L7")).toEqual({ path: "worker/api.ts", lines: { start: 7, end: 7 } });
    expect(from("README.md", "docs/a.md?plain=1")).toEqual({ path: "docs/a.md" });
  });

  test("root-relative paths, directories and encoded names", () => {
    expect(from("docs/guide/b.md", "/worker/api.ts")).toEqual({ path: "worker/api.ts" });
    expect(from("README.md", "docs/")).toEqual({ path: "docs/README.md" });
    expect(resolveLink("a b.md", "./c%20d.md", (p) => p === "c d.md")).toEqual({ path: "c d.md" });
  });

  test("outside the review: ordinary links", () => {
    expect(from("README.md", "https://example.com/docs/a.md")).toBeNull();
    expect(from("README.md", "mailto:x@example.com")).toBeNull();
    expect(from("README.md", "//cdn.example.com/a.md")).toBeNull();
    expect(from("README.md", "../README.md")).toBeNull();
    expect(from("docs/a.md", "../../README.md")).toBeNull();
    expect(from("README.md", "missing.md")).toBeNull();
    expect(from("README.md", "")).toBeNull();
  });
});

describe("hash", () => {
  const round = (hash: string) => formatHash(parseHash(hash)!);

  test("parse", () => {
    expect(parseHash("#/worker/api.ts")).toEqual({ path: "worker/api.ts" });
    expect(parseHash("#/worker/api.ts:L42")).toEqual({ path: "worker/api.ts", lines: { start: 42, end: 42 } });
    expect(parseHash("#/worker/api.ts:L48-42")).toEqual({ path: "worker/api.ts", lines: { start: 42, end: 48 } });
    expect(parseHash("#/worker/api.ts:L42-L48")).toEqual({ path: "worker/api.ts", lines: { start: 42, end: 48 } });
    expect(parseHash("#/docs/a.md#set-up")).toEqual({ path: "docs/a.md", anchor: "set-up" });
    expect(parseHash("#/a%20b%23c.md")).toEqual({ path: "a b#c.md" });
    expect(parseHash("#/bad%E0.md")).toEqual({ path: "bad%E0.md" });
    expect(parseHash("#/x.ts:L0")).toEqual({ path: "x.ts" });
  });

  test("not a location", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#")).toBeNull();
    expect(parseHash("#set-up")).toBeNull();
    expect(parseHash("#/")).toBeNull();
  });

  test("format round-trips", () => {
    expect(formatHash({ path: "worker/api.ts", lines: { start: 42, end: 48 } })).toBe("#/worker/api.ts:L42-48");
    expect(formatHash({ path: "a.ts", lines: { start: 3, end: 3 } })).toBe("#/a.ts:L3");
    expect(formatHash({ path: "a b#?.md", anchor: "é x" })).toBe("#/a%20b%23%3F.md#%C3%A9%20x");
    for (const hash of ["#/worker/api.ts", "#/worker/api.ts:L42", "#/a.ts:L1-9", "#/docs/a.md#x-y"])
      expect(round(hash)).toBe(hash);
    const odd = { path: "dir/ü #1?.ts", lines: { start: 2, end: 5 }, anchor: "a#b" };
    expect(parseHash(formatHash(odd))).toEqual(odd);
  });
});

test("languageFor and isMarkdown", () => {
  expect(languageFor("worker/api.ts")).toBe("typescript");
  expect(languageFor("app/App.tsx")).toBe("tsx");
  expect(languageFor("package.json")).toBe("json");
  expect(languageFor("app/theme.css")).toBe("css");
  expect(languageFor("wrangler.toml")).toBe("toml");
  expect(languageFor("A.PY")).toBe("python");
  expect(languageFor("Dockerfile")).toBe("dockerfile");
  expect(languageFor("build/Makefile")).toBe("makefile");
  expect(languageFor(".gitignore")).toBeUndefined();
  expect(languageFor("LICENSE")).toBeUndefined();
  expect(languageFor("data.xyz")).toBeUndefined();
  expect(languageFor("constructor")).toBeUndefined();
  expect(languageFor("x.toString")).toBeUndefined();
  expect(isMarkdown("docs/A.MD")).toBe(true);
  expect(isMarkdown("x.mdx")).toBe(true);
  expect(isMarkdown("x.markdown")).toBe(true);
  expect(isMarkdown("md.ts")).toBe(false);
});
