import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BlockRenderer } from "../markdown/BlockRenderer";
import { HIGHLIGHT_EVENT } from "../markdown/highlight";
import type { Block } from "../markdown/blocks";
import { isMarkdown } from "../files/paths";
import { useFile, type FileState } from "../files/useFile";
import type { Annotation } from "./annotations";
import { Annotator, type Locate } from "./Annotator";
import {
  diffLines,
  diffPlans,
  diffSelection,
  foldUnchanged,
  lineAt,
  lineStarts,
  locateText,
  type DiffEntry,
  type LineEntry,
} from "./diff";
import { findText, offsetIn, textRange } from "./ranges";
import type { ChangedFile } from "./useVersions";

/** What a view needs to show and take annotations. */
export interface Notes {
  /** The current version's annotations, sent and unsent. */
  annotations: Annotation[];
  sentIds: ReadonlySet<string>;
  selectedId: string | null;
  readOnly: boolean;
  onAdd: (annotation: Annotation) => void;
  onSelect: (id: string | null) => void;
}

const STATUS: Record<ChangedFile["status"], [string, string]> = {
  added: ["A", "text-success"],
  modified: ["M", "text-primary"],
  deleted: ["D", "text-destructive"],
};

const label = "font-mono text-[11px] tracking-[0.04em] text-muted-foreground";

export const versionName = (v: number) => (v === 0 ? "the base" : `version ${v}`);

/**
 * The version on screen against an earlier one: which files changed and, for the selected one,
 * a line diff, or for markdown outside a change review a block diff of the rendered document.
 * Both take annotations: removed lines on the old side, the rest on the new.
 */
