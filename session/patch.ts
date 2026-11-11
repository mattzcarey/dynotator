/**
 * Unified diffs (`git diff`, with or without prefixes, or plain `diff -u`) parsed and applied in
 * reverse, to derive a review's base from its files. Strict: a hunk applies exactly where it says
 * or the whole patch is refused.
 */

export interface Hunk {
  /** The `@@ -a,b +c,d @@` line, for messages. */
  header: string;
  oldStart: number;
  newStart: number;
  newLines: number;
  /** Body lines with their ' ', '-' or '+' marker. */
  lines: string[];
  /** A `\ No newline at end of file` marker follows the last old-side or new-side line. */
  oldNoEol: boolean;
  newNoEol: boolean;
}

export interface FilePatch {
  /** `null` when the file is created. */
  oldPath: string | null;
  /** `null` when the file is deleted. */
  newPath: string | null;
  /** `newPath` is a copy of `oldPath`, which stays. */
  copy: boolean;
  hunks: Hunk[];
}

export class PatchError extends Error {}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(text: string): FilePatch[] {
  const lines = text.split("\n");
  const files: FilePatch[] = [];
  let i = 0;
  const header = (n: number) => lines[n]?.replace(/\r$/, "");
  while (i < lines.length) {
    const line = header(i);
    if (line.startsWith("diff --git ")) {
      i = parseGitFile(lines, i, files);
    } else if (line.startsWith("--- ") && header(i + 1)?.startsWith("+++ ")) {
      const file: FilePatch = {
        oldPath: diffPath(line.slice(4)),
        newPath: diffPath(header(i + 1).slice(4)),
        copy: false,
        hunks: [],
      };
      i = parseHunks(lines, i + 2, file);
      files.push(stripPrefixes(file));
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      throw new PatchError(`Binary patches are not supported: ${line}`);
    } else {
      i++;
    }
  }
  if (files.length === 0) throw new PatchError("The patch changes no files");
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.newPath ?? file.oldPath!;
    if (seen.has(key)) throw new PatchError(`${key} appears twice in the patch`);
    seen.add(key);
  }
  return files;
}

/** How the base differs from the files: paths it lacks, and paths whose old text it holds. */
export interface BaseDelta {
  remove: Set<string>;
  write: Map<string, string>;
}

/**
 * Reverses `patches` against the files, which `read` gives (`undefined`: not in the files). Every
 * path the patch does not mention is the same in the base.
 */
export function reversePatch(
  patches: FilePatch[],
  read: (path: string) => string | undefined,
): BaseDelta {
  const delta: BaseDelta = { remove: new Set(), write: new Map() };
  const current = (path: string) => {
    const text = read(path);
    if (text === undefined) throw new PatchError(`${path} is in the patch but not in the files`);
    return text;
  };
  for (const file of patches) {
    const { oldPath, newPath, hunks } = file;
    if (newPath === null) {
      if (read(oldPath!) !== undefined) {
        throw new PatchError(`${oldPath} is deleted by the patch but is in the files`);
      }
      delta.write.set(oldPath!, reverseApply(oldPath!, hunks, ""));
      continue;
    }
    const old = reverseApply(newPath, hunks, current(newPath));
    if (oldPath === null) {
      if (old !== "") throw new PatchError(`${newPath}: a created file must start empty`);
      delta.remove.add(newPath);
    } else if (oldPath === newPath) {
      delta.write.set(newPath, old);
    } else {
      if (!file.copy) delta.write.set(oldPath, old);
      delta.remove.add(newPath);
    }
  }
  for (const path of delta.write.keys()) delta.remove.delete(path);
  return delta;
}

