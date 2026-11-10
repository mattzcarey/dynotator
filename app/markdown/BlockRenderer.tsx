import React from "react";
import type { Block } from "./blocks";
import { InlineMarkdown } from "./Inline";
import { CodeBlock } from "./CodeBlock";
import { HtmlBlock } from "./HtmlBlock";
import { Alert, Blockquote, NestedBlocks } from "./Nested";
import { QuestionCard, type QuestionCardProps } from "../questions/QuestionCard";
import { indexQuestions, isQuestionDirective, type IndexedQuestion } from "../questions/questions";

/** `data-block-id` for document blocks; nested blocks ("" ids) carry none and belong to their parent. */
export const blockId = (block: Block): string | undefined => block.id || undefined;

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const HEADING_CLASS: Record<number, string> = {
  1: "mt-6 mb-5 text-[1.75rem] leading-[1.15] font-medium tracking-[-0.025em] first:mt-0",
  2: "mt-10 mb-3 text-xl font-medium tracking-[-0.02em]",
  3: "mt-7 mb-2 text-base font-medium tracking-[-0.01em]",
};

export const BlockRenderer: React.FC<{
  block: Block;
  /** A list item's number; null for a bullet. */
  orderedIndex?: number | null;
  headingId?: string;
  /** This block's entry in the document's question index. Without it a question block is
   *  parsed on its own and shows no "N of M". */
  question?: IndexedQuestion;
  questionTotal?: number;
  questionAnswer?: QuestionCardProps["answer"];
  onAnswerQuestion?: QuestionCardProps["onAnswer"];
}> = ({ block, orderedIndex, headingId, question, questionTotal, questionAnswer, onAnswerQuestion }) => {
  const id = blockId(block);
  switch (block.type) {
    case "heading": {
      const Tag = HEADING_TAGS[(block.level ?? 1) - 1] ?? "h6";
      const className =
        HEADING_CLASS[block.level ?? 1] ?? "mt-5 mb-2 text-[15px] font-medium text-foreground/90";
      return (
        <Tag id={headingId} className={className} data-block-id={id}>
          <InlineMarkdown text={block.content} />
        </Tag>
      );
    }
    case "blockquote":
      return block.alertKind ? (
        <Alert id={id} kind={block.alertKind} body={block.content} />
      ) : (
        <Blockquote id={id} markdown={block.content} />
      );
    case "list-item":
      return <ListItem block={block} orderedIndex={orderedIndex ?? null} />;
    case "code":
      return <CodeBlock block={block} />;
    case "table":
      return <Table block={block} />;
    case "hr":
      return <hr className="my-10 border-dashed border-border-strong/70" data-block-id={id} />;
    case "html":
      return <HtmlBlock block={block} />;
    case "directive": {
      const indexed =
        block.id && isQuestionDirective(block.directiveKind)
          ? (question ?? indexQuestions([block]).map((q) => ({ ...q, number: 0 }))[0])
          : undefined;
      // A question block without a prompt, or one nested in a quote, is an ordinary callout.
      if (indexed) {
        return (
          <QuestionCard
            blockId={block.id}
            indexed={indexed}
            total={questionTotal ?? 0}
            answer={questionAnswer}
            onAnswer={onAnswerQuestion}
          />
        );
      }
      const kind = block.directiveKind ?? "note";
      return (
        <div className={`directive directive-${kind} my-4 rounded-md border px-4 py-3`} data-block-id={id}>
          <div className="directive-title mb-1 text-xs font-semibold tracking-wide uppercase">
            {kind}
          </div>
          <NestedBlocks markdown={block.content} className="text-[15px] leading-relaxed" />
        </div>
      );
    }
    default:
      return (
        <p className="mb-4 text-[15px] leading-relaxed text-foreground/90" data-block-id={id}>
          <InlineMarkdown text={block.content} />
        </p>
      );
  }
};

/**
 * The marker is `annotation-exclude` and `select-none`: it is never part of a selection, so it
 * must not be painted into a highlight either, or a highlight across two items would not match
 * its stored text on restore.
 */
function ListItem({ block, orderedIndex }: { block: Block; orderedIndex: number | null }) {
  const { checked } = block;
  const paragraphs = block.content.split(/\n\n+/);
  const textClass = `text-sm leading-relaxed ${checked ? "text-muted-foreground line-through" : "text-foreground/90"}`;
  return (
    <div
      className="my-1.5 flex items-start gap-3"
      data-block-id={blockId(block)}
      style={{ marginLeft: `${(block.level ?? 0) * 1.25}rem` }}
    >
      <span className="annotation-exclude flex shrink-0 items-center gap-1 self-start select-none">
        {orderedIndex !== null && (
          <span className="min-w-6 text-right font-mono text-[0.8em] leading-[1.9] text-muted-foreground tabular-nums">
            {orderedIndex}.
          </span>
        )}
        {checked !== undefined ? (
          <svg
            className={`mt-[3px] h-4 w-4 ${checked ? "text-primary" : "text-muted-foreground/50"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={checked ? 2.5 : 2}
          >
            {checked ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            ) : (
              <circle cx="12" cy="12" r="9" />
            )}
          </svg>
        ) : (
          orderedIndex === null && <span className="text-primary/60">•</span>
        )}
      </span>
      {paragraphs.length === 1 ? (
        <span className={textClass}>
          <InlineMarkdown text={block.content} />
        </span>
      ) : (
        <div className={textClass}>
          {paragraphs.map((paragraph, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>
              <InlineMarkdown text={paragraph} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const tableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));

function Table({ block }: { block: Block }) {
  const [header = "", ...body] = block.content.split("\n").filter((line) => line.trim());
  const rows = body.filter((line) => !/^[|\-:\s]+$/.test(line.trim())).map(tableRow);
  return (
    <div className="my-5 overflow-x-auto rounded-md border border-border" data-block-id={blockId(block)}>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-0">
            {tableRow(header).map((cell, i) => (
              <th key={i} className="px-3 py-2 text-left text-[13px] font-medium text-foreground">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-b-0 hover:bg-surface-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground/85">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
