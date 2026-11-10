import type { QuestionAnswer } from "@dynotator/core/question-block";

export type { QuestionAnswer } from "@dynotator/core/question-block";

export enum AnnotationType {
  DELETION = "DELETION",
  COMMENT = "COMMENT",
  GLOBAL_COMMENT = "GLOBAL_COMMENT",
}

/** DOM-relative text position web-highlighter uses to repaint a selection. */
export interface AnnotationTextMeta {
  parentTagName: string;
  parentIndex: number;
  textOffset: number;
}

export interface Annotation {
  id: string;
  /** The block the selection starts in ("" for a general comment). */
  blockId: string;
  type: AnnotationType;
  /** The comment (absent on a deletion). */
  text?: string;
  /** The selected text. */
  originalText: string;
  createdA: number;
  /** The reviewer's answer to a `:::question` block; exported in its own section. */
  questionAnswer?: QuestionAnswer;
  startMeta?: AnnotationTextMeta;
  endMeta?: AnnotationTextMeta;
}

export type AlertKind = "note" | "tip" | "warning" | "caution" | "important";

export interface Block {
  id: string;
  type:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "list-item"
    | "code"
    | "hr"
    | "table"
    | "html"
    | "directive"
    | "math";
  /** Plain text, or raw (unsanitized) HTML for `html`. */
  content: string;
  /** Heading level (1-6) or list indentation. */
  level?: number;
  /** Code fence language. */
  language?: string;
  /** Task list item state; undefined when not a task item. */
  checked?: boolean;
  ordered?: boolean;
  /** The number an ordered item's marker carries ("5." → 5). */
  orderedStart?: number;
  /** `> [!NOTE]` style alerts. */
  alertKind?: AlertKind;
  /** `:::kind` directive containers. */
  directiveKind?: string;
  order: number;
  /** 1-based source line. */
  startLine: number;
  /** Source lines consumed, when it differs from the content's lines. */
  sourceLineCount?: number;
}
