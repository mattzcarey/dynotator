import { useMemo, useState } from "react";
import { isDeletion, isGeneral, isNote, type Annotation } from "./annotations";
import { formatWhen, type Submission } from "./events";
import type { QuestionRow } from "../questions/answers";

export interface PanelQuestion extends QuestionRow {
  path: string;
}

const labelOf = (a: Annotation) =>
  isGeneral(a)
    ? "General"
    : isDeletion(a)
      ? "Delete"
      : a.type === "replacement"
        ? "Replace"
        : "Comment";

const lineLabel = ({ lines, side }: Annotation) =>
  !lines
    ? ""
    : `${lines.end > lines.start ? `L${lines.start}-${lines.end}` : `L${lines.start}`}${side === "old" ? " removed" : ""}`;

const mono = "font-mono text-[11px] tracking-[0.04em] text-muted-foreground";
const groupLabel = `flex w-full items-center gap-2 px-1 pt-2 pb-1 text-left ${mono}`;

/** One file's notes first, then the tree's order, then the general comments. */
function byFile(list: Annotation[], files: readonly string[], current: string) {
  const byPath = new Map<string, Annotation[]>();
  for (const a of list) byPath.set(a.path, [...(byPath.get(a.path) ?? []), a]);
  const rank = new Map(files.map((path, i) => [path, i]));
  return [...byPath.keys()]
    .toSorted(
      (a, b) =>
        Number(b === current) - Number(a === current) ||
        Number(a === "") - Number(b === "") ||
        (rank.get(a) ?? files.length) - (rank.get(b) ?? files.length) ||
        a.localeCompare(b),
    )
    .map((path) => ({
      path,
      items: (byPath.get(path) ?? []).toSorted(
        (a, b) => (a.lines?.start ?? 0) - (b.lines?.start ?? 0),
      ),
    }));
}

/**
 * The review's notes and the questions' progress. Unsent notes, editable: with one file in the
 * order they were made, with several grouped by file. Then what was sent on this version, per
 * submission, read-only.
 */
