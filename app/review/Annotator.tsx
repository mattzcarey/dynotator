import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import Highlighter from "@plannotator/web-highlighter";
import { isDeletion, type Annotation, type AnnotationType } from "./annotations";
import { Composer } from "./Composer";
import { HIGHLIGHT_EVENT } from "../markdown/highlight";

const EXCLUDED = ".annotation-exclude";

type Action = "comment" | "delete" | "replace";

/**
 * Where a selection sits in the view: its block, lines, side and column, and its text when the
 * view knows it better than the highlighter (which folds whitespace). Null: not annotatable.
 */
export type Where = Pick<Annotation, "blockId" | "lines" | "side" | "col" | "against"> & {
  original?: string;
};
export type Locate = (range: Range) => Where | null;

interface Pending {
  range: Range;
  rect: DOMRect;
  where: Where;
  /** Set once an action that needs words was chosen. */
  action?: Exclude<Action, "delete">;
}

const classFor = (a: Pick<Annotation, "type" | "text">) => (isDeletion(a) ? "deletion" : "comment");

/**
 * One view's content, annotatable. Selecting text offers Comment / Delete / Replace (removed
 * lines in a diff: Comment). Highlights are painted with web-highlighter: from the positions the
 * annotation stored when `keepPositions` (rendered markdown, whose text is not the source), else
 * from the range the view finds for it (`rangeOf`), so a note made in one view shows in another.
 */
