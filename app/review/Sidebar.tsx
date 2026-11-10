import { useMemo, useState, type ReactNode } from "react";
import { headingSlugs, type Block } from "../markdown/blocks";
import type { VersionEntry } from "./useSession";

const tab = (active: boolean) =>
  `h-7 rounded-full px-3 font-mono text-[11px] tracking-[0.04em] ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`;

type View = "files" | "toc" | "versions";

/** The review's files (several), the open markdown file's contents, and its versions. */
export function Sidebar({
  files,
  blocks,
  version,
  versions,
  baseVersion,
  diffActive,
  onSelectBase,
  onShowDiff,
  onNavigate,
}: {
  /** The file tree; null for a review of one file. */
  files: ReactNode | null;
  /** The open file's blocks when it is markdown. */
  blocks: Block[] | null;
  version: number;
  versions: VersionEntry[];
  baseVersion: number | null;
  diffActive: boolean;
  onSelectBase: (version: number) => void;
  onShowDiff: (show: boolean) => void;
  onNavigate: () => void;
}) {
  const views: [View, string][] = [];
  if (files) views.push(["files", "Files"]);
  if (blocks || !files) views.push(["toc", "Contents"]);
  if (versions.length > 1) views.push(["versions", "Versions"]);
  const [chosen, setView] = useState<View>(files ? "files" : "toc");
  const view = views.some(([id]) => id === chosen) ? chosen : views[0][0];
  const headings = useMemo(
    () => (blocks ?? []).filter((b) => b.type === "heading" && (b.level ?? 0) <= 3),
    [blocks],
  );
  const slugs = useMemo(() => headingSlugs(blocks ?? []), [blocks]);

  return (
    <nav aria-label="Review" className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border px-2 py-2">
        {views.map(([id, label]) => (
          <button key={id} type="button" className={tab(view === id)} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {view === "files" && files}
        {view === "toc" &&
          headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${slugs.get(heading.id) ?? ""}`}
              onClick={(e) => {
                e.preventDefault();
                onShowDiff(false);
                requestAnimationFrame(() =>
                  document
                    .getElementById(slugs.get(heading.id) ?? "")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
                onNavigate();
              }}
              className="block truncate rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ paddingLeft: `${(heading.level ?? 1) * 10}px` }}
            >
              {heading.content}
            </a>
          ))}
        {view === "versions" && (
          <div className="flex flex-col gap-1">
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              Version {version} of {versions.length}
            </p>
            <button
              type="button"
              disabled={baseVersion === null}
              onClick={() => {
                onShowDiff(!diffActive);
                onNavigate();
              }}
              className="mb-2 h-8 rounded-full border border-primary/40 text-xs font-medium text-primary disabled:opacity-50"
            >
              {diffActive ? "Hide changes" : "Show changes"}
            </button>
            {versions
              .filter((entry) => entry.version !== version)
              .toReversed()
              .map((entry) => (
                <button
                  type="button"
                  key={entry.version}
                  onClick={() => {
                    onSelectBase(entry.version);
                    onShowDiff(true);
                    onNavigate();
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
