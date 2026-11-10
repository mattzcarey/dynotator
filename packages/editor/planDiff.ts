import { diffArrays } from "diff";
import type { Block } from "@dynotator/ui/types";
import { parseMarkdownToBlocks } from "@dynotator/ui/utils/parser";

export type DiffEntry =
  | { change: "unchanged" | "added" | "removed"; block: Block }
  | { change: "modified"; block: Block; old: Block[] };

/** A block's identity for diffing: what it is and what it says. */
const keyOf = (block: Block) =>
  `${block.type}|${block.level ?? ""}|${block.language ?? ""}|${block.checked ?? ""}|${block.content}`;

/**
 * The current plan against an earlier one, block by block. A run of removed
 * blocks followed by added ones reads as one change, its old blocks shown
 * above the new.
 */
export function diffPlans(oldText: string, newText: string): DiffEntry[] {
  const oldBlocks = parseMarkdownToBlocks(oldText);
  const newBlocks = parseMarkdownToBlocks(newText);
  const changes = diffArrays(oldBlocks.map(keyOf), newBlocks.map(keyOf));
  const out: DiffEntry[] = [];
  let o = 0;
  let n = 0;
  for (let i = 0; i < changes.length; i++) {
    const { added, removed, count = 0 } = changes[i]!;
    if (removed) {
      const old = oldBlocks.slice(o, o + count);
      o += count;
      const next = changes[i + 1];
      if (next?.added) {
        const added = newBlocks.slice(n, n + (next.count ?? 0));
        n += next.count ?? 0;
        i++;
        added.forEach((block, j) =>
          out.push(j === 0 ? { change: "modified", block, old } : { change: "added", block }),
        );
      } else {
        for (const block of old) out.push({ change: "removed", block });
      }
    } else {
      const change = added ? "added" : "unchanged";
      for (const block of newBlocks.slice(n, n + count)) out.push({ change, block });
      n += count;
      if (!added) o += count;
    }
  }
  return out;
}
