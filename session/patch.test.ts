import { describe, expect, test } from "vite-plus/test";
import type { Files } from "./files";
import { PatchError, parsePatch, reverseApply, reversePatch, unquote } from "./patch";
import { baseOf } from "./review";
import binary from "./testdata/binary.patch?raw";
import diffU from "./testdata/diff-u.patch?raw";
import gitBinary from "./testdata/git-binary.patch?raw";
import gitNoPrefix from "./testdata/git-no-prefix.patch?raw";
import git from "./testdata/git.patch?raw";
import modeOnly from "./testdata/mode-only.patch?raw";

// Captured from real `git diff --cached -M` (with and without --no-prefix), `diff -u`, and git's
// binary output, of the trees below.

const BEFORE: Files = {
  "multi.txt": "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n",
  "noeol.txt": "no eol",
  "keep.txt": "keep\n",
  "deleted.txt": "gone\nbye\n",
  "old-name.txt": "a\nb\nc\n",
  "moved.txt": "x\ny\nz\n",
  "crlf.txt": "crlf\r\nline\r\n",
  "café.md": "café\n",
  "with space.txt": "sp\n",
  "empty-deleted.txt": "",
  "mode.sh": "m\n",
};

const AFTER: Files = {
  "multi.txt": "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\nTWELVE\n",
  "noeol.txt": "no eol changed",
  "keep.txt": "keep\n",
  "new-name.txt": "a\nB\nc\n",
  "dir/moved.txt": "x\ny\nz\n",
  "crlf.txt": "crlf\r\nLINE\r\n",
  "café.md": "café!\n",
  "with space.txt": "sp2\n",
  "created.txt": "brand\nnew\n",
  "created-empty.txt": "",
  "mode.sh": "m\n",
};

const sorted = (files: Files) =>
  Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => (a < b ? -1 : 1)));

describe("a real git diff, reversed", () => {
  test.each([
    ["with prefixes", git],
    ["with --no-prefix", gitNoPrefix],
  ])("%s, rebuilds the tree before it", (_, patch) => {
    expect(sorted(baseOf(AFTER, patch))).toEqual(sorted(BEFORE));
  });

  test("reads every kind of file change", () => {
    const files = parsePatch(git).map(({ oldPath, newPath, hunks }) => [
      oldPath,
      newPath,
      hunks.length,
    ]);
    expect(files).toEqual([
      ["café.md", "café.md", 1],
      ["empty-deleted.txt", "created-empty.txt", 0],
      [null, "created.txt", 1],
      ["crlf.txt", "crlf.txt", 1],
      ["deleted.txt", null, 1],
      ["moved.txt", "dir/moved.txt", 0],
      ["multi.txt", "multi.txt", 2],
      ["old-name.txt", "new-name.txt", 1],
      ["noeol.txt", "noeol.txt", 1],
      ["with space.txt", "with space.txt", 1],
    ]);
  });

  test("diff -u output, with timestamps after the paths", () => {
    expect(baseOf({ "f.txt": "l1\nL2\nl3\n" }, diffU)).toEqual({
      "f.txt": "l1\nl2\nl3\n",
    });
  });

  test("files the patch does not mention are context, the same in the base", () => {
    const base = baseOf({ ...AFTER, "PLAN.md": "# Plan\n" }, git);
    expect(base["PLAN.md"]).toBe("# Plan\n");
    expect(base["keep.txt"]).toBe("keep\n");
  });
});

describe("refusals", () => {
  test.each([
    ["a mode-only change", modeOnly, /mode.sh: mode-only changes are not supported/],
    ["a binary file", binary, /Binary patches are not supported/],
    ["a git binary patch", gitBinary, /Binary patches are not supported/],
  ])("%s", (_, patch, message) => {
    expect(() => parsePatch(patch)).toThrow(message);
  });

  test("a hunk that does not match names the file and the hunk", () => {
    const files = { ...AFTER, "multi.txt": AFTER["multi.txt"].replace("TWELVE", "twelve!") };
    expect(() => baseOf(files, git)).toThrow(
      "multi.txt: hunk @@ -9,4 +9,4 @@ does not apply: line 12 differs",
    );
  });

  test("a hunk past the end of the file", () => {
    const patch = "--- a/a\n+++ b/a\n@@ -5,1 +5,1 @@\n-x\n+y\n";
    expect(() => baseOf({ a: "y\n" }, patch)).toThrow(/a: hunk @@ -5,1 \+5,1 @@.*shorter/);
  });

  test("no newline at the end must match", () => {
    const patch = git;
    expect(() => baseOf({ ...AFTER, "noeol.txt": "no eol changed\n" }, patch)).toThrow(
      /noeol.txt: .*ends with a newline/,
    );
  });

  test("a touched file must be in the files; a deleted one must not", () => {
    const { "created.txt": _, ...missing } = AFTER;
    expect(() => baseOf(missing, git)).toThrow("created.txt is in the patch but not in the files");
    expect(() => baseOf({ ...AFTER, "deleted.txt": "x" }, git)).toThrow(
      "deleted.txt is deleted by the patch but is in the files",
    );
  });

  test.each([
    ["", /changes no files/],
    ["just some text\n", /changes no files/],
    ["--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n", /hunk @@ -1,3 \+1,3 @@ is truncated/],
    [
      "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-b\n+c\n",
      /x appears twice/,
    ],
  ])("malformed: %j", (patch, message) => {
    expect(() => parsePatch(patch)).toThrow(message);
  });

  test("errors are PatchErrors", () => {
    expect(() => parsePatch("")).toThrow(PatchError);
  });
});

