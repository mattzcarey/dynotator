import { Suspense, lazy, useCallback, useEffect, useMemo } from "react";
import type { Annotation } from "./annotations";
import { Annotator } from "./Annotator";
import { BlockRenderer } from "../markdown/BlockRenderer";
import { computeListIndices, groupBlocks, headingSlugs, type Block } from "../markdown/blocks";
import { collectAnswers } from "../questions/answers";
import { indexQuestions, type QuestionAnswer } from "../questions/questions";
import type { Location } from "../files/paths";

const Mermaid = lazy(() => import("../markdown/Mermaid"));

const MERMAID_LANGUAGES = new Set(["mermaid", "mmd"]);

const blockIdOf = (node: Node | null): string => {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest("[data-block-id]")?.getAttribute("data-block-id") ?? "";
};

/** A rendered markdown file. A selection is located by the block it starts in. */
export function Document({
  path,
  blocks,
  annotations,
  selectedId,
  readOnly,
  target,
  onAdd,
  onSelect,
  onAnswerQuestion,
}: {
  path: string;
  blocks: Block[];
  /** This file's annotations. */
  annotations: Annotation[];
  selectedId: string | null;
  readOnly: boolean;
  /** A heading anchor or line to scroll to; a new object scrolls again. */
  target: Pick<Location, "lines" | "anchor"> | null;
  onAdd: (annotation: Annotation) => void;
  onSelect: (id: string | null) => void;
  onAnswerQuestion: (blockId: string, answer: QuestionAnswer | null, key: string) => void;
}) {
  const slugs = useMemo(() => headingSlugs(blocks), [blocks]);
  const questions = useMemo(() => {
    const list = indexQuestions(blocks);
    return { byBlock: new Map(list.map((q) => [q.blockId, q])), total: list.length };
  }, [blocks]);
  const answers = useMemo(() => collectAnswers(annotations), [annotations]);
  const byId = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);

  const locate = useCallback(
    (range: Range) => {
      const blockId = blockIdOf(range.startContainer);
      const block = byId.get(blockId);
      return { blockId, ...(block && { lines: { start: block.startLine, end: block.endLine } }) };
    },
    [byId],
  );

  useEffect(() => {
    if (!target) return;
    let el: Element | null = null;
    if (target.anchor) el = document.getElementById(target.anchor);
    else if (target.lines) {
      const line = target.lines.start;
      const block = blocks.find((b) => b.endLine >= line && b.id);
      if (block) el = document.querySelector(`[data-block-id="${block.id}"]`);
    }
    el?.scrollIntoView({ block: "start" });
  }, [blocks, target]);

  return (
    <Annotator
      path={path}
      annotations={annotations}
      selectedId={selectedId}
      readOnly={readOnly}
      className="w-full rounded-xl bg-card px-4 py-6 md:px-10 md:py-10"
      locate={locate}
      onAdd={onAdd}
      onSelect={onSelect}
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
            <Suspense key={block.id} fallback={<pre className="my-5 text-xs">{block.content}</pre>}>
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
    </Annotator>
  );
}
