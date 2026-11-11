import { parseMarkdownToBlocks, type Block } from "../markdown/blocks";
import type { Lines, Side } from "./annotations";

export type DiffEntry =
  | { change: "unchanged" | "added" | "removed"; block: Block }
  | { change: "modified"; block: Block; old: Block[] };

/** A block's identity for diffing: what it is and what it says. */
const keyOf = ({
  type,
  level,
  language,
  checked,
  ordered,
  alertKind,
  directiveKind,
  content,
}: Block) =>
  JSON.stringify([type, level, language, checked, ordered, alertKind, directiveKind, content]);

const MAX_CELLS = 4_000_000;

/** Which items of `a` and `b` are common to both (a longest common subsequence). */
function commonItems(a: string[], b: string[]): [boolean[], boolean[]] {
  const inA = a.map(() => false);
  const inB = b.map(() => false);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    inA[start] = inB[start] = true;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    inA[--endA] = inB[--endB] = true;
  }
  // lengths[i][j]: the LCS of a[i..endA) and b[j..endB).
  const rows = endA - start + 1;
  const cols = endB - start + 1;
  // Quadratic in the changed middle: past this many cells it reads as replaced outright.
  if (rows * cols > MAX_CELLS) return [inA, inB];
  const lengths = new Uint32Array(rows * cols);
  for (let i = endA - 1; i >= start; i--) {
    for (let j = endB - 1; j >= start; j--) {
      const at = (i - start) * cols + (j - start);
      lengths[at] =
        a[i] === b[j] ? lengths[at + cols + 1] + 1 : Math.max(lengths[at + cols], lengths[at + 1]);
    }
  }
  for (let i = start, j = start; i < endA && j < endB;) {
    const at = (i - start) * cols + (j - start);
    if (a[i] === b[j]) {
      inA[i++] = inB[j++] = true;
    } else if (lengths[at + cols] >= lengths[at + 1]) i++;
    else j++;
  }
  return [inA, inB];
}

/**
 * The current plan against an earlier one, block by block. A run of removed blocks followed by
 * added ones reads as one change, its old blocks shown above the first new one.
 */
export function diffPlans(oldText: string, newText: string): DiffEntry[] {
  const oldBlocks = parseMarkdownToBlocks(oldText);
  const newBlocks = parseMarkdownToBlocks(newText);
  const [keptOld, keptNew] = commonItems(oldBlocks.map(keyOf), newBlocks.map(keyOf));
  const out: DiffEntry[] = [];
  let o = 0;
  let n = 0;
  while (o < oldBlocks.length || n < newBlocks.length) {
    const removed: Block[] = [];
    while (o < oldBlocks.length && !keptOld[o]) removed.push(oldBlocks[o++]);
    const added: Block[] = [];
    while (n < newBlocks.length && !keptNew[n]) added.push(newBlocks[n++]);
    if (removed.length > 0 && added.length > 0) {
      out.push({ change: "modified", block: added[0], old: removed });
      for (const block of added.slice(1)) out.push({ change: "added", block });
    } else {
      for (const block of removed) out.push({ change: "removed", block });
      for (const block of added) out.push({ change: "added", block });
    }
    if (n < newBlocks.length) {
      out.push({ change: "unchanged", block: newBlocks[n++] });
      o++;
    }
  }
  return out;
}

export interface LineEntry {
  change: "unchanged" | "added" | "removed";
  text: string;
  /** 1-based line in the old text (unchanged, removed) and in the new one (unchanged, added). */
  oldLine?: number;
  newLine?: number;
}

/** Lines of a text, without the empty one after a final newline; none for "". */
export const splitLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** A unified line diff: each changed run as its removed lines, then its added ones. */
export function diffLines(oldText: string, newText: string): LineEntry[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const [keptA, keptB] = commonItems(a, b);
  const out: LineEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while (i < a.length && !keptA[i]) out.push({ change: "removed", text: a[i], oldLine: ++i });
    while (j < b.length && !keptB[j]) out.push({ change: "added", text: b[j], newLine: ++j });
    if (i < a.length && j < b.length)
      out.push({ change: "unchanged", text: b[j], oldLine: ++i, newLine: ++j });
  }
  return out;
}

