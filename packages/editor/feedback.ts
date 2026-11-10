import type { Annotation, Block, ImageAttachment } from "@dynotator/ui/types";
import { exportAnnotations } from "@dynotator/ui/utils/parser";
import { annotateFileFeedback, planDenyFeedback } from "@dynotator/shared/feedback-templates";

/** The feedback text when nothing was annotated. Agents and the CLI key off it. */
export const NO_FEEDBACK_SENTENCE = "User reviewed the document and has no feedback.";

export interface FeedbackInput {
  mode: "plan" | "annotate";
  blocks: Block[];
  annotations: Annotation[];
  globalAttachments: ImageAttachment[];
}

export const hasFeedback = (input: Pick<FeedbackInput, "annotations" | "globalAttachments">) =>
  input.annotations.length > 0 || input.globalAttachments.length > 0;

/** The reviewer's feedback as markdown: what deny / send feedback post. */
export function buildFeedback(input: FeedbackInput): string {
  if (!hasFeedback(input)) return NO_FEEDBACK_SENTENCE;
  const plan = input.mode === "plan";
  return exportAnnotations(
    input.blocks,
    input.annotations,
    input.globalAttachments,
    plan ? "Plan Feedback" : "Document Feedback",
    plan ? "plan" : "document",
  );
}

/** The copied feedback carries the same framing the agent receives. */
export function wrapCopiedFeedback(
  feedback: string,
  mode: "plan" | "annotate",
  documentName: string,
): string {
  return mode === "plan"
    ? planDenyFeedback(feedback)
    : annotateFileFeedback(feedback, { filePath: documentName });
}
