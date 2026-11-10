import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Highlighter from "@plannotator/web-highlighter";
import { AnnotationType, type Annotation } from "./annotations";
import { Composer } from "./Composer";
import { BlockRenderer } from "../markdown/BlockRenderer";
import { computeListIndices, groupBlocks, headingSlugs, type Block } from "../markdown/blocks";
import { HIGHLIGHT_EVENT } from "../markdown/CodeBlock";
import { collectAnswers } from "../questions/answers";
import { indexQuestions, type QuestionAnswer } from "../questions/questions";

const Mermaid = lazy(() => import("../markdown/Mermaid"));

const MERMAID_LANGUAGES = new Set(["mermaid", "mmd"]);
const EXCLUDED = ".annotation-exclude";

type Action = "comment" | "delete" | "replace";

interface Pending {
  range: Range;
  rect: DOMRect;
  /** Set once an action that needs words was chosen. */
  action?: Exclude<Action, "delete">;
}

interface DocumentProps {
  blocks: Block[];
  annotations: Annotation[];
  selectedId: string | null;
  readOnly: boolean;
  onAdd: (annotation: Annotation) => void;
  onSelect: (id: string | null) => void;
  onAnswerQuestion: (blockId: string, answer: QuestionAnswer | null, key: string) => void;
}

const blockIdOf = (node: Node | null): string => {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest("[data-block-id]")?.getAttribute("data-block-id") ?? "";
};

const classFor = (type: AnnotationType) =>
  type === AnnotationType.DELETION ? "deletion" : "comment";

/**
 * The rendered document. Selecting text offers Comment / Delete / Replace;
 * the chosen range is painted with web-highlighter, whose serialized
 * positions are stored on the annotation so a draft repaints after a reload.
 */
export function Document({
  blocks,
  annotations,
  selectedId,
  readOnly,
  onAdd,
  onSelect,
  onAnswerQuestion,
}: DocumentProps) {
  const rootRef = useRef<HTMLElement>(null);
  const highlighterRef = useRef<Highlighter | null>(null);
  const paintedRef = useRef(new Set<string>());
  const select = useEffectEvent((id: string) => onSelect(id));
  const [pending, setPending] = useState<Pending | null>(null);

  const slugs = useMemo(() => headingSlugs(blocks), [blocks]);
  const questions = useMemo(() => {
    const list = indexQuestions(blocks);
    return { byBlock: new Map(list.map((q) => [q.blockId, q])), total: list.length };
  }, [blocks]);
  const answers = useMemo(() => collectAnswers(annotations), [annotations]);

  // Paint what is stored (draft restore, a new annotation) and drop what is gone.
  const paint = useCallback((list: Annotation[]) => {
    const highlighter = highlighterRef.current;
    if (!highlighter) return;
    const live = new Set<string>();
    for (const ann of list) {
      if (!ann.startMeta || !ann.endMeta) continue;
      live.add(ann.id);
      if (paintedRef.current.has(ann.id)) {
        if (highlighter.getDoms(ann.id).length > 0) continue;
        highlighter.remove(ann.id);
      }
      try {
        highlighter.fromStore(ann.startMeta, ann.endMeta, ann.originalText, ann.id);
        highlighter.addClass(classFor(ann.type), ann.id);
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
  }, []);
  // A code block's highlighting replaced its markup, and any marks in it.
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
    highlighter.on(Highlighter.event.CLICK, ({ id }: { id: string }) => select(id));
    highlighterRef.current = highlighter;
    const painted = paintedRef.current;
    const onHighlighted = () => repaint();
    root.addEventListener(HIGHLIGHT_EVENT, onHighlighted);
    return () => {
      root.removeEventListener(HIGHLIGHT_EVENT, onHighlighted);
      highlighter.dispose();
      highlighterRef.current = null;
      painted.clear();
    };
  }, []);

  useEffect(() => paint(annotations), [annotations, paint]);

  useEffect(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter || !selectedId || !paintedRef.current.has(selectedId)) return;
    highlighter.addClass("focused", selectedId);
    highlighter.getDoms(selectedId)[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
    return () => highlighter.removeClass("focused", selectedId);
  }, [selectedId]);

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
      setPending({ range: range.cloneRange(), rect: range.getBoundingClientRect() });
    });
  }, [readOnly]);

  const commit = (type: AnnotationType, text?: string) => {
    const highlighter = highlighterRef.current;
    if (!pending || !highlighter) return;
    // Null (despite its type) when the range held no paintable text.
    const source: ReturnType<Highlighter["fromRange"]> | null = highlighter.fromRange(
      pending.range,
    );
    window.getSelection()?.removeAllRanges();
    setPending(null);
    if (!source) return;
    highlighter.addClass(classFor(type), source.id);
    paintedRef.current.add(source.id);
    onAdd({
      id: source.id,
      blockId: blockIdOf(pending.range.startContainer),
      type,
      text,
      originalText: source.text,
      startMeta: source.startMeta,
      endMeta: source.endMeta,
    });
  };

  const dismiss = () => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      <article
        ref={rootRef}
        onMouseUp={onPointerUp}
        onTouchEnd={onPointerUp}
        className="w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10"
      >
        {groupBlocks(blocks).map((group) => {
          if (Array.isArray(group)) {
            const indices = computeListIndices(group);
            return (
              <div key={group[0].id} className="py-1">
                {group.map((block, i) => (
                  <BlockRenderer key={block.id} block={block} orderedIndex={indices[i]} />
                ))}
              </div>
            );
          }
          const block = group;
          if (block.type === "code" && MERMAID_LANGUAGES.has(block.language ?? "")) {
            return (
              <Suspense
                key={block.id}
                fallback={<pre className="my-5 text-xs">{block.content}</pre>}
              >
                <Mermaid block={block} />
              </Suspense>
            );
          }
          const question = questions.byBlock.get(block.id);
          return (
            <BlockRenderer
              key={block.id}
              block={block}
              headingId={slugs.get(block.id)}
              question={question}
              questionTotal={questions.total}
              questionAnswer={question ? answers.get(question.question.key) : undefined}
              onAnswerQuestion={readOnly ? undefined : onAnswerQuestion}
            />
          );
        })}
      </article>

      {pending && !pending.action && (
        <SelectionToolbar
          rect={pending.rect}
          onAction={(action) =>
            action === "delete"
              ? commit(AnnotationType.DELETION)
              : setPending({ ...pending, action })
          }
          onClose={dismiss}
        />
      )}
      {pending?.action && (
        <Composer
          rect={pending.rect}
          title={pending.action === "replace" ? "Replace with" : "Comment"}
          quote={pending.range.toString()}
          onCancel={dismiss}
          onSave={(text) =>
            commit(
              AnnotationType.COMMENT,
              pending.action === "replace" ? `Replace with: ${text}` : text,
            )
          }
        />
      )}
    </>
  );
}

function SelectionToolbar({
  rect,
  onAction,
  onClose,
}: {
  rect: DOMRect;
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
