import { useMemo, useState } from "react";
import { AnnotationType, type Annotation } from "./annotations";
import type { QuestionRow } from "../questions/answers";

const LABEL: Record<AnnotationType, string> = {
  [AnnotationType.COMMENT]: "Comment",
  [AnnotationType.DELETION]: "Delete",
  [AnnotationType.GLOBAL_COMMENT]: "General",
};

export interface PanelQuestion extends QuestionRow {
  path: string;
}

const lineLabel = ({ start, end }: { start: number; end: number }) =>
  end > start ? `L${start}-${end}` : `L${start}`;

const groupLabel =
  "flex w-full items-center gap-2 px-1 pt-2 pb-1 text-left font-mono text-[11px] tracking-[0.04em] text-muted-foreground";

/**
 * The review's annotations and the questions' progress. With one file, in the order they were
 * made; with several, grouped by file: the open one first, then the tree's order, then the
 * general comments.
 */
export function Panel({
  annotations,
  questions,
  files,
  current,
  selectedId,
  readOnly,
  onSelect,
  onOpenFile,
  onDelete,
  onEdit,
  onSelectQuestion,
  onGlobalComment,
}: {
  annotations: Annotation[];
  questions: PanelQuestion[];
  /** Every file, in tree order; one for a single-file review. */
  files: readonly string[];
  current: string;
  selectedId: string | null;
  readOnly: boolean;
  onSelect: (annotation: Annotation) => void;
  onOpenFile: (path: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onSelectQuestion: (question: PanelQuestion) => void;
  onGlobalComment: () => void;
}) {
  const comments = useMemo(
    () => annotations.filter((a) => a.questionAnswer == null),
    [annotations],
  );
  const single = files.length <= 1;
  const groups = useMemo(() => {
    if (single) return [{ path: null, items: comments }];
    const byPath = new Map<string, Annotation[]>();
    for (const a of comments) byPath.set(a.path, [...(byPath.get(a.path) ?? []), a]);
    const rank = new Map(files.map((path, i) => [path, i]));
    const order = [...byPath.keys()].toSorted(
      (a, b) =>
        Number(b === current) - Number(a === current) ||
        Number(a === "") - Number(b === "") ||
        (rank.get(a) ?? files.length) - (rank.get(b) ?? files.length) ||
        a.localeCompare(b),
    );
    return order.map((path) => ({
      path,
      items: (byPath.get(path) ?? []).toSorted(
        (a, b) => (a.lines?.start ?? 0) - (b.lines?.start ?? 0),
      ),
    }));
  }, [comments, current, files, single]);

  const card = (annotation: Annotation) => (
    <Card
      key={annotation.id}
      annotation={annotation}
      where={!single && annotation.lines ? lineLabel(annotation.lines) : null}
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
        <h2 className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
          Annotations {comments.length > 0 && `(${comments.length})`}
        </h2>
        {!readOnly && (
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
            <h3 className="px-1 pb-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
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
        {comments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Select text in {single ? "the document" : "a file"} to comment on it.
          </p>
        ) : (
          groups.map(({ path, items }) =>
            path === null ? (
              items.map(card)
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
                {items.map(card)}
              </section>
            ),
          )
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
  /** The lines it is about, in a review of several files. */
  where: string | null;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const isDeletion = annotation.type === AnnotationType.DELETION;
  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer rounded-md border px-3 py-2 text-left ${selected ? "border-primary/60 bg-primary/5" : "border-border bg-card hover:border-foreground/30"}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`font-mono text-[11px] tracking-[0.04em] ${isDeletion ? "text-destructive" : "text-primary"}`}
        >
          {LABEL[annotation.type]}
        </span>
        {where && <span className="font-mono text-[11px] text-muted-foreground">{where}</span>}
        {!readOnly && (
          <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {!isDeletion && (
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
      {annotation.originalText && (
        <p className="mb-1 line-clamp-2 font-mono text-[11px] text-muted-foreground/80">
          “{annotation.originalText}”
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
