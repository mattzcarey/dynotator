import { Fragment } from "react";
import { BlockRenderer } from "../markdown/BlockRenderer";
import type { DiffEntry } from "./diff";

/** The plan against an earlier version: added, removed and changed blocks marked. */
export function DiffView({ entries, baseVersion }: { entries: DiffEntry[]; baseVersion: number }) {
  return (
    <article className="annotation-exclude w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10">
      <p className="mb-4 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
        Changes since version {baseVersion}
      </p>
      {entries.map((entry, i) => {
        const block = <BlockRenderer block={entry.block} orderedIndex={entry.block.orderedStart} />;
        if (entry.change === "unchanged") return <Fragment key={i}>{block}</Fragment>;
        return (
          <Fragment key={i}>
            {entry.change === "modified" && (
              <div className="diff-removed">
                {entry.old.map((old) => (
                  <BlockRenderer key={old.id} block={old} orderedIndex={old.orderedStart} />
                ))}
              </div>
            )}
            <div className={`diff-${entry.change === "removed" ? "removed" : "added"}`}>
              {block}
            </div>
          </Fragment>
        );
      })}
    </article>
  );
}
