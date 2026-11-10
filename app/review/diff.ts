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