describe("details", () => {
  test("git's quoted paths, octal bytes as UTF-8", () => {
    expect(unquote('"a/caf\\303\\251 \\"q\\".md"')).toBe('a/café "q".md');
    expect(unquote('"tab\\there"')).toBe("tab\there");
    expect(unquote("plain")).toBe("plain");
  });

  test("a hunk at the start of an empty-old file, and one deleting everything", () => {
    const create = parsePatch("--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n")[0];
    expect(reverseApply("n", create.hunks, "a\nb\n")).toBe("");
    const empty = parsePatch("--- a/n\n+++ b/n\n@@ -1,2 +0,0 @@\n-a\n-b\n")[0];
    expect(reverseApply("n", empty.hunks, "")).toBe("a\nb\n");
  });

  test("an empty context line whose space was stripped still counts", () => {
    const patch = "--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n";
    expect(baseOf({ x: "a\n\nc\n" }, patch)).toEqual({ x: "a\n\nb\n" });
  });

  test("a new empty file and a deleted empty file, without hunks", () => {
    const patch =
      "diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n" +
      "diff --git a/f b/f\ndeleted file mode 100644\nindex e69de29..0000000\n";
    expect(baseOf({ e: "", k: "k" }, patch)).toEqual({ f: "", k: "k" });
  });

  test("a whole patch with CRLF line ends parses its headers", () => {
    const crlf = "--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n";
    expect(baseOf({ x: "b\r\n" }, crlf)).toEqual({ x: "a\r\n" });
  });

  test("the base keeps the tree shape rule", () => {
    const patch =
      "--- /dev/null\n+++ b/a/b\n@@ -0,0 +1 @@\n+x\n--- a/a\n+++ /dev/null\n@@ -1 +0,0 @@\n-y\n";
    expect(baseOf({ "a/b": "x\n" }, patch)).toEqual({ a: "y\n" });
    const clash = "--- a/a\n+++ /dev/null\n@@ -1 +0,0 @@\n-y\n";
    expect(() => baseOf({ "a/b": "x\n" }, clash)).toThrow(/both a file and a directory/);
  });

  test("reversePatch only reports what differs from the files", () => {
    const delta = reversePatch(parsePatch(git), (p) => AFTER[p]);
    expect([...delta.remove].toSorted()).toEqual([
      "created-empty.txt",
      "created.txt",
      "dir/moved.txt",
      "new-name.txt",
    ]);
    expect(delta.write.get("moved.txt")).toBe("x\ny\nz\n");
  });
});

function splitLines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (text.endsWith("\n")) out.pop();
  // The last line without a newline differs from the same line with one.
  else out[out.length - 1] += "\0";
  return out;
}

/** A unified diff of two texts, the way diff and git write one (LCS, 3 lines of context). */
function unifiedDiff(oldText: string, newText: string): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const lcs = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Array<[" " | "-" | "+", string, number, number]> = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) ops.push([" ", a[i], i++, j++]);
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push(["-", a[i], i++, j]);
    } else ops.push(["+", b[j], i, j++]);
  }
  const out = ["--- a/f", "+++ b/f"];
  const C = 3;
  const ranges: Array<[number, number]> = [];
  for (const [k, [op]] of ops.entries()) {
    if (op === " ") continue;
    const [s, e] = [Math.max(0, k - C), Math.min(ops.length, k + C + 1)];
    const last = ranges.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  }
  for (const [s, e] of ranges) {
    const hunk = ops.slice(s, e);
    const oldN = hunk.filter((o) => o[0] !== "+").length;
    const newN = hunk.filter((o) => o[0] !== "-").length;
    const oldS = oldN === 0 ? hunk[0][2] : hunk[0][2] + 1;
    const newS = newN === 0 ? hunk[0][3] : hunk[0][3] + 1;
    out.push(`@@ -${oldS},${oldN} +${newS},${newN} @@`);
    for (const [op, line] of hunk) {
      out.push(op + line.replace("\0", ""));
      if (line.endsWith("\0")) out.push("\\ No newline at end of file");
    }
  }
  return out.join("\n") + "\n";
}

describe("round trip", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const text = (from: string[]) => {
    const n = Math.floor(random() * 14);
    const lines = Array.from({ length: n }, () => from[Math.floor(random() * from.length)]);
    const eol = random() < 0.7;
    return lines.length === 0 ? "" : lines.join("\n") + (eol ? "\n" : "");
  };

  test("the differ itself is sane", () => {
    expect(unifiedDiff("a\nb\n", "a\nc\n")).toBe("--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
  });

  test("diff, then reverse-apply to the new text, gives the old text", () => {
    const words = ["a", "b", "c", "", " d", "e\r"];
    for (let n = 0; n < 2000; n++) {
      const before = text(words);
      const after = random() < 0.5 ? text(words) : before.replace(/b/g, "B");
      if (before === after) continue;
      const [file] = parsePatch(unifiedDiff(before, after));
      expect(reverseApply("f", file.hunks, after), JSON.stringify([before, after])).toBe(before);
    }
  });
});
