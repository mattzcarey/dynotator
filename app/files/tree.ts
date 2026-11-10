/** A file of the review, as `/api/files` lists it. */
export interface FileEntry {
  path: string;
  size: number;
}

export interface TreeFile {
  kind: "file";
  name: string;
  /** As the server gave it: the file's identity in every request and annotation. */
  path: string;
  size: number;
}

export interface TreeDir {
  kind: "dir";
  name: string;
  /** Normalized segments joined by `/`; "" for the root. */
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDir;

/** A path's segments without empty and `.` ones: `./a//b/` is `a/b`. */
export const segmentsOf = (path: string): string[] =>
  path.split("/").filter((segment) => segment !== "" && segment !== ".");

const compareNames = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const compareNodes = (a: TreeNode, b: TreeNode): number =>
  a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : compareNames(a.name, b.name);

function sortTree(dir: TreeDir): void {
  dir.children.sort(compareNodes);
  for (const child of dir.children) if (child.kind === "dir") sortTree(child);
}

/**
 * The directory tree of a flat file list, in one pass over the paths' segments: directories
 * first, then files, each by name. Paths that are empty after normalizing, and repeats of a path
 * already seen, are left out.
 */
export function buildTree(files: readonly FileEntry[]): TreeDir {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, TreeDir>([["", root]]);
  const seen = new Set<string>();
  for (const { path, size } of files) {
    const segments = segmentsOf(path);
    if (segments.length === 0 || seen.has(path)) continue;
    seen.add(path);
    let parent = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = parent.path ? `${parent.path}/${segments[i]}` : segments[i];
      let dir = dirs.get(dirPath);
      if (!dir) {
        dir = { kind: "dir", name: segments[i], path: dirPath, children: [] };
        dirs.set(dirPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({ kind: "file", name: segments[segments.length - 1], path, size });
  }
  sortTree(root);
  return root;
}

/** Every file path, in the order the tree shows them. */
export function fileOrder(root: TreeDir): string[] {
  const out: string[] = [];
  const walk = (dir: TreeDir) => {
    for (const child of dir.children) {
      if (child.kind === "dir") walk(child);
      else out.push(child.path);
    }
  };
  walk(root);
  return out;
}

/** The directories holding a file, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestorDirs(path: string): string[] {
  const segments = segmentsOf(path);
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"));
}

export interface TreeRow {
  node: TreeNode;
  /** 0 for the root's children. */
  depth: number;
  /** The directory row it sits in, for moving focus to the parent. */
  parent: TreeDir | null;
}

/** The rows on screen: the root's children and the contents of every expanded directory. */
export function visibleRows(root: TreeDir, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: TreeDir, depth: number, parent: TreeDir | null) => {
    for (const node of dir.children) {
      rows.push({ node, depth, parent });
      if (node.kind === "dir" && expanded.has(node.path)) walk(node, depth + 1, node);
    }
  };
  walk(root, 0, null);
  return rows;
}

/** Per file path and per directory path, a count summed over the files below it. */
export function countByPath(counts: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [path, count] of counts) {
    if (count === 0) continue;
    out.set(`f:${path}`, (out.get(`f:${path}`) ?? 0) + count);
    for (const dir of ancestorDirs(path)) out.set(`d:${dir}`, (out.get(`d:${dir}`) ?? 0) + count);
  }
  return out;
}