export function Panel({
  editable,
  submissions,
  approved,
  questions,
  files,
  current,
  selectedId,
  closed,
  onSelect,
  onOpenFile,
  onDelete,
  onEdit,
  onSelectQuestion,
  onGlobalComment,
}: {
  editable: Annotation[];
  submissions: Submission[];
  /** The version is approved: unsent notes would change that. */
  approved: boolean;
  questions: PanelQuestion[];
  /** Every file, in tree order; one for a single-file review. */
  files: readonly string[];
  current: string;
  selectedId: string | null;
  closed: boolean;
  onSelect: (annotation: Annotation) => void;
  onOpenFile: (path: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onSelectQuestion: (question: PanelQuestion) => void;
  onGlobalComment: () => void;
}) {
  const single = files.length <= 1;
  const notes = useMemo(() => editable.filter(isNote), [editable]);
  const groups = useMemo(
    () => (single ? [{ path: null, items: notes }] : byFile(notes, files, current)),
    [current, files, notes, single],
  );
  const sent = submissions
    .map((s) => ({ ...s, annotations: s.annotations.filter(isNote) }))
    .filter((s) => s.annotations.length > 0);

  const card = (
    annotation: Annotation,
    readOnly: boolean,
    where = !single || !!annotation.side,
  ) => (
    <Card
      key={annotation.id}
      annotation={annotation}
      where={where && annotation.lines ? lineLabel(annotation) : null}
      selected={annotation.id === selectedId}
      readOnly={readOnly}
      onSelect={() => onSelect(annotation)}
      onDelete={() => onDelete(annotation.id)}
      onEdit={(text) => onEdit(annotation.id, text)}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className={mono}>Annotations {notes.length > 0 && `(${notes.length})`}</h2>
        {!closed && (
          <button
            type="button"
            onClick={onGlobalComment}
            className="h-7 rounded-full border border-border px-3 text-xs hover:bg-muted"
          >
            General comment
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {questions.length > 0 && (
          <section className="mb-2">
            <h3 className={`px-1 pb-1 ${mono}`}>
              Questions {questions.filter((q) => q.status !== "open").length}/{questions.length}
            </h3>
            {questions.map((row) => (
              <button
                type="button"
                key={`${row.path}\n${row.key}`}
                onClick={() => onSelectQuestion(row)}
                className="flex w-full justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate">{row.prompt}</span>
                  {!single && (
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                      {row.path}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">{row.status}</span>
              </button>
            ))}
          </section>
        )}
        {approved && notes.length > 0 && !closed && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            This version is approved. Sending these as feedback withdraws the approval; approving
            again sends them as notes.
          </p>
        )}
        {notes.length === 0 && sent.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {closed
              ? "Nothing was sent on this version."
              : `Select text in ${single ? "the document" : "a file"} to comment on it.`}
          </p>
        ) : (
          groups.map(({ path, items }) =>
            path === null ? (
              items.map((a) => card(a, closed))
            ) : (
              <section key={path || "general"} className="flex flex-col gap-1.5">
                {path ? (
                  <button
                    type="button"
                    title={path}
                    onClick={() => onOpenFile(path)}
                    className={`${groupLabel} hover:text-foreground`}
                  >
                    <span
                      className={`min-w-0 truncate ${path === current ? "text-foreground" : ""}`}
                    >
                      {path}
                    </span>
                    <span className="ml-auto shrink-0">{items.length}</span>
                  </button>
                ) : (
                  <h3 className={groupLabel}>
                    General<span className="ml-auto shrink-0">{items.length}</span>
                  </h3>
                )}
                {items.map((a) => card(a, closed))}
              </section>
            ),
          )
        )}
        {sent.length > 0 && (
          <section
            aria-label="Sent"
            className="mt-3 flex flex-col gap-1.5 border-t border-dashed border-border pt-2"
          >
            <h3 className={`px-1 ${mono}`}>Sent</h3>
            {sent.map((s) => (
              <div key={s.seq} className="flex flex-col gap-1.5">
                <p className={`px-1 pt-1 text-[10.5px] ${mono}`}>
                  {formatWhen(s.at)} · {s.type === "approved" ? "with approval" : "feedback"}
                  {s.by && ` · ${s.by}`}
                </p>
                {s.annotations.map((a) => (
                  <div key={a.id}>
                    {!single && a.path && (
                      <p
                        className="truncate px-1 font-mono text-[10.5px] text-muted-foreground"
                        title={a.path}
                      >
                        {a.path}
                      </p>
                    )}
                    {card(a, true)}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Card({
  annotation,
  where,
  selected,
  readOnly,
  onSelect,
  onDelete,
  onEdit,
}: {
  annotation: Annotation;
  /** The lines it is about, in a review of several files or a diff. */
  where: string | null;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const deletion = isDeletion(annotation);
  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer rounded-md border px-3 py-2 text-left ${selected ? "border-primary/60 bg-primary/5" : `bg-card hover:border-foreground/30 ${readOnly ? "border-dashed border-border" : "border-border"}`}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`font-mono text-[11px] tracking-[0.04em] ${deletion ? "text-destructive" : "text-primary"}`}
        >
          {labelOf(annotation)}
        </span>
        {where && <span className="font-mono text-[11px] text-muted-foreground">{where}</span>}
        {!readOnly && (
          <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {!deletion && (
              <button
                type="button"
                className="rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(annotation.text ?? "");
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="rounded px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              Remove
            </button>
          </span>
        )}
      </div>
      {annotation.original && (
        <p className="mb-1 line-clamp-2 font-mono text-[11px] text-muted-foreground/80">
          “{annotation.original}”
        </p>
      )}
      {editing !== null ? (
        <div onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && editing.trim()) {
                onEdit(editing.trim());
                setEditing(null);
              } else if (e.key === "Escape") setEditing(null);
            }}
            className="w-full rounded-md border border-border bg-card px-2 py-1 text-base md:text-[13px]"
          />
          <div className="mt-1 flex justify-end gap-1">
            <button type="button" className="px-2 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-primary px-3 text-xs text-primary-foreground"
              onClick={() => {
                if (!editing.trim()) return;
                onEdit(editing.trim());
                setEditing(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        annotation.text && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{annotation.text}</p>
        )
      )}
    </div>
  );
}