export type DiffRow = LineEntry | { hidden: LineEntry[] };

/** The diff with runs of unchanged lines more than `context` away from a change folded. */
export function foldUnchanged(entries: readonly LineEntry[], context = 3): DiffRow[] {
  const near = entries.map(() => false);
  entries.forEach((entry, index) => {
    if (entry.change === "unchanged") return;
    const end = Math.min(entries.length - 1, index + context);
    for (let k = Math.max(0, index - context); k <= end; k++) near[k] = true;
  });
  const out: DiffRow[] = [];
  let hidden: LineEntry[] = [];
  const flush = () => {
    // Folding a line or two saves nothing.
    if (hidden.length > 2) out.push({ hidden });
    else out.push(...hidden);
    hidden = [];
  };
  entries.forEach((entry, index) => {
    if (near[index] || entry.change !== "unchanged") {
      flush();
      out.push(entry);
    } else hidden.push(entry);
  });
  flush();
  return out;
}

/** Where a selection in a line diff sits: its side, its lines there, and its text. */
export interface DiffSelection {
  side: Side;
  lines: Lines;
  original: string;
  /** Column of the start in `lines.start`. */
  col: number;
}

/**
 * A selection over consecutive diff rows (`startOffset` into the first row's text, `endOffset`
 * into the last's) as an annotation's place. Removed rows alone are the old side, numbered in
 * the version compared against; anything else is the new side, its removed rows left out, since
 * they are not in the version the agent edits.
 */
export function diffSelection(
  rows: readonly Pick<LineEntry, "change" | "oldLine" | "newLine" | "text">[],
  startOffset: number,
  endOffset: number,
): DiffSelection | null {
  const parts = rows.map((row, i) => ({
    row,
    from: i === 0 ? Math.min(startOffset, row.text.length) : 0,
    to: i === rows.length - 1 ? Math.min(endOffset, row.text.length) : row.text.length,
  }));
  // A selection that ends at the start of a row, or starts at the end of one, does not take it.
  while (parts.length > 1 && parts[parts.length - 1].to === 0) parts.pop();
  while (parts.length > 1 && parts[0].from > 0 && parts[0].from >= parts[0].row.text.length)
    parts.shift();
  if (parts.length === 0) return null;
  const old = parts.every((p) => p.row.change === "removed");
  const mine = old ? parts : parts.filter((p) => p.row.change !== "removed");
  const lineOf = (p: (typeof parts)[number]) => (old ? p.row.oldLine : p.row.newLine);
  const start = lineOf(mine[0]);
  const end = lineOf(mine[mine.length - 1]);
  const original = mine.map((p) => p.row.text.slice(p.from, p.to)).join("\n");
  if (start === undefined || end === undefined || !original.trim()) return null;
  return { side: old ? "old" : "new", lines: { start, end }, original, col: mine[0].from };
}

/** The offset each line starts at. */
export const lineStarts = (text: string): number[] => {
  const out = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
};

/**
 * Where an annotation's text is in a file's source, as offsets: at its column when it is known
 * and still matches, else its first occurrence starting within its lines; null when neither.
 */
export function locateText(
  text: string,
  { lines, col, original }: { lines?: Lines; col?: number; original?: string },
  starts = lineStarts(text),
): [number, number] | null {
  if (!lines || !original || lines.start > starts.length) return null;
  const first = starts[lines.start - 1];
  if (col !== undefined && text.startsWith(original, first + col))
    return [first + col, first + col + original.length];
  const limit = lines.end < starts.length ? starts[lines.end] : text.length;
  const at = text.indexOf(original, first);
  return at !== -1 && at < limit ? [at, at + original.length] : null;
}

/** The 1-based line and 0-based column of `offset`, given the text's `lineStarts`. */
export function lineAt(starts: readonly number[], offset: number): [number, number] {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return [lo + 1, offset - starts[lo]];
}
