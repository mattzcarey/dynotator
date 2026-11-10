/**
 * A review's subject: repo-relative POSIX paths ("README.md", "src/index.ts") mapped to UTF-8
 * text. `createReview` takes one and every `revise` takes a full snapshot.
 */
export type Files = Record<string, string>;

export type ReviewMode = "plan" | "annotate";

/** What `createReview` takes. */
export interface ReviewInit {
  /** `"plan"`: approve or request changes. `"annotate"`: send feedback or close. */
  mode: ReviewMode;
  title?: string;
  files: Files;
  /** The path shown first. Default: `README.md`, else the first `.md` file, else the first path. */
  open?: string;
}

// A snapshot crosses Workers RPC twice (caller to entrypoint to supervisor to facet), and each
// message must stay under its 32 MiB limit; strings serialise at up to two bytes per UTF-16 unit,
// so 20 MiB of UTF-8 stays below it whatever the text.
export const MAX_FILES = 5_000;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_PATH_BYTES = 512;
export const MAX_TITLE_LENGTH = 4096;

const encoder = new TextEncoder();

export const byteLength = (text: string) => encoder.encode(text).byteLength;

/** Sorts paths by UTF-16 code units, the order every list in the API uses. */
export const comparePaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Relative, `/`-separated, no empty, `.` or `..` segments, no NUL or backslash. */
export function isValidPath(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || byteLength(path) > MAX_PATH_BYTES) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export function parseFiles(files: unknown): Files {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new TypeError("files must be an object mapping paths to text");
  }
  const entries = Object.entries(files);
  if (entries.length === 0) throw new TypeError("files must not be empty");
  if (entries.length > MAX_FILES) throw new RangeError(`files exceeds ${MAX_FILES} files`);
  let total = 0;
  for (const [path, content] of entries) {
    if (!isValidPath(path)) throw new TypeError(`Invalid path: ${JSON.stringify(path)}`);
    if (typeof content !== "string") throw new TypeError(`${path}: content must be a string`);
    const size = byteLength(content);
    if (size > MAX_FILE_BYTES) throw new RangeError(`${path} exceeds ${MAX_FILE_BYTES} bytes`);
    total += size;
  }
  if (total > MAX_TOTAL_BYTES) throw new RangeError(`files exceed ${MAX_TOTAL_BYTES} bytes in total`);
  // A path that is also another path's directory cannot exist in one tree.
  const paths = new Set(entries.map(([path]) => path));
  for (const path of paths) {
    for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
      if (paths.has(path.slice(0, i))) {
        throw new TypeError(`${path.slice(0, i)} is both a file and a directory`);
      }
    }
  }
  return Object.fromEntries(entries);
}

export function parseInit(init: unknown): ReviewInit {
  if (!init || typeof init !== "object") {
    throw new TypeError("Expected { mode, files, title?, open? }");
  }
  const { mode, title, files, open } = init as Partial<Record<keyof ReviewInit, unknown>>;
  if (mode !== "plan" && mode !== "annotate") {
    throw new TypeError('mode must be "plan" or "annotate"');
  }
  if (title !== undefined && (typeof title !== "string" || title.length > MAX_TITLE_LENGTH)) {
    throw new TypeError(`title must be a string of at most ${MAX_TITLE_LENGTH} characters`);
  }
  const parsed = parseFiles(files);
  if (open !== undefined && (typeof open !== "string" || !Object.hasOwn(parsed, open))) {
    throw new TypeError("open must be one of the paths in files");
  }
  return { mode, files: parsed, ...(title && { title }), ...(open !== undefined && { open }) };
}

/** `README.md` if present, else the first `.md` file, else the first path, in sorted order. */
export function defaultOpen(paths: Iterable<string>): string | undefined {
  const sorted = [...paths].toSorted(comparePaths);
  if (sorted.includes("README.md")) return "README.md";
  return sorted.find((p) => p.toLowerCase().endsWith(".md")) ?? sorted[0];
}

export type ChangeStatus = "added" | "modified" | "deleted";

/** A version's index: each path's size in bytes and content hash. */
export type Manifest = Map<string, { size: number; hash: string }>;

export function changes(
  from: Manifest,
  to: Manifest,
): Array<{ path: string; status: ChangeStatus }> {
  const out: Array<{ path: string; status: ChangeStatus }> = [];
  for (const [path, file] of to) {
    const before = from.get(path);
    if (!before) out.push({ path, status: "added" });
    else if (before.hash !== file.hash) out.push({ path, status: "modified" });
  }
  for (const path of from.keys()) if (!to.has(path)) out.push({ path, status: "deleted" });
  return out.toSorted((a, b) => comparePaths(a.path, b.path));
}

export async function manifestOf(files: Files): Promise<Manifest> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const bytes = encoder.encode(content);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
      return [path, { size: bytes.byteLength, hash }] as const;
    }),
  );
  return new Map(entries.toSorted(([a], [b]) => comparePaths(a, b)));
}

export function sameManifest(a: Manifest, b: Manifest): boolean {
  return a.size === b.size && changes(a, b).length === 0;
}
