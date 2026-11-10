import { AnnotationType, type Annotation } from "./annotations";
import type { Block } from "../markdown/blocks";
import { codeFenceFor } from "../markdown/structure";
import { formatAnswersSection, indexQuestions, parseAnswer } from "../questions/questions";

/** The feedback text when nothing was annotated. Agents key off it. */
export const NO_FEEDBACK = "User reviewed the document and has no feedback.";

export interface FeedbackInput {
  mode: "plan" | "annotate";
  blocks: Block[];
  annotations: Annotation[];
}

const quote = (text = "") => `> ${text.replace(/\n/g, "\n> ")}\n`;

const lineLabel = ({ startLine, endLine }: Block): string =>
  endLine > startLine ? `lines ${startLine}–${endLine}` : `line ${startLine}`;

/**
 * The reviewer's feedback as the markdown the agent reads: question answers first, then one
 * numbered entry per annotation in document order, each naming the source lines it is about.
 */
export function buildFeedback({ mode, blocks, annotations }: FeedbackInput): string {
  if (annotations.length === 0) return NO_FEEDBACK;
  const subject = mode === "plan" ? "plan" : "document";

  const answers = annotations.flatMap((a) => {
    const answer = a.questionAnswer && parseAnswer(a.questionAnswer);
    return answer ? [answer] : [];
  });
  const position = new Map(blocks.map((block, index) => [block.id, index]));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const notes = annotations
    .filter((a) => !a.questionAnswer)
    .toSorted((a, b) => (position.get(a.blockId) ?? -1) - (position.get(b.blockId) ?? -1));

  let out = `# ${mode === "plan" ? "Plan" : "Document"} Feedback\n\n`;
  if (answers.length > 0) out += formatAnswersSection(indexQuestions(blocks), answers);
  if (notes.length > 0) {
    out += `I've reviewed this ${subject} and have ${notes.length} piece${notes.length > 1 ? "s" : ""} of feedback:\n\n`;
  }
  notes.forEach((ann, index) => {
    out += `## ${index + 1}. `;
    const block = ann.type === AnnotationType.GLOBAL_COMMENT ? undefined : byId.get(ann.blockId);
    if (block) out += `(${lineLabel(block)}) `;
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
