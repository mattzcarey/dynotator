import { fromWire, type Annotation } from "./annotations";

export type EventType = "feedback" | "approved" | "revised" | "closed";

/** `GET /api/events`: one entry of the review's log. */
export interface ReviewEvent {
  seq: number;
  type: EventType;
  version: number;
  at: string;
  by?: string;
  feedback?: string;
  annotations?: unknown[];
}

const TYPES = new Set<string>(["feedback", "approved", "revised", "closed"]);
const isReviewer = (e: ReviewEvent) => e.type === "feedback" || e.type === "approved";

/** The events of a response that are events; anything else is dropped. */
export function parseEvents(value: unknown): ReviewEvent[] {
  const list = (value as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is ReviewEvent =>
      typeof e === "object" &&
      e !== null &&
      Number.isInteger(e.seq) &&
      e.seq >= 1 &&
      TYPES.has(e.type) &&
      Number.isInteger(e.version) &&
      typeof e.at === "string",
  );
}

/**
 * The log with `incoming` merged in, by `seq`: in order, each once. `cursor` is the last `seq`
 * up to which the log is held without a gap; the next fetch asks for what comes after it, so a
 * gap is filled rather than skipped.
 */
export function mergeEvents(
  known: readonly ReviewEvent[],
  incoming: readonly ReviewEvent[],
): { events: ReviewEvent[]; cursor: number } {
  const bySeq = new Map(known.map((e) => [e.seq, e]));
  for (const event of incoming) bySeq.set(event.seq, event);
  const events = [...bySeq.values()].toSorted((a, b) => a.seq - b.seq);
  let cursor = 0;
  for (const event of events) {
    if (event.seq !== cursor + 1) break;
    cursor = event.seq;
  }
  return { events, cursor };
}

/** A reviewer event on the current version. */
export interface Submission {
  seq: number;
  type: "feedback" | "approved";
  at: string;
  by?: string;
  annotations: Annotation[];
}

export interface ReviewState {
  /** The `closed` event, once there is one. */
  closed: ReviewEvent | null;
  /** The latest reviewer event on the version: approved if it is an approval. */
  latest: Submission | null;
  submissions: Submission[];
  /** Everything sent on the version, oldest first, as the log holds it. */
  sent: Annotation[];
  /** Every annotation id in the log, any version: these are sent. */
  sentIds: ReadonlySet<string>;
}

/** The state of `version` as the log tells it. */
export function reviewState(events: readonly ReviewEvent[], version: number): ReviewState {
  let closed: ReviewEvent | null = null;
  const submissions: Submission[] = [];
  const sentIds = new Set<string>();
  for (const event of events) {
    if (event.type === "closed") closed = event;
    if (!isReviewer(event)) continue;
    const annotations = (event.annotations ?? []).flatMap((a) => fromWire(a) ?? []);
    for (const a of annotations) sentIds.add(a.id);
    if (event.version !== version) continue;
    submissions.push({
      seq: event.seq,
      type: event.type as Submission["type"],
      at: event.at,
      ...(event.by && { by: event.by }),
      annotations,
    });
  }
  return {
    closed,
    latest: submissions.at(-1) ?? null,
    submissions,
    sent: submissions.flatMap((s) => s.annotations),
    sentIds,
  };
}

/** The page's annotations not in the log: editable, and what the next submission carries. */
export const unsent = (mine: readonly Annotation[], sentIds: ReadonlySet<string>): Annotation[] =>
  mine.filter((a) => !sentIds.has(a.id));

/**
 * Answers in force: one per file and question, an unsent one over the latest sent one. Ordered
 * so the first per key wins, as `collectAnswers` reads them.
 */
export function answersInForce(
  editable: readonly Annotation[],
  sent: readonly Annotation[],
): Annotation[] {
  return [...editable, ...sent.toReversed()].filter((a) => a.questionAnswer);
}

/** `14:05` today, `12 Nov, 14:05` before. */
export function formatWhen(at: string, now = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === now.toDateString()
    ? time
    : `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
