import type { QuestionAnswer } from "../questions/questions";

export enum AnnotationType {
  DELETION = "DELETION",
  COMMENT = "COMMENT",
  GLOBAL_COMMENT = "GLOBAL_COMMENT",
}

/** A DOM text position, as web-highlighter serializes it to repaint a selection. */
export interface TextPosition {
  parentTagName: string;
  parentIndex: number;
  textOffset: number;
}

/**
 * One note of the reviewer's. Drafts store these, and annotate mode sends them to the agent
 * beside the feedback text.
 */
export interface Annotation {
  id: string;
  /** The block the selection starts in; "" for a general comment. */
  blockId: string;
  type: AnnotationType;
  /** The comment; absent on a deletion. */
  text?: string;
  /** The selected text. */
  originalText: string;
  /** Set on the one annotation that holds a question's answer. */
  questionAnswer?: QuestionAnswer;
  startMeta?: TextPosition;
  endMeta?: TextPosition;
}

/** A comment on the whole document. */
export const globalComment = (text: string): Annotation => ({
  id: `global-${crypto.randomUUID()}`,
  blockId: "",
  type: AnnotationType.GLOBAL_COMMENT,
  text,
  originalText: "",
});
