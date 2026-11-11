import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Mirrors the per-file limit in session/files.ts: larger files are left out, not sent to fail. */
const MAX_FILE_BYTES = 1024 * 1024;

/** A failure to report to the user as a message, not a stack trace. */
export class Failure extends Error {}

// Fixed prefixes and no quoting, whatever the user's git config says: the server reads the
// default `a/` `b/` form only.
const GIT = [
  "-c",
  "core.quotepath=off",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "core.fileMode=false",
];
const DIFF = ["diff", "--no-color", "--no-ext-diff", "--no-renames"];

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", [...GIT, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Failure(stderr || `git ${args[0]} failed`);
  }
}

export function gitRoot(): string | undefined {
  const found = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

const nulSeparated = (out: string) => out.split("\0").filter((entry) => entry !== "");

/** The file as text, or `undefined` if it is missing, not a regular file, too large or binary. */
function readText(root: string, rel: string): string | undefined {
  const full = path.join(root, rel);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
  const bytes = readFileSync(full);
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export interface Snapshot {
  files: Record<string, string>;
  /** Present when the snapshot is a change against a base. */
  patch?: string;
  /** Paths the change deletes: in the patch, absent from `files`. */
  deleted: string[];
  changed: number;
  /** Paths left out because they are binary, too large or not regular files. */
  skipped: string[];
}

/**
 * The working tree's change against `base` as the server wants it: the new contents of every
 * text file the patch touches, and a patch restricted to those files.
 */
export function collectChange(root: string, base: string): Snapshot {
  const status = nulSeparated(git(root, [...DIFF, "--name-status", "-z", base]));
  const binary = new Set(
    nulSeparated(git(root, [...DIFF, "--numstat", "-z", base]))
      .filter((entry) => entry.startsWith("-\t-\t"))
      .map((entry) => entry.slice(4)),
  );
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const tracked: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i + 1 < status.length; i += 2) {
    const rel = status[i + 1];
    const text = status[i] === "D" ? "" : readText(root, rel);
    if (binary.has(rel) || text === undefined) {
      skipped.push(rel);
      continue;
    }
    tracked.push(rel);
    if (status[i] === "D") deleted.push(rel);
    else files[rel] = text;
  }

  let patch = "";
  for (let i = 0; i < tracked.length; i += 500) {
    patch += git(root, [...DIFF, base, "--", ...tracked.slice(i, i + 500)]);
  }
  let changed = tracked.length;
  for (const rel of nulSeparated(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))) {
    const text = readText(root, rel);
    if (text === undefined) {
      skipped.push(rel);
      continue;
    }
    files[rel] = text;
    changed += 1;
    // `git diff --no-index` exits 1 when the files differ, which they always do here.
    patch += spawnSync("git", [...GIT, ...DIFF, "--no-index", "--", "/dev/null", rel], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).stdout;
  }
  return { files, patch, deleted, changed, skipped };
}

/** Adds `paths` to the snapshot as they are on disk. Paths already in it are left alone. */
export function addFiles(root: string, snapshot: Snapshot, paths: Iterable<string>): void {
  for (const rel of paths) {
    if (rel in snapshot.files) continue;
    const text = readText(root, rel);
    if (text !== undefined) snapshot.files[rel] = text;
    else if (lstatSync(path.join(root, rel), { throwIfNoEntry: false })) snapshot.skipped.push(rel);
  }
}

/** Command-line paths as root-relative POSIX file paths, directories expanded. */
export function expandPaths(root: string, inGit: boolean, args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const full = path.resolve(arg);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (rel.startsWith("..")) throw new Failure(`${arg} is outside ${root}`);
    const stat = lstatSync(full, { throwIfNoEntry: false });
    if (!stat) throw new Failure(`${arg} does not exist`);
    if (!stat.isDirectory()) {
      out.push(rel);
    } else if (inGit) {
      const listed = git(root, ["ls-files", "-co", "--exclude-standard", "-z", "--", rel || "."]);
      out.push(...nulSeparated(listed));
    } else {
      for (const entry of readdirSync(full, { recursive: true, withFileTypes: true })) {
        const child = path.relative(root, path.join(entry.parentPath, entry.name));
        const parts = child.split(path.sep);
        if (entry.isFile() && !parts.some((p) => p.startsWith(".") || p === "node_modules")) {
          out.push(parts.join("/"));
        }
      }
    }
  }
  return out;
}