export function DiffView({
  base,
  version,
  files,
  showList,
  selected,
  sourceMarkdown,
  notes,
  onSelect,
  onOpenFile,
}: {
  base: number;
  version: number;
  files: ChangedFile[];
  /** The list of files; a single-file review shows its one diff alone. */
  showList: boolean;
  selected: ChangedFile | null;
  /** A change review diffs markdown as source, like any file. */
  sourceMarkdown: boolean;
  notes: Notes;
  onSelect: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      {showList && (
        <section className="annotation-exclude rounded-xl border border-border bg-card p-2">
          <p className={`${label} px-2 pt-1 pb-2`}>
            {files.length} {files.length === 1 ? "file" : "files"} changed since {versionName(base)}
          </p>
          <ul>
            {files.map((file) => {
              const [letter, tone] = STATUS[file.status];
              const active = file.path === selected?.path;
              const count = notes.annotations.filter((a) => a.path === file.path).length;
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
                    <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    {count > 0 && (
                      <span className="shrink-0 font-mono text-[10.5px] text-primary">{count}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {selected ? (
        <FileDiff
          key={`${base}\n${selected.path}`}
          file={selected}
          base={base}
          version={version}
          source={sourceMarkdown || !isMarkdown(selected.path)}
          notes={notes}
          onOpenFile={onOpenFile}
        />
      ) : (
        <p className={`${label} rounded-xl bg-card px-4 py-6`}>
          No changes since {versionName(base)}.
        </p>
      )}
    </div>
  );
}

function FileDiff({
  file,
  base,
  version,
  source,
  notes,
  onOpenFile,
}: {
  file: ChangedFile;
  base: number;
  version: number;
  source: boolean;
  notes: Notes;
  onOpenFile: (path: string) => void;
}) {
  const [before] = useFile(file.status === "added" ? null : file.path, base);
  const [after] = useFile(file.status === "deleted" ? null : file.path, version);
  // Removed lines are numbered in the version they were removed from: only this comparison's.
  const annotations = useMemo(
    () =>
      notes.annotations.filter(
        (a) => a.path === file.path && (a.side !== "old" || (a.against ?? 0) === base),
      ),
    [base, file.path, notes.annotations],
  );
  const heading = (
    <div className={`${label} annotation-exclude mb-4 flex items-center gap-2`}>
      <span className="min-w-0 flex-1 truncate">
        {file.path} ·{" "}
        {file.status === "modified" ? `changes since ${versionName(base)}` : file.status}
      </span>
      {file.status !== "deleted" && (
        <button
          type="button"
          onClick={() => onOpenFile(file.path)}
          className="h-7 shrink-0 rounded-full border border-border px-3 text-xs text-foreground hover:bg-muted"
        >
          Open file
        </button>
      )}
    </div>
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
  const props = {
    path: file.path,
    heading,
    base,
    oldText: before.content,
    newText: after.content,
    notes: { ...notes, annotations },
  };
  return source ? <LineDiff {...props} /> : <BlockDiff {...props} />;
}

interface DiffProps {
  path: string;
  heading: ReactNode;
  base: number;
  oldText: string;
  newText: string;
  notes: Notes;
}

/** A block's place in a block diff, for locating selections and painting. */
function Side({
  side,
  block,
  children,
}: {
  side: "old" | "new";
  block: Block;
  children: ReactNode;
}) {
  return (
    <div data-side={side} data-start={block.startLine} data-end={block.endLine}>
      {children}
    </div>
  );
}

const render = (block: Block) => <BlockRenderer block={block} orderedIndex={block.orderedStart} />;

function BlockDiff({ path, heading, base, oldText, newText, notes }: DiffProps) {
  const entries: DiffEntry[] = useMemo(() => diffPlans(oldText, newText), [oldText, newText]);
  const rootRef = useRef<HTMLDivElement>(null);
  const locate: Locate = useCallback(
    (range) => {
      const start = range.startContainer;
      const el = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>(
        "[data-side]",
      );
      if (!el) return null;
      const side = el.dataset.side === "old" ? "old" : "new";
      return {
        side,
        lines: { start: Number(el.dataset.start), end: Number(el.dataset.end) },
        ...(side === "old" && { against: base }),
      };
    },
    [base],
  );
  const rangeOf = useCallback((annotation: Annotation) => {
    const line = annotation.lines?.start ?? 0;
    const blocks = rootRef.current?.querySelectorAll<HTMLElement>(
      `[data-side="${annotation.side ?? "new"}"]`,
    );
    const el = [...(blocks ?? [])].find(
      (b) => Number(b.dataset.start) <= line && line <= Number(b.dataset.end),
    );
    return el ? findText(el, annotation.original) : null;
  }, []);
  return (
    <Annotator
      path={path}
      {...notes}
      className="w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10"
      locate={locate}
      rangeOf={rangeOf}
    >
      {heading}
      <div ref={rootRef}>
        {entries.map((entry, i) => {
          if (entry.change === "unchanged")
            return (
              <Side key={i} side="new" block={entry.block}>
                {render(entry.block)}
              </Side>
            );
          return (
            <Fragment key={i}>
              {entry.change === "modified" && (
                <div className="diff-removed">
                  {entry.old.map((old) => (
                    <Side key={old.id} side="old" block={old}>
                      {render(old)}
                    </Side>
                  ))}
                </div>
              )}
              <div className={`diff-${entry.change === "removed" ? "removed" : "added"}`}>
                <Side side={entry.change === "removed" ? "old" : "new"} block={entry.block}>
                  {render(entry.block)}
                </Side>
              </div>
            </Fragment>
          );
        })}
      </div>
    </Annotator>
  );
}

const SIGN = { unchanged: " ", added: "+", removed: "-" };

const line = (entry: LineEntry, key: string) => (
  <div
    key={key}
    data-row={entry.change}
    data-old={entry.oldLine}
    data-new={entry.newLine}
    className={`flex min-h-5 row-${entry.change}`}
  >
    <span className="annotation-exclude w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
      {entry.oldLine ?? ""}
    </span>
    <span className="annotation-exclude w-12 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
      {entry.newLine ?? ""}
    </span>
    <span className="annotation-exclude sign w-4 shrink-0 select-none">{SIGN[entry.change]}</span>
    <span data-text="" className="pr-4 whitespace-pre">
      {entry.text}
    </span>
  </div>
);

const rowOf = (node: Node) =>
  (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-row]") ?? null;
const textOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-text]") ?? row;

function LineDiff({ path, heading, base, oldText, newText, notes }: DiffProps) {
  const entries = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const rows = useMemo(() => foldUnchanged(entries), [entries]);
  const starts = useMemo(
    () => ({ old: lineStarts(oldText), new: lineStarts(newText) }),
    [oldText, newText],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  // Folds holding an annotated line start open, so the note shows where it was made.
  const [opened, setOpened] = useState(() => {
    const marked = (entry: LineEntry) =>
      notes.annotations.some((a) => {
        const at = a.side === "old" ? entry.oldLine : entry.newLine;
        return at !== undefined && !!a.lines && a.lines.start <= at && at <= a.lines.end;
      });
    return new Set(
      rows.flatMap((row, i) => ("hidden" in row && row.hidden.some(marked) ? [i] : [])),
    );
  });
  useEffect(() => {
    // An opened fold has new rows to paint.
    if (opened.size > 0)
      rootRef.current?.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
  }, [opened]);

  const locate: Locate = useCallback(
    (range) => {
      const root = rootRef.current;
      const first = rowOf(range.startContainer);
      const last = rowOf(range.endContainer);
      if (!root || !first || !last) return null;
      const all = [...root.querySelectorAll<HTMLElement>("[data-row]")];
      const picked = all.slice(all.indexOf(first), all.indexOf(last) + 1);
      const at = diffSelection(
        picked.map((row) => ({
          change: row.dataset.row as LineEntry["change"],
          oldLine: row.dataset.old ? Number(row.dataset.old) : undefined,
          newLine: row.dataset.new ? Number(row.dataset.new) : undefined,
          text: textOf(row).textContent ?? "",
        })),
        offsetIn(textOf(first), range.startContainer, range.startOffset),
        offsetIn(textOf(last), range.endContainer, range.endOffset),
      );
      return at && { ...at, ...(at.side === "old" && { against: base }) };
    },
    [base],
  );
  const rangeOf = useCallback(
    (annotation: Annotation) => {
      const side = annotation.side ?? "new";
      const at = locateText(side === "old" ? oldText : newText, annotation, starts[side]);
      const root = rootRef.current;
      if (!at || !root) return null;
      const [l1, c1] = lineAt(starts[side], at[0]);
      const [l2, c2] = lineAt(starts[side], at[1]);
      const row = (n: number) => root.querySelector<HTMLElement>(`[data-row][data-${side}="${n}"]`);
      const a = row(l1);
      const b = row(l2);
      return a && b ? textRange(textOf(a), c1, c2, textOf(b)) : null;
    },
    [newText, oldText, starts],
  );

  return (
    <Annotator
      path={path}
      {...notes}
      className="w-full rounded-xl bg-card px-4 py-6 md:px-6"
      locate={locate}
      rangeOf={rangeOf}
    >
      {heading}
      <div
        ref={rootRef}
        className="line-diff overflow-x-auto rounded-md border border-border bg-[var(--code-bg)] py-2 font-mono text-[12.5px] leading-5"
      >
        <div className="min-w-max">
          {rows.length === 0 && (
            <p className="annotation-exclude px-3 text-muted-foreground">Empty file.</p>
          )}
          {rows.map((row, i) =>
            "hidden" in row ? (
              opened.has(i) ? (
                row.hidden.map((entry, j) => line(entry, `${i}.${j}`))
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOpened((prev) => new Set(prev).add(i))}
                  className="annotation-exclude my-0.5 block w-full border-y border-dashed border-border px-3 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
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
    </Annotator>
  );
}