export function Annotator({
  path,
  annotations,
  sentIds,
  selectedId,
  readOnly,
  className,
  keepPositions = false,
  locate,
  rangeOf,
  onAdd,
  onSelect,
  children,
}: {
  path: string;
  /** What to paint here: this view's draft and sent annotations. */
  annotations: Annotation[];
  sentIds: ReadonlySet<string>;
  selectedId: string | null;
  readOnly: boolean;
  className: string;
  keepPositions?: boolean;
  locate: Locate;
  rangeOf?: (annotation: Annotation) => Range | null;
  onAdd: (annotation: Annotation) => void;
  onSelect: (id: string | null) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const highlighterRef = useRef<Highlighter | null>(null);
  /** The id `fromRange` gives the highlight it paints next. */
  const nextIdRef = useRef<string | null>(null);
  const paintedRef = useRef(new Set<string>());
  const selectedRef = useRef(selectedId);
  const focusedRef = useRef<string | null>(null);
  const scrolledRef = useRef<string | null>(null);
  const select = useEffectEvent((id: string) => onSelect(id));
  const [pending, setPending] = useState<Pending | null>(null);

  // Mark the selected annotation, and bring it into view the first time it is on the page:
  // after selecting it, or after the paint that put it there (the file just opened).
  const focus = useCallback(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter) return;
    const id = selectedRef.current;
    if (focusedRef.current && focusedRef.current !== id) {
      highlighter.removeClass("focused", focusedRef.current);
      focusedRef.current = null;
    }
    if (!id || !paintedRef.current.has(id)) return;
    highlighter.addClass("focused", id);
    focusedRef.current = id;
    if (scrolledRef.current === id) return;
    scrolledRef.current = id;
    highlighter.getDoms(id)[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const paintOne = useCallback(
    (highlighter: Highlighter, ann: Annotation): boolean => {
      if (keepPositions && ann.startMeta && ann.endMeta) {
        return !!highlighter.fromStore(ann.startMeta, ann.endMeta, ann.original ?? "", ann.id);
      }
      const range = rangeOf?.(ann);
      if (!range) return false;
      nextIdRef.current = ann.id;
      try {
        return !!highlighter.fromRange(range);
      } finally {
        nextIdRef.current = null;
      }
    },
    [keepPositions, rangeOf],
  );

  // Paint what is listed (a restored draft, a new or sent annotation) and drop what is gone.
  const paint = useCallback(
    (list: Annotation[]) => {
      const highlighter = highlighterRef.current;
      if (!highlighter) return;
      const live = new Set<string>();
      for (const ann of list) {
        if (ann.type === "answer" || !ann.lines) continue;
        live.add(ann.id);
        if (paintedRef.current.has(ann.id)) {
          if (highlighter.getDoms(ann.id).length > 0) {
            // Sent since it was painted.
            if (sentIds.has(ann.id)) highlighter.addClass("sent", ann.id);
            continue;
          }
          highlighter.remove(ann.id);
          paintedRef.current.delete(ann.id);
        }
        try {
          if (!paintOne(highlighter, ann)) continue;
          highlighter.addClass(classFor(ann), ann.id);
          if (sentIds.has(ann.id)) highlighter.addClass("sent", ann.id);
          paintedRef.current.add(ann.id);
        } catch {
          // The text moved (a revision): the annotation stays listed, unpainted.
        }
      }
      for (const id of paintedRef.current) {
        if (live.has(id)) continue;
        highlighter.remove(id);
        paintedRef.current.delete(id);
      }
      focus();
    },
    [focus, paintOne, sentIds],
  );
  // Highlighting code, or opening a fold, replaced markup and any marks in it.
  const repaint = useEffectEvent(() => paint(annotations));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const highlighter = new Highlighter({
      $root: root,
      exceptSelectors: [EXCLUDED, "button"],
      wrapTag: "mark",
      style: { className: "annotation-highlight" },
    });
    // Typed as returning a string, but undefined is what makes it fall back to a random id.
    highlighter.hooks.Render.UUID.tap((() => nextIdRef.current ?? undefined) as () => string);
    highlighter.on(Highlighter.event.CLICK, ({ id }: { id: string }) => select(id));
    highlighterRef.current = highlighter;
    const marks = paintedRef.current;
    const onHighlighted = () => repaint();
    root.addEventListener(HIGHLIGHT_EVENT, onHighlighted);
    return () => {
      root.removeEventListener(HIGHLIGHT_EVENT, onHighlighted);
      highlighter.dispose();
      highlighterRef.current = null;
      marks.clear();
    };
  }, []);

  useEffect(() => paint(annotations), [annotations, paint]);

  useEffect(() => {
    selectedRef.current = selectedId;
    focus();
  }, [focus, selectedId]);

  const onPointerUp = useCallback(() => {
    if (readOnly) return;
    // Let the browser settle the selection first.
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      const root = rootRef.current;
      if (!selection || selection.isCollapsed || !root || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const startEl =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      if (startEl?.closest(EXCLUDED) || !range.toString().trim()) return;
      const where = locate(range);
      if (!where) return;
      setPending({ range: range.cloneRange(), rect: range.getBoundingClientRect(), where });
    });
  }, [locate, readOnly]);

  const commit = (type: AnnotationType, text: string) => {
    const highlighter = highlighterRef.current;
    if (!pending || !highlighter) return;
    const { where } = pending;
    // Null (despite its type) when the range held no paintable text.
    const source: ReturnType<Highlighter["fromRange"]> | null = highlighter.fromRange(
      pending.range,
    );
    window.getSelection()?.removeAllRanges();
    setPending(null);
    if (!source) return;
    highlighter.addClass(classFor({ type, text }), source.id);
    paintedRef.current.add(source.id);
    scrolledRef.current = source.id;
    onAdd({
      id: source.id,
      path,
      type,
      ...(where.lines && { lines: where.lines }),
      ...(where.side && { side: where.side }),
      original: where.original ?? source.text,
      text,
      ...(where.blockId && { blockId: where.blockId }),
      ...(where.col !== undefined && { col: where.col }),
      ...(where.against !== undefined && { against: where.against }),
      ...(keepPositions && { startMeta: source.startMeta, endMeta: source.endMeta }),
    });
  };

  const dismiss = () => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      <article ref={rootRef} onMouseUp={onPointerUp} onTouchEnd={onPointerUp} className={className}>
        {children}
      </article>

      {pending && !pending.action && (
        <SelectionToolbar
          rect={pending.rect}
          commentOnly={pending.where.side === "old"}
          onAction={(action) =>
            action === "delete" ? commit("replacement", "") : setPending({ ...pending, action })
          }
          onClose={dismiss}
        />
      )}
      {pending?.action && (
        <Composer
          rect={pending.rect}
          title={pending.action === "replace" ? "Replace with" : "Comment"}
          quote={pending.where.original ?? pending.range.toString()}
          onCancel={dismiss}
          onSave={(text) => commit(pending.action === "replace" ? "replacement" : "comment", text)}
        />
      )}
    </>
  );
}

function SelectionToolbar({
  rect,
  commentOnly,
  onAction,
  onClose,
}: {
  rect: DOMRect;
  /** Removed lines: there is nothing left to delete or replace. */
  commentOnly: boolean;
  onAction: (action: Action) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const top = Math.max(8, rect.top - 44);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - 120), window.innerWidth - 248);
  const button = "h-8 rounded-full px-3 text-xs font-medium transition-colors hover:bg-muted";
  return (
    <div
      role="toolbar"
      aria-label="Annotate selection"
      className="annotation-toolbar fixed z-[80] flex items-center gap-0.5 rounded-full border border-border bg-popover p-0.5 shadow-lg"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={`${button} text-primary`}
        onClick={() => onAction("comment")}
      >
        Comment
      </button>
      {!commentOnly && (
        <>
          <button
            type="button"
            className={`${button} text-destructive`}
            onClick={() => onAction("delete")}
          >
            Delete
          </button>
          <button type="button" className={button} onClick={() => onAction("replace")}>
            Replace
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Cancel"
        className={`${button} text-muted-foreground`}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
