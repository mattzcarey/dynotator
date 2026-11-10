import type { Annotation, Block } from "@dynotator/ui/types";
import { exportAnnotations } from "@dynotator/ui/utils/parser";

/** The feedback text when nothing was annotated. Agents key off it. */
export const NO_FEEDBACK_SENTENCE = "User reviewed the document and has no feedback.";

export interface FeedbackInput {
  mode: "plan" | "annotate";
  blocks: Block[];
  annotations: Annotation[];
}

/** The reviewer's feedback as markdown: what the decision posts. */
export function buildFeedback({ mode, blocks, annotations }: FeedbackInput): string {
  if (annotations.length === 0) return NO_FEEDBACK_SENTENCE;
  const plan = mode === "plan";
  return exportAnnotations(
    blocks,
    annotations,
    plan ? "Plan Feedback" : "Document Feedback",
    plan ? "plan" : "document",
  );
}