function parseGitFile(lines: string[], start: number, files: FilePatch[]): number {
  const fromHeader = splitGitHeader(lines[start].replace(/\r$/, "").slice("diff --git ".length));
  let oldPath: string | null = fromHeader?.[0] ?? null;
  let newPath: string | null = fromHeader?.[1] ?? null;
  let renamed: [string | null, string | null] = [null, null];
  let copy = false;
  let created = false;
  let deleted = false;
  let modeChange = false;
  let prefixed = fromHeader?.[2] ?? false;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line.startsWith("diff --git ") || line.startsWith("@@ ")) break;
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const from = diffPath(line.slice(4));
      const to = diffPath(lines[i + 1].replace(/\r$/, "").slice(4));
      const file = stripPrefixes({ oldPath: from, newPath: to, copy: false, hunks: [] });
      oldPath = file.oldPath;
      newPath = file.newPath;
      prefixed = false;
      i += 2;
      break;
    }
    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      throw new PatchError(`Binary patches are not supported: ${fromHeader?.[1] ?? line}`);
    }
    if (line.startsWith("new file mode ")) created = true;
    else if (line.startsWith("deleted file mode ")) deleted = true;
    else if (line.startsWith("old mode ") || line.startsWith("new mode ")) modeChange = true;
    else if (line.startsWith("rename from ")) renamed[0] = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) renamed[1] = unquote(line.slice(10));
    else if (line.startsWith("copy from ")) [renamed[0], copy] = [unquote(line.slice(10)), true];
    else if (line.startsWith("copy to ")) [renamed[1], copy] = [unquote(line.slice(8)), true];
  }
  if (renamed[0] !== null && renamed[1] !== null) [oldPath, newPath] = renamed;
  else if (prefixed) {
    oldPath = oldPath && strip(oldPath);
    newPath = newPath && strip(newPath);
  }
  if (created) oldPath = null;
  if (deleted) newPath = null;
  if (oldPath === null && newPath === null) {
    throw new PatchError(`Cannot read the file names in: ${lines[start]}`);
  }
  const file: FilePatch = { oldPath, newPath, copy, hunks: [] };
  i = parseHunks(lines, i, file);
  const moved = oldPath !== newPath;
  if (file.hunks.length === 0 && !moved && !created && !deleted) {
    const name = newPath ?? oldPath;
    throw new PatchError(
      modeChange
        ? `${name}: mode-only changes are not supported`
        : `${name}: the patch has no changes for this file`,
    );
  }
  files.push(file);
  return i;
}

function parseHunks(lines: string[], start: number, file: FilePatch): number {
  let i = start;
  while (i < lines.length) {
    const head = lines[i].replace(/\r$/, "");
    const m = HUNK.exec(head);
    if (!m) break;
    const hunk: Hunk = {
      header: head.slice(0, head.indexOf("@@", 2) + 2),
      oldStart: Number(m[1]),
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
      lines: [],
      oldNoEol: false,
      newNoEol: false,
    };
    let oldLeft = m[2] === undefined ? 1 : Number(m[2]);
    let newLeft = hunk.newLines;
    i++;
    while (oldLeft > 0 || newLeft > 0 || lines[i]?.startsWith("\\")) {
      if (i >= lines.length) break;
      // Some tools strip the space off an empty context line.
      const line = lines[i] === "" || lines[i] === "\r" ? ` ${lines[i]}` : lines[i];
      const marker = line[0];
      if (marker === "\\") {
        const last = hunk.lines.at(-1)?.[0];
        if (last === "-" || last === " ") hunk.oldNoEol = true;
        if (last === "+" || last === " ") hunk.newNoEol = true;
      } else if (marker === " " && oldLeft > 0 && newLeft > 0) {
        oldLeft--;
        newLeft--;
        hunk.lines.push(line);
      } else if (marker === "-" && oldLeft > 0) {
        oldLeft--;
        hunk.lines.push(line);
      } else if (marker === "+" && newLeft > 0) {
        newLeft--;
        hunk.lines.push(line);
      } else {
        break;
      }
      i++;
    }
    if (oldLeft > 0 || newLeft > 0) {
      throw new PatchError(`${file.newPath ?? file.oldPath}: hunk ${hunk.header} is truncated`);
    }
    file.hunks.push(hunk);
  }
  return i;
}

