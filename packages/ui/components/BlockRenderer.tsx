import React from "react";
import type { Block } from "../types";
import { InlineMarkdown } from "./InlineMarkdown";
import { ListItemBody } from "./ListItemBody";
import { CodeBlock } from "./blocks/CodeBlock";
import { HtmlBlock } from "./blocks/HtmlBlock";
import { Callout } from "./blocks/Callout";
import { AlertBlock } from "./blocks/AlertBlock";
import { BlockquoteBlock } from "./blocks/BlockquoteBlock";
import { TableBlock } from "./blocks/TableBlock";
import { QuestionBlock, type QuestionBlockProps } from "./blocks/QuestionBlock";
import {
  indexQuestionBlocks,
  isQuestionDirectiveKind,
  type IndexedQuestion,
  type QuestionAnswer,
} from "@dynotator/core/question-block";

/** A question block outside the document's index (the plan diff): parsed
 *  alone, unnumbered. */
const standaloneQuestion = (block: Block): IndexedQuestion | undefined => {
  const [indexed] = indexQuestionBlocks([block]);
  return indexed ? { ...indexed, number: 0 } : undefined;
};

export const BlockRenderer: React.FC<{
  block: Block;
  orderedIndex?: number | null;
  headingAnchorId?: string;
  /** `:::question` blocks: this block's entry in the document's question
   *  index and the document's question count. Absent, a question block is
   *  parsed on its own and shows no "N of M". */
  question?: IndexedQuestion;
  questionTotal?: number;
  questionAnswer?: QuestionAnswer;
  onAnswerQuestion?: QuestionBlockProps["onAnswer"];
}> = ({ block, orderedIndex, headingAnchorId, question, questionTotal, questionAnswer, onAnswerQuestion }) => {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level || 1}` as React.ElementType;
      const styles =
        {
          1: "text-[1.75rem] leading-[1.15] font-medium tracking-[-0.025em] mb-5 mt-6 first:mt-0",
          2: "text-xl font-medium tracking-[-0.02em] mb-3 mt-10",
          3: "text-base font-medium tracking-[-0.01em] mb-2 mt-7",
        }[block.level || 1] || "text-[15px] font-medium mb-2 mt-5 text-foreground/90";
      return (
        <Tag
          id={headingAnchorId}
          className={styles}
          data-block-id={block.id}
          data-block-type="heading"
        >
          <InlineMarkdown
            text={block.content}
          />
        </Tag>
      );
    }

    case "blockquote": {
      if (block.alertKind) {
        return (
          <AlertBlock
            blockId={block.id}
            kind={block.alertKind}
            body={block.content}
          />
        );
      }
      // One quote whatever it holds: its content is the quote's own markdown
      // (paragraphs, code fences, lists, nested quotes), see BlockquoteBlock.
      return (
        <BlockquoteBlock
          block={block}
        />
      );
    }

    case "list-item": {
      const checked = block.checked;
      const done = checked === true;
      return (
        <div
          className="flex items-start gap-3 my-1.5"
          data-block-id={block.id}
          data-rich-list-level={block.level || 0}
          data-rich-list-kind={block.ordered ? "ol" : "ul"}
          data-rich-list-index={orderedIndex ?? undefined}
          data-rich-list-checked={checked === undefined ? undefined : String(checked)}
          style={{ marginLeft: `${(block.level || 0) * 1.25}rem` }}
        >
          <ListItemBody
            ordered={block.ordered}
            orderedIndex={orderedIndex}
            checked={checked}
            textClassName={`text-sm leading-relaxed ${done ? "text-muted-foreground line-through" : "text-foreground/90"}`}
            content={block.content}
            renderInline={(text) => <InlineMarkdown text={text} />}
          />
        </div>
      );
    }

    case "code":
      return <CodeBlock block={block} isHovered={false} />;

    case "table":
      return (
        <TableBlock
          block={block}
        />
      );

    case "math":
      return (
        <pre
          className="my-5 overflow-x-auto font-mono text-sm text-foreground"
          data-block-id={block.id}
        >
          {block.content.trim()}
        </pre>
      );

    case "hr":
      return (
        <hr className="border-dashed border-border-strong/70 my-10" data-block-id={block.id} />
      );

    case "html":
      return (
        <HtmlBlock block={block} />
      );

    case "directive": {
      const kind = block.directiveKind || "note";
      if (isQuestionDirectiveKind(kind)) {
        // An unparseable question (no prompt) falls through to the callout.
        const indexed = question ?? standaloneQuestion(block);
        if (indexed) {
          return (
            <QuestionBlock
              blockId={block.id}
              indexed={indexed}
              total={questionTotal ?? 0}
              answer={questionAnswer}
              onAnswer={onAnswerQuestion}
            />
          );
        }
      }
      return (
        <Callout
          blockId={block.id}
          kind={kind}
          body={block.content}
          containerClassName={`directive directive-${kind} my-4 px-4 py-3 rounded-md border`}
          blockType="directive"
          kindAttribute={kind}
        />
      );
    }

    default:
      return (
        <p
          className="mb-4 leading-relaxed text-foreground/90 text-[15px]"
          data-block-id={block.id}
          // Blank lines the person typed (parse option keepBlankLines): N lines in all. This margin collapses with the
          // previous block's bottom margin (mb-4), so the gap is max(the two), i.e. N lines, not N lines plus 1rem.
          style={block.blankLinesBefore ? { marginTop: `${block.blankLinesBefore}lh` } : undefined}
          data-blank-lines={block.blankLinesBefore}
        >
          <InlineMarkdown
            text={block.content}
          />
        </p>
      );
  }
};
