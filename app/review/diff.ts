import { parseMarkdownToBlocks, type Block } from "../markdown/blocks";

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
    if (i < a.length && j < b.length) out.push({ change: "unchanged", text: b[j], oldLine: ++i, newLine: ++j });
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
