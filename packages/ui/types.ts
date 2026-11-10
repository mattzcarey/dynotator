import type { DiagramAnchor } from "@dynotator/core/diagram-anchor";
import type { ImageRegion } from "@dynotator/core/image-region";
import type { QuestionAnswer } from "@dynotator/core/question-block";

export type { DiagramAnchor } from "@dynotator/core/diagram-anchor";
export type { ImageRegion, ImageRegionBox } from "@dynotator/core/image-region";
export type { QuestionAnswer } from "@dynotator/core/question-block";

export enum AnnotationType {
  DELETION = "DELETION",
  COMMENT = "COMMENT",
  GLOBAL_COMMENT = "GLOBAL_COMMENT",
}

export type EditorMode = "selection" | "comment" | "redline" | "quickLabel";

export type InputMethod = "drag" | "pinpoint";

/**
 * Compactness of the Viewer action button labels (Image / Comment / Copy).
 * Driven by measured plan-area width so the cluster collapses responsively
 * when the side panel squeezes the plan.
 *   full  → "Global comment" / "Copy plan"
 *   short → "Comment" / "Copy"
 *   icon  → labels hidden entirely
 */
export type ActionsLabelMode = "full" | "short" | "icon";

export interface ImageAttachment {
  path: string;
  name: string;
}

/** DOM-relative text position used to restore a document annotation selection. */
export interface AnnotationTextMeta {
  parentTagName: string;
  parentIndex: number;
  textOffset: number;
}

export interface Annotation {
  id: string;
  blockId: string; // Legacy - not used with web-highlighter
  startOffset: number; // Legacy
  endOffset: number; // Legacy
  type: AnnotationType;
  text?: string; // For comments
  originalText: string; // The text that was selected
  createdA: number;
  author?: string; // Tater identity for collaborative sharing
  source?: string; // External tool identifier (e.g., "eslint") — set when annotation comes from external API
  images?: ImageAttachment[]; // Attached images with human-readable names
  mentions?: readonly string[]; // opaque host ids named with `@` in the comment body, set ONLY when a host supplied a `mentionSource` to the composer and at least one token survived; the key is absent otherwise. Host data: the package never renders, exports, shares or archives it.
  isQuickLabel?: boolean; // true if created via quick label chip
  quickLabelTip?: string; // optional instruction tip from the label definition
  diffContext?: "added" | "removed" | "modified"; // set when annotation created in plan diff view
  mathTargets?: Array<{
    blockId: string;
    tex: string;
    displayMode: boolean;
  }>; // math elements covered by a mixed text+formula selection
  pageUrl?: string; // set only by live app annotate sessions: the page (pathname + search) the annotation was made on; restore filters to the current page and export groups by page
  inReplyTo?: string; // id of the annotation this one replies to; a reply inherits its parent's anchor, renders indented under it in the panel, and exports grouped under it. Additive: annotations without it render and export exactly as before.
  diagramAnchor?: DiagramAnchor; // a comment on a rendered diagram part (Mermaid / Graphviz fence): the part's own id, label and document source line; the highlighter skips it and the diagram overlay restores it (see @dynotator/core/diagram-anchor)
  imageRegion?: ImageRegion; // a comment on part of an image in a markdown document (#2100): the image's src as written, its document line, and the box in the image's own pixels; drawn by the image viewer, skipped by the highlighter, exported as `Image:` / `Region:` lines (see @dynotator/core/image-region)
  questionAnswer?: QuestionAnswer; // the reviewer's answer to a `:::question` block (id `ann-question-<key>`): the Viewer draws the answer from it, the highlighter skips it, and the export prints it in the "Answers to your questions" section instead of as a numbered comment (see @dynotator/core/question-block)
  // web-highlighter metadata for cross-element selections
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
  content: string; // Plain text, or raw (unsanitized) HTML for type === 'html'
  level?: number; // For headings (1-6) or list indentation
  language?: string; // For code blocks (e.g., 'rust', 'typescript')
  checked?: boolean; // For checkbox list items (true = checked, false = unchecked, undefined = not a checkbox)
  ordered?: boolean; // For list items: true when source marker was \d+.
  orderedStart?: number; // For ordered list items: integer parsed from the marker (e.g. 5 for "5.")
  alertKind?: AlertKind; // For blockquotes starting with [!NOTE] / [!TIP] / etc.
  directiveKind?: string; // For directive containers (e.g. ':::note' → 'note')
  order: number; // Sorting order
  startLine: number; // 1-based line number in source
  blankLinesBefore?: number; // Paragraph only, with parse option keepBlankLines: the blank lines (2+) typed before it
  sourceLineCount?: number; // Number of source lines consumed when it differs from content lines
  /**
   * Line offset a diagram comment's `sourceLine` is measured from, when it
   * differs from `startLine`. A ```mermaid fence in a document has its opening
   * line ABOVE the diagram's first line, so `startLine` is the right offset
   * there and this stays unset. A whole-file diagram source (.mmd/.dot) has no
   * fence: its first line IS document line 1, so it sets 0 here while
   * `startLine` keeps naming the block's own first line for the export's
   * `(lines a–b)` label.
   */
  diagramSourceLineOffset?: number;
  /**
   * Set on a whole-file code document (`renderAs: "code"`, see
   * `codeDocumentBlocks`): the document line of `content`'s first character.
   * The file is ONE block, so a comment's line label is counted from its
   * position inside `content`, not the block's span (which would name every
   * line). Unset everywhere else, so other labels stay as they were.
   */
  contentStartLine?: number;
}


/**
 * The composer handed to the host (opt-in `onHostDraft` on `Viewer` and
 * `HtmlViewer`; Plannotator supplies neither). With it a viewer draws no
 * toolbar or composer of its own: it reports what a comment would be on, and
 * the host writes the comment, saves it, and draws it as saved through
 * `annotations` or `applySharedAnnotations`.
 */
export interface HostDraft {
  /** The annotation a comment here would carry, with an empty `text`. */
  annotation: Annotation;
  /**
   * `'selection'`: a text selection settled; the host offers its own Comment
   * (a phone's edit menu). `'compose'`: open the composer now (a pinpoint
   * tap, Comment mode, an HTML pin).
   */
  intent: "selection" | "compose";
  /** What it is on, as a composer names it (Plannotator's pinpoint label: "Button", a heading's words). Absent for text. */
  label?: string;
  /**
   * Drop the draft: its pending highlight or pin goes. The host calls it when
   * the person cancels, and after the save, before it draws the saved
   * annotation. A draft already replaced by a newer one ignores it.
   */
  cancel: () => void;
}
