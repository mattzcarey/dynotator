import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import type { Files } from "../../../session/files";
import { baseOf } from "../../../session/review";
import { Failure, addFiles, collectChange, expandPaths } from "./snapshot";

const BEFORE: Files = {
  "PLAN.md": "# Plan\n",
  "src/a.ts": "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
  "src/noeol.txt": "no eol",
  "src/crlf.txt": "crlf\r\nline\r\n",
  "café.md": "café\n",
  "with space.txt": "sp\n",
  "deleted.txt": "gone\nbye\n",
  "reverted.txt": "same\n",
};

let root: string;
const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
const write = (rel: string, content: string | Uint8Array) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "dynotator-cli-"));
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  // The settings the CLI has to override to get a patch the server reads.
  run("config", "diff.mnemonicPrefix", "true");
  run("config", "diff.noprefix", "true");
  for (const [rel, content] of Object.entries(BEFORE)) write(rel, content);
  write("logo.bin", new Uint8Array([0, 1, 2, 255]));
  run("add", "-A");
  run("commit", "-qm", "before");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a working-tree change reverses to the committed tree on the server", () => {
  write("src/a.ts", "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n");
  write("src/noeol.txt", "still no eol");
  write("src/crlf.txt", "crlf\r\nchanged\r\n");
  write("café.md", "café au lait\n");
  write("with space.txt", "sp\nmore\n");
  rmSync(path.join(root, "deleted.txt"));
  write("logo.bin", new Uint8Array([0, 9, 9, 9]));
  write("new dir/added.md", "new\n");
  write("empty.txt", "");
  write("big.txt", "x".repeat(1024 * 1024 + 1));
  run("add", "src/crlf.txt"); // staged and unstaged changes both count

  const snapshot = collectChange(root, "HEAD");
  addFiles(root, snapshot, ["PLAN.md"]);

  expect(snapshot.deleted).toEqual(["deleted.txt"]);
  expect(snapshot.skipped.toSorted()).toEqual(["big.txt", "logo.bin"]);
  expect(snapshot.changed).toBe(8);
  expect(Object.keys(snapshot.files).toSorted()).toEqual([
    "PLAN.md",
    "café.md",
    "empty.txt",
    "new dir/added.md",
    "src/a.ts",
    "src/crlf.txt",
    "src/noeol.txt",
    "with space.txt",
  ]);
  const { "reverted.txt": _untouched, ...touchedOrContext } = BEFORE;
  expect(baseOf(snapshot.files, snapshot.patch ?? "")).toEqual(touchedOrContext);
});

test("a revision keeps a file whose change was reverted, and drops one deleted since", () => {
  write("reverted.txt", "changed\n");
  const first = collectChange(root, "HEAD");
  const known = [...Object.keys(first.files), ...first.deleted];

  write("reverted.txt", BEFORE["reverted.txt"]);
  rmSync(path.join(root, "PLAN.md"));
  const second = collectChange(root, "HEAD");
  addFiles(root, second, known);

  expect(second.files).toEqual({ "reverted.txt": "same\n" });
  expect(second.deleted).toEqual(["PLAN.md"]);
});

test("paths expand to tracked and untracked files under the root, never outside it", () => {
  write("src/untracked.ts", "u\n");
  write("node_modules/dep/index.js", "ignored\n");
  write(".gitignore", "node_modules\n");

  const named = expandPaths(root, true, [path.join(root, "src"), path.join(root, "PLAN.md")]);
  expect(named.toSorted()).toEqual([
    "PLAN.md",
    "src/a.ts",
    "src/crlf.txt",
    "src/noeol.txt",
    "src/untracked.ts",
  ]);
  expect(expandPaths(root, false, [path.join(root, "src")]).toSorted()).toEqual([
    "src/a.ts",
    "src/crlf.txt",
    "src/noeol.txt",
    "src/untracked.ts",
  ]);
  expect(() => expandPaths(root, true, [path.join(root, "..")])).toThrow(Failure);
  expect(() => expandPaths(root, true, [path.join(root, "missing.md")])).toThrow(Failure);
});

test("an unknown base is a failure with git's message", () => {
  expect(() => collectChange(root, "no-such-ref")).toThrow(Failure);
});
