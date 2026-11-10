import React, { useMemo } from "react";
import type { PlanDiffBlock } from "@dynotator/ui/utils/planDiffEngine";
import { BlockRenderer } from "@dynotator/ui/components/BlockRenderer";
import { computeListIndices, parseMarkdownToBlocks } from "@dynotator/ui/utils/parser";

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownToBlocks(text), [text]);
  const indices = useMemo(() => computeListIndices(blocks), [blocks]);
  return (
    <>
      {blocks.map((block, i) => (
        <BlockRenderer key={block.id} block={block} orderedIndex={indices[i]} />
      ))}
    </>
  );
}

/** The plan against an earlier version: added, removed and changed blocks marked. */
export function DiffView({ blocks, baseVersion }: { blocks: PlanDiffBlock[]; baseVersion: number }) {
  return (
    <article className="annotation-exclude w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10">
      <p className="mb-4 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
        Changes since version {baseVersion}
      </p>
      {blocks.map((block, i) => {
        if (block.type === "unchanged") return <Markdown key={i} text={block.content} />;
        return (
          <div key={i}>
            {(block.type === "removed" || block.type === "modified") && (
              <div className="plan-diff-removed">
                <Markdown text={block.type === "removed" ? block.content : (block.oldContent ?? "")} />
              </div>
            )}
            {(block.type === "added" || block.type === "modified") && (
              <div className="plan-diff-added">
                <Markdown text={block.content} />
              </div>
            )}
          </div>
        );
      })}
    </article>
  );
}
