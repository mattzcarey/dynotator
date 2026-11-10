import { describe, expect, test } from "vitest";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_PATH_BYTES,
  MAX_TOTAL_BYTES,
  changes,
  defaultOpen,
  isValidPath,
  manifestOf,
  parseFiles,
  parseInit,
} from "./files";

describe("isValidPath", () => {
  test.each(["README.md", "src/index.ts", "a/b/c/d.txt", ".gitignore", "a/.b", "...", "é/ü.md"])(
    "accepts %j",
    (path) => expect(isValidPath(path)).toBe(true),
  );

  test.each([
    "",
    "/abs",
    "a/",
    "a//b",
    "./a",
    "a/./b",
    "..",
    "../a",
    "a/../b",
    "a/..",
    "a\0b",
    "a\\b",
    "x".repeat(MAX_PATH_BYTES + 1),
    "é".repeat(MAX_PATH_BYTES / 2 + 1),
    5,
    null,
  ])("rejects %j", (path) => expect(isValidPath(path)).toBe(false));
});

describe("parseFiles", () => {
  test("keeps a valid tree", () => {
    expect(parseFiles({ "a.md": "", "src/b.ts": "b" })).toEqual({ "a.md": "", "src/b.ts": "b" });
  });

  test.each([
    [{}, /empty/],
    [null, /object/],
    [[["a", "b"]], /object/],
    ["a", /object/],
    [{ "../a": "x" }, /Invalid path/],
    [{ "/a": "x" }, /Invalid path/],
    [{ a: 1 }, /must be a string/],
    [{ a: "x", "a/b": "y" }, /both a file and a directory/],
    [{ "a/b": "x", "a/b/c/d": "y" }, /a\/b is both/],
    [{ a: "é".repeat(MAX_FILE_BYTES / 2 + 1) }, /exceeds/],
  ])("rejects %j", (files, message) => {
    expect(() => parseFiles(files)).toThrow(message);
  });

  test("limits the number of files and the total size", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_FILES + 1 }, (_, i) => [`f${i}`, ""]));
    expect(() => parseFiles(many)).toThrow(/files/);
    const chunk = "x".repeat(MAX_FILE_BYTES);
    const big = Object.fromEntries(
      Array.from({ length: MAX_TOTAL_BYTES / MAX_FILE_BYTES + 1 }, (_, i) => [`f${i}`, chunk]),
    );
    expect(() => parseFiles(big)).toThrow(/in total/);
    delete big.f0;
    expect(Object.keys(parseFiles(big))).toHaveLength(MAX_TOTAL_BYTES / MAX_FILE_BYTES);
  });
});

describe("parseInit", () => {
  const files = { "README.md": "# x" };

  test("passes on only the known fields", () => {
    expect(parseInit({ mode: "plan", files, origin: "cli", title: "" })).toEqual({
      mode: "plan",
      files,
    });
    expect(parseInit({ mode: "annotate", files, title: "T", open: "README.md" })).toEqual({
      mode: "annotate",
      files,
      title: "T",
      open: "README.md",
    });
  });

  test.each([
    [{ mode: "review", files }, /mode/],
    [{ mode: "plan" }, /files/],
    [{ mode: "plan", markdown: "# x" }, /files/],
    [{ mode: "plan", files, title: 5 }, /title/],
    [{ mode: "plan", files, open: "nope.md" }, /open/],
    [{ mode: "plan", files, open: "toString" }, /open/],
    [{ mode: "plan", files, open: 1 }, /open/],
    [null, /Expected/],
  ])("rejects %j", (init, message) => {
    expect(() => parseInit(init)).toThrow(message);
  });
});

describe("defaultOpen", () => {
  test.each([
    [["src/a.ts", "README.md", "docs/a.md"], "README.md"],
    [["src/a.ts", "docs/README.md", "b.md"], "b.md"],
    [["z.ts", "src/GUIDE.MD", "a.ts"], "src/GUIDE.MD"],
    [["z.ts", "a.ts", "B.ts"], "B.ts"],
  ])("%j opens %j", (paths, expected) => {
    expect(defaultOpen(paths)).toBe(expected);
  });
});

describe("changes", () => {
  test("compares content, not just size", async () => {
    const from = await manifestOf({ "a.md": "aa", "b.md": "b", "c.md": "c" });
    const to = await manifestOf({ "a.md": "ab", "b.md": "b", "d.md": "d" });
    expect(changes(from, to)).toEqual([
      { path: "a.md", status: "modified" },
      { path: "c.md", status: "deleted" },
      { path: "d.md", status: "added" },
    ]);
    expect(changes(to, to)).toEqual([]);
  });
});
