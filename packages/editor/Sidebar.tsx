import React, { useEffect, useMemo, useState } from "react";
import type { Block } from "@dynotator/ui/types";
import { buildHeadingSlugMap } from "@dynotator/ui/utils/slugify";
import type { VersionEntry } from "./hooks/useVersions";

const tab = (active: boolean) =>
  `h-7 rounded-full px-3 font-mono text-[11px] tracking-[0.04em] ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`;

/** Contents of the document and, when there is more than one, its versions. */
export function Sidebar({
  blocks,
  version,
  totalVersions,
  versions,
  baseVersion,
  diffActive,
  onLoadVersions,
  onSelectBase,
  onShowDiff,
  onNavigate,
}: {
  blocks: Block[];
  version: number;
  totalVersions: number;
  versions: VersionEntry[] | null;
  baseVersion: number | null;
  diffActive: boolean;
  onLoadVersions: () => void;
  onSelectBase: (version: number) => void;
  onShowDiff: (show: boolean) => void;
  onNavigate: () => void;
}) {
  const [view, setView] = useState<"toc" | "versions">("toc");
  const headings = useMemo(
    () => blocks.filter((b) => b.type === "heading" && (b.level ?? 0) <= 3),
    [blocks],
  );
  const slugs = useMemo(() => buildHeadingSlugMap(blocks), [blocks]);
  useEffect(() => {
    if (view === "versions") onLoadVersions();
  }, [onLoadVersions, view]);

  return (
    <nav aria-label="Document" className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border px-2 py-2">
        <button type="button" className={tab(view === "toc")} onClick={() => setView("toc")}>
          Contents
        </button>
        {totalVersions > 1 && (
          <button
            type="button"
            className={tab(view === "versions")}
            onClick={() => setView("versions")}
          >
            Versions
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {view === "toc" ? (
          headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${slugs.get(heading.id) ?? ""}`}
              onClick={(e) => {
                e.preventDefault();
                onShowDiff(false);
                document
                  .getElementById(slugs.get(heading.id) ?? "")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                onNavigate();
              }}
              className="block truncate rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ paddingLeft: `${(heading.level ?? 1) * 10}px` }}
            >
              {heading.content}
            </a>
          ))
        ) : (
          <div className="flex flex-col gap-1">
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              Version {version} of {totalVersions}
            </p>
            <button
              type="button"
              disabled={baseVersion === null}
              onClick={() => onShowDiff(!diffActive)}
              className="mb-2 h-8 rounded-full border border-primary/40 text-xs font-medium text-primary disabled:opacity-50"
            >
              {diffActive ? "Hide changes" : "Show changes"}
            </button>
            {(versions ?? [])
              .filter((entry) => entry.version !== version)
              .slice()
              .reverse()
              .map((entry) => (
                <button
                  type="button"
                  key={entry.version}
                  onClick={() => {
                    onSelectBase(entry.version);
                    onShowDiff(true);
                  }}
                  className={`flex justify-between rounded-md border px-2 py-1.5 text-left text-xs ${entry.version === baseVersion ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted"}`}
                >
                  <span>Compare with v{entry.version}</span>
                  <span className="text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </nav>
  );
}
