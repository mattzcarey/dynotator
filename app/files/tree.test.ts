import { describe, expect, test } from "vite-plus/test";
import {
  ancestorDirs,
  buildTree,
  countByPath,
  fileOrder,
  visibleRows,
  type TreeDir,
  type TreeNode,
} from "./tree";

const files = (...paths: string[]) => paths.map((path) => ({ path, size: 1 }));
const shape = (dir: TreeDir): unknown[] =>
  dir.children.map((node: TreeNode) =>
    node.kind === "dir" ? { [`${node.name}/`]: shape(node) } : node.name,
  );

describe("buildTree", () => {
  test("directories first, then files, each by name ignoring case", () => {
    const tree = buildTree(
      files(
        "README.md",
        "worker/api.ts",
        "app/z.ts",
        "app/A.ts",
        "Zeta.ts",
        "app/review/x.ts",
        "a-b/c.ts",
        "b.ts",
      ),
    );
    expect(shape(tree)).toEqual([
      { "a-b/": ["c.ts"] },
      { "app/": [{ "review/": ["x.ts"] }, "A.ts", "z.ts"] },
      { "worker/": ["api.ts"] },
      "b.ts",
      "README.md",
      "Zeta.ts",
    ]);
    expect(fileOrder(tree)).toEqual([
      "a-b/c.ts",
      "app/review/x.ts",
      "app/A.ts",
      "app/z.ts",
      "worker/api.ts",
      "b.ts",
      "README.md",
      "Zeta.ts",
    ]);
  });

  test("empty, duplicate and odd paths", () => {
    const tree = buildTree(files("", "/", "./a.ts", "a.ts", "a.ts", "x//y/", "x/y/z.ts", "x"));
    expect(shape(tree)).toEqual([{ "x/": [{ "y/": ["z.ts"] }, "y"] }, "a.ts", "a.ts", "x"]);
    // The file keeps the path the server gave: it is what requests and annotations carry.
    expect(fileOrder(tree)).toEqual(["x/y/z.ts", "x//y/", "./a.ts", "a.ts", "x"]);
    expect(shape(buildTree([]))).toEqual([]);
  });

  test("a file and a directory of one name are both kept", () => {
    expect(shape(buildTree(files("a", "a/b")))).toEqual([{ "a/": ["b"] }, "a"]);
  });

  test("2,000 files build in well under a frame budget", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `dir${i % 40}/sub${i % 7}/file${i}.ts`);
    const started = performance.now();
    const tree = buildTree(files(...many));
    expect(performance.now() - started).toBeLessThan(100);
    expect(fileOrder(tree)).toHaveLength(2000);
    expect(visibleRows(tree, new Set())).toHaveLength(40);
  });
});

test("visibleRows shows the contents of expanded directories only", () => {
  const tree = buildTree(files("a/b/c.ts", "a/d.ts", "e.ts"));
  const names = (expanded: string[]) =>
    visibleRows(tree, new Set(expanded)).map(({ node, depth }) => `${depth}${node.name}`);
  expect(names([])).toEqual(["0a", "0e.ts"]);
  expect(names(["a"])).toEqual(["0a", "1b", "1d.ts", "0e.ts"]);
  expect(names(["a", "a/b"])).toEqual(["0a", "1b", "2c.ts", "1d.ts", "0e.ts"]);
  expect(names(["a/b"])).toEqual(["0a", "0e.ts"]);
});

test("ancestorDirs and countByPath", () => {
  expect(ancestorDirs("a/b/c.ts")).toEqual(["a", "a/b"]);
  expect(ancestorDirs("c.ts")).toEqual([]);
  const counts = countByPath(
    new Map([
      ["a/b/c.ts", 2],
      ["a/d.ts", 1],
      ["e.ts", 0],
    ]),
  );
  expect(Object.fromEntries(counts)).toEqual({
    "f:a/b/c.ts": 2,
    "d:a": 3,
    "d:a/b": 2,
    "f:a/d.ts": 1,
  });
});
