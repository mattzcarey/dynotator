import {
  type Files,
  type Manifest,
  type ReviewInit,
  type ReviewMode,
  comparePaths,
  defaultOpen,
  manifestOf,
  sameManifest,
} from "./files";
import type { Store } from "./store";

/** The part of `@cloudflare/computer`'s `workspace.fs` a review uses. */
export interface Fs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

export interface ReviewMeta {
  mode: ReviewMode;
  title?: string;
  open?: string;
}

const META = "meta";
const HEAD = "head";
const VERSION_PREFIX = "version:";
const pad = (v: number) => String(v).padStart(6, "0");
const versionKey = (v: number) => `${VERSION_PREFIX}${pad(v)}`;
const filePrefix = (v: number) => `file:${pad(v)}:`;

/** Where version `v`'s tree lives in the workspace. */
export const versionRoot = (v: number) => `/v/${v}`;

export function getMeta(store: Store): ReviewMeta | undefined {
  return store.get<ReviewMeta>(META);
}

/** The latest version number, starting at 1. The browser echoes it as `revision`. */
export function currentVersion(store: Store): number {
  return store.get<number>(HEAD) ?? 0;
}

export function listVersions(store: Store): Array<{ version: number; timestamp: string }> {
  return Array.from(store.list<{ timestamp: string }>({ prefix: VERSION_PREFIX }), ([key, v]) => ({
    version: Number(key.slice(VERSION_PREFIX.length)),
    timestamp: v.timestamp,
  }));
}

/** Version `v`'s paths, sizes and hashes in path order, or `undefined` for an unknown version. */
export function getManifest(store: Store, v: number): Manifest | undefined {
  if (!Number.isInteger(v) || v < 1 || !store.get(versionKey(v))) return undefined;
  const prefix = filePrefix(v);
  const entries = Array.from(
    store.list<[number, string]>({ prefix }),
    ([key, [size, hash]]) => [key.slice(prefix.length), { size, hash }] as const,
  );
  return new Map(entries.toSorted(([a], [b]) => comparePaths(a, b)));
}

/** The path the browser opens first: the requested one while it exists, else the default. */
export function openPath(meta: ReviewMeta, manifest: Manifest): string | undefined {
  return meta.open !== undefined && manifest.has(meta.open) ? meta.open : defaultOpen(manifest.keys());
}

export async function initReview(store: Store, fs: Fs, { files, ...meta }: ReviewInit) {
  if (getMeta(store)) throw new Error("Review already initialised");
  await writeVersion(store, fs, 1, files, await manifestOf(files), () => {});
  // Last, so that a facet whose init failed part way still reads as uninitialised.
  store.put<ReviewMeta>(META, meta);
}

/**
 * Adds `files` as the next version unless it equals the current one. `beforeCommit` runs right
 * before the version is recorded, after every await, and may throw to abandon it. Callers must
 * not run two of these at once.
 */
export async function addVersion(
  store: Store,
  fs: Fs,
  files: Files,
  beforeCommit: () => void,
): Promise<{ version: number; unchanged: boolean }> {
  const head = currentVersion(store);
  const manifest = await manifestOf(files);
  const current = getManifest(store, head);
  if (current && sameManifest(current, manifest)) return { version: head, unchanged: true };
  await writeVersion(store, fs, head + 1, files, manifest, beforeCommit);
  return { version: head + 1, unchanged: false };
}

export async function readVersionFile(
  store: Store,
  fs: Fs,
  v: number,
  path: string,
): Promise<string | undefined> {
  if (!getManifest(store, v)?.has(path)) return undefined;
  return fs.readFile(`${versionRoot(v)}/${path}`, "utf8");
}

/**
 * Writes the tree under `/v/<v>/` first and the index (manifest, version, head) after, in one
 * synchronous batch of storage writes, so a version exists only once all its files do. A tree
 * left behind by a failed attempt is cleared before writing.
 */
async function writeVersion(
  store: Store,
  fs: Fs,
  v: number,
  files: Files,
  manifest: Manifest,
  beforeCommit: () => void,
) {
  const root = versionRoot(v);
  await fs.rm(root, { recursive: true, force: true });
  const dirs = new Set([root]);
  for (const path of manifest.keys()) {
    const slash = path.lastIndexOf("/");
    if (slash !== -1) dirs.add(`${root}/${path.slice(0, slash)}`);
  }
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });
  for (const path of manifest.keys()) await fs.writeFile(`${root}/${path}`, files[path]);

  beforeCommit();
  const prefix = filePrefix(v);
  for (const [path, { size, hash }] of manifest) store.put(`${prefix}${path}`, [size, hash]);
  store.put(versionKey(v), { timestamp: new Date().toISOString() });
  store.put(HEAD, v);
}