/**
 * Old text from new: every hunk's new side must match `text` exactly at the line it names.
 * `name` labels errors.
 */
export function reverseApply(name: string, hunks: Hunk[], text: string): string {
  const lines = text === "" ? [] : text.split("\n");
  let eol = text.endsWith("\n");
  if (eol) lines.pop();
  const out: string[] = [];
  let at = 0;
  for (const hunk of hunks) {
    const fail = (why: string): never => {
      throw new PatchError(`${name}: hunk ${hunk.header} does not apply: ${why}`);
    };
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    if (start < at) fail("it overlaps the previous hunk");
    if (start + hunk.newLines > lines.length) fail("the file is shorter");
    out.push(...lines.slice(at, start));
    let n = start;
    for (const line of hunk.lines) {
      const body = line.slice(1);
      if (line[0] !== "-") {
        if (lines[n] !== body) fail(`line ${n + 1} differs`);
        n++;
      }
      if (line[0] !== "+") out.push(body);
    }
    at = n;
    if (at === lines.length) {
      if (lines.length > 0 && hunk.newNoEol === eol) {
        fail(eol ? "the file ends with a newline" : "the file has no newline at the end");
      }
      eol = !hunk.oldNoEol;
    } else if (hunk.newNoEol) {
      fail("its last line is not the end of the file");
    }
  }
  out.push(...lines.slice(at));
  return out.length === 0 ? "" : out.join("\n") + (eol ? "\n" : "");
}

const DEV_NULL = "/dev/null";

/** The path on a `---`/`+++` line, without a timestamp; `null` for /dev/null. */
function diffPath(raw: string): string | null {
  const value = raw.replace(/\r$/, "");
  const path = value.startsWith('"') ? unquote(value) : value.split("\t")[0];
  return path === DEV_NULL ? null : path;
}

/** Drops git's `a/` and `b/` when both sides carry them; `--no-prefix` paths stay as they are. */
function stripPrefixes(file: FilePatch): FilePatch {
  const { oldPath: o, newPath: n } = file;
  const prefixed = (o === null || o.startsWith("a/")) && (n === null || n.startsWith("b/"));
  return prefixed
    ? { ...file, oldPath: o && o.slice(2), newPath: n && n.slice(2) }
    : file;
}

const strip = (path: string) => path.slice(2);

/**
 * `diff --git A B`: the two paths and whether they carry `a/`/`b/`. Without quotes a name may hold
 * spaces, so the line is split where both halves name the same file; renames are read from their
 * own header lines instead.
 */
function splitGitHeader(rest: string): [string, string, boolean] | undefined {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    const a = unquote(rest.slice(0, end + 1));
    const tail = rest.slice(end + 2);
    const b = tail.startsWith('"') ? unquote(tail) : tail;
    return withPrefix(a, b);
  }
  const quoted = rest.indexOf(' "');
  if (quoted !== -1) return withPrefix(rest.slice(0, quoted), unquote(rest.slice(quoted + 1)));
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === " ") {
    const [a, b] = [rest.slice(0, mid), rest.slice(mid + 1)];
    if (a.startsWith("a/") && b.startsWith("b/") && a.slice(2) === b.slice(2)) return [a, b, true];
    if (a === b) return [a, b, false];
  }
  return undefined;
}

function withPrefix(a: string, b: string): [string, string, boolean] {
  return [a, b, a.startsWith("a/") && b.startsWith("b/")];
}

function closingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === '"') return i;
  }
  throw new PatchError(`Unterminated quoted path: ${s}`);
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** Git's C-style quoting, octal escapes being UTF-8 bytes. Unquoted input is returned as is. */
export function unquote(raw: string): string {
  const s = raw.replace(/\r$/, "");
  if (!s.startsWith('"')) return s;
  const bytes: number[] = [];
  const end = closingQuote(s);
  for (let i = 1; i < end; i++) {
    const c = s[i];
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const next = s[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(s.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
