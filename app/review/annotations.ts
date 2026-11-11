import { parseAnswer, type QuestionAnswer } from "../questions/questions";

export type AnnotationType = "comment" | "deletion" | "replacement" | "general" | "answer";
export type Side = "old" | "new";
export interface Lines {
  start: number;
  end: number;
}

/** A DOM text position, as web-highlighter serializes it to repaint a selection. */
export interface TextPosition {
  parentTagName: string;
  parentIndex: number;
  textOffset: number;
}

/** What only this page reads, to repaint and to answer questions again. */
interface Private {
  /** In a rendered markdown file, the block the selection starts in. */
  blockId?: string;
  /** 0-based column of the selection's start in `lines.start`, where the view knows it. */
  col?: number;
  /** `side: "old"`: the version the removed lines are numbered in (0 is the base). */
  against?: number;
  /** Web-highlighter positions in the rendered markdown file the selection was made in. */
  startMeta?: TextPosition;
  endMeta?: TextPosition;
  questionAnswer?: QuestionAnswer;
}

/**
 * One note of the reviewer's: the spec's `Annotation` (what agents read) plus the private fields
 * the page needs to paint it again. Drafts store it, submissions send it, both via `toWire`.
 */
export interface Annotation extends Private {
  id: string;
  /** "" for a general comment. */
  path: string;
  type: AnnotationType;
  /** 1-based, inclusive: the selected lines in source and diffs, the block's in markdown. */
  lines?: Lines;
  /** Made in a diff. */
  side?: Side;
  /** The exact text selected. */
  original?: string;
  /** `comment`, `general`: the comment. `replacement`: the proposed text. */
  text?: string;
  answer?: { key: string; value: string };
}

/** The spec's annotation, with the private fields under `ui`, which agents ignore. */
export interface WireAnnotation extends Omit<Annotation, keyof Private> {
  ui?: Private;
}

const PRIVATE_KEYS = ["blockId", "col", "against", "startMeta", "endMeta", "questionAnswer"] as const;

export function toWire(annotation: Annotation): WireAnnotation {
  const { id, path, type, lines, side, original, text, answer } = annotation;
  const ui: Private = {};
  for (const key of PRIVATE_KEYS) {
    if (annotation[key] !== undefined) Object.assign(ui, { [key]: annotation[key] });
  }
  return {
    id,
    path,
    type,
    ...(lines && { lines: { start: lines.start, end: lines.end } }),
    ...(side && { side }),
    ...(original !== undefined && { original }),
    ...(text !== undefined && { text }),
    ...(answer && { answer: { key: answer.key, value: answer.value } }),
    ...(Object.keys(ui).length > 0 && { ui }),
  };
}

const TYPES = new Set<string>(["comment", "deletion", "replacement", "general", "answer"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isLine = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const string = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function position(value: unknown): TextPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { parentTagName, parentIndex, textOffset } = value;
  return typeof parentTagName === "string" &&
    typeof parentIndex === "number" &&
    typeof textOffset === "number"
    ? { parentTagName, parentIndex, textOffset }
    : undefined;
}

/**
 * An annotation read back from a draft or the event log, or null when it is not one this page
 * wrote. Unknown fields are dropped.
 */
export function fromWire(value: unknown): Annotation | null {
  if (!isRecord(value)) return null;
  const { id, path, type, lines, side, original, text, answer } = value;
  if (typeof id !== "string" || typeof path !== "string") return null;
  if (typeof type !== "string" || !TYPES.has(type)) return null;
  const out: Annotation = { id, path, type: type as AnnotationType };
  if (isRecord(lines) && isLine(lines.start) && isLine(lines.end) && lines.end >= lines.start)
    out.lines = { start: lines.start, end: lines.end };
  if (side === "old" || side === "new") out.side = side;
  if (string(original) !== undefined) out.original = original as string;
  if (string(text) !== undefined) out.text = text as string;
  if (isRecord(answer) && typeof answer.key === "string" && typeof answer.value === "string")
    out.answer = { key: answer.key, value: answer.value };
  const ui = isRecord(value.ui) ? value.ui : {};
  if (string(ui.blockId) !== undefined) out.blockId = ui.blockId as string;
  if (isCount(ui.col)) out.col = ui.col;
  if (isCount(ui.against)) out.against = ui.against;
  const start = position(ui.startMeta);
  const end = position(ui.endMeta);
  if (start && end) {
    out.startMeta = start;
    out.endMeta = end;
  }
  const questionAnswer = parseAnswer(ui.questionAnswer);
  if (questionAnswer) out.questionAnswer = questionAnswer;
  if (type === "answer" && !out.answer) return null;
  return out;
}

/** A comment on the whole review. */
export const globalComment = (text: string): Annotation => ({
  id: `global-${crypto.randomUUID()}`,
  path: "",
  type: "general",
  text,
});

/** Everything but question answers: what the panel lists and the counts count. */
export const isNote = (annotation: Annotation): boolean => annotation.type !== "answer";
