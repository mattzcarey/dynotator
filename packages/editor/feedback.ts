import { AnnotationType, type Annotation, type Block } from "@dynotator/ui/types";
import { codeFenceFor } from "@dynotator/core/markdown-structure";
import {
  formatQuestionAnswersSection,
  indexQuestionBlocks,
  parseQuestionAnswer,
  questionExportItems,
  type QuestionAnswer,
} from "@dynotator/shared/question-block";

/** The feedback text when nothing was annotated. Agents key off it. */
export const NO_FEEDBACK_SENTENCE = "User reviewed the document and has no feedback.";

export interface FeedbackInput {
  mode: "plan" | "annotate";
  blocks: Block[];
  annotations: Annotation[];
}

/** Last source line of a block. */
const blockEndLine = (block: Block): number => {
  if (block.sourceLineCount && block.sourceLineCount > 0)
    return block.startLine + block.sourceLineCount - 1;
  if (!block.content) return block.startLine;
  const lines = block.content.split("\n").length;
  if (block.type === "code" || block.type === "directive") return block.startLine + lines + 1;
  if (block.alertKind) return block.startLine + lines;
  return block.startLine + lines - 1;
};

/** A comment as a markdown quote, every line of it. */
const quote = (text = "") => `> ${text.replace(/\n/g, "\n> ")}\n`;

const lineLabel = (block: Block | undefined): string | null => {
  if (!block || typeof block.startLine !== "number") return null;
  const end = blockEndLine(block);
  return end <= block.startLine ? `line ${block.startLine}` : `lines ${block.startLine}–${end}`;
};

/**
 * The reviewer's feedback as the markdown the agent reads: question answers
 * first, then one numbered entry per annotation in document order, each
 * naming the source lines it is about.
 */
export function buildFeedback({ mode, blocks, annotations }: FeedbackInput): string {
  if (annotations.length === 0) return NO_FEEDBACK_SENTENCE;
  const subject = mode === "plan" ? "plan" : "document";

  const answers: QuestionAnswer[] = [];
  const notes: Annotation[] = [];
  for (const ann of annotations) {
    const answer = ann.questionAnswer == null ? null : parseQuestionAnswer(ann.questionAnswer);
    if (answer) answers.push(answer);
    else notes.push(ann);
  }

  const position = new Map(blocks.map((block, index) => [block.id, index]));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const sorted = [...notes].sort(
    (a, b) => (position.get(a.blockId) ?? -1) - (position.get(b.blockId) ?? -1),
  );

  let out = `# ${mode === "plan" ? "Plan" : "Document"} Feedback\n\n`;
  if (answers.length > 0) {
    out += formatQuestionAnswersSection(questionExportItems(indexQuestionBlocks(blocks)), answers, {
      headingLevel: 2,
    });
  }
  if (sorted.length > 0) {
    out += `I've reviewed this ${subject} and have ${sorted.length} piece${sorted.length > 1 ? "s" : ""} of feedback:\n\n`;
  }
  sorted.forEach((ann, index) => {
    out += `## ${index + 1}. `;
    const label =
      ann.type === AnnotationType.GLOBAL_COMMENT ? null : lineLabel(byId.get(ann.blockId));
    if (label) out += `(${label}) `;
    if (ann.type === AnnotationType.DELETION) {
      const fence = codeFenceFor(ann.originalText);
      out += `Remove this\n${fence}\n${ann.originalText}\n${fence}\n> I don't want this in the ${subject}.\n`;
    } else if (ann.type === AnnotationType.GLOBAL_COMMENT) {
      out += `General feedback about the ${subject}\n${quote(ann.text)}`;
    } else {
      out += `Feedback on: "${ann.originalText}"\n${quote(ann.text)}`;
    }
    out += "\n";
  });
  return `${out}---\n`;
}
