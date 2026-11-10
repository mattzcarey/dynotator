import { Fragment, useMemo, useState, type ReactNode } from "react";
import { BlockRenderer } from "../markdown/BlockRenderer";
import { isMarkdown } from "../files/paths";
import { useFile, type FileState } from "../files/useFile";
import { diffLines, diffPlans, foldUnchanged, type DiffEntry, type LineEntry } from "./diff";
import type { ChangedFile } from "./useVersions";

const STATUS: Record<ChangedFile["status"], [string, string]> = {
  added: ["A", "text-success"],
  modified: ["M", "text-primary"],
  deleted: ["D", "text-destructive"],
};

const label = "font-mono text-[11px] tracking-[0.04em] text-muted-foreground";

/**
 * The version on screen against an earlier one: which files changed and, for the selected one,
 * a block diff (markdown) or a line diff (anything else).
 */
export function DiffView({
  base,
  version,
  files,
  showList,
  selected,
  onSelect,
}: {
  base: number;
  version: number;
  files: ChangedFile[];
  /** The list of files; a single-file review shows its one diff alone. */
  showList: boolean;
  selected: ChangedFile | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="annotation-exclude flex w-full flex-col gap-3">
      {showList && (
        <section className="rounded-xl border border-border bg-card p-2">
          <p className={`${label} px-2 pt-1 pb-2`}>
            {files.length} {files.length === 1 ? "file" : "files"} changed since version {base}
          </p>
          <ul>
            {files.map((file) => {
              const [letter, tone] = STATUS[file.status];
              const active = file.path === selected?.path;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(file.path)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] ${active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    <span
                      className={`w-3 shrink-0 font-mono text-[11px] ${tone}`}
                      title={file.status}
                    >
                      {letter}
                    </span>
                    <span className="min-w-0 truncate">{file.path}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {selected ? (
        <FileDiff key={`${base}\n${selected.path}`} file={selected} base={base} version={version} />
      ) : (
        <p className={`${label} rounded-xl bg-card px-4 py-6`}>No changes since version {base}.</p>
      )}
    </div>
  );
}

function FileDiff({ file, base, version }: { file: ChangedFile; base: number; version: number }) {
  const [before] = useFile(file.status === "added" ? null : file.path, base);
  const [after] = useFile(file.status === "deleted" ? null : file.path, version);
  const heading = (
    <p className={`${label} mb-4`}>
      {file.path} · {file.status === "modified" ? `changes since version ${base}` : file.status}
    </p>
  );
  const failed = [before, after].find(
    (s): s is Extract<FileState, { status: "error" }> => s.status === "error",
  );
  if (failed || before.status !== "ready" || after.status !== "ready") {
    return (
      <div className="rounded-xl bg-card px-4 py-6 md:px-10">
        {heading}
        <p className="text-xs text-muted-foreground">{failed ? failed.message : "Loading…"}</p>
      </div>
    );
  }
  return isMarkdown(file.path) ? (
    <BlockDiff heading={heading} oldText={before.content} newText={after.content} />
  ) : (
    <LineDiff heading={heading} oldText={before.content} newText={after.content} />
  );
}

function BlockDiff({
  heading,
  oldText,
  newText,
}: {
  heading: ReactNode;
  oldText: string;
  newText: string;
}) {
  const entries: DiffEntry[] = useMemo(() => diffPlans(oldText, newText), [oldText, newText]);
  return (
    <article className="w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10">
      {heading}
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

const SIGN = { unchanged: " ", added: "+", removed: "-" };

const line = (entry: LineEntry, key: string) => (
  <div key={key} className={`flex row-${entry.change}`}>
    <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
      {entry.oldLine ?? ""}
    </span>
    <span className="w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
      {entry.newLine ?? ""}
    </span>
    <span className="sign w-4 shrink-0 select-none">{SIGN[entry.change]}</span>
    <span className="pr-4 whitespace-pre">{entry.text || " "}</span>
  </div>
);

function LineDiff({
  heading,
  oldText,
  newText,
}: {
  heading: ReactNode;
  oldText: string;
  newText: string;
}) {
  const rows = useMemo(() => foldUnchanged(diffLines(oldText, newText)), [oldText, newText]);
  const [opened, setOpened] = useState(() => new Set<number>());
  return (
    <section className="w-full rounded-xl bg-card px-4 py-6 md:px-6">
      {heading}
      <div className="line-diff overflow-x-auto rounded-md border border-border bg-[var(--code-bg)] py-2 font-mono text-[12.5px] leading-5">
        <div className="min-w-max">
          {rows.length === 0 && <p className="px-3 text-muted-foreground">Empty file.</p>}
          {rows.map((row, i) =>
            "hidden" in row ? (
              opened.has(i) ? (
                row.hidden.map((entry, j) => line(entry, `${i}.${j}`))
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOpened((prev) => new Set(prev).add(i))}
                  className="my-0.5 block w-full border-y border-dashed border-border px-3 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {row.hidden.length} unchanged lines
                </button>
              )
            ) : (
              line(row, String(i))
            ),
          )}
        </div>
      </div>
    </section>
  );
}
