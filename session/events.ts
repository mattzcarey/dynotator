import type { ReviewMode } from "./files";
import { HttpError } from "./http";
import type { Store } from "./store";

/** One annotation as the browser sends it. Only `id` and `path` are checked; the rest is kept. */
export interface Annotation {
  id: string;
  /** "" for a general comment. */
  path: string;
  type: "comment" | "deletion" | "replacement" | "general" | "answer";
  /** 1-based, inclusive. Absent for general comments. */
  lines?: { start: number; end: number };
  /** Present when made in a diff. Default "new". */
  side?: "old" | "new";
  /** The exact text selected. */
  original?: string;
  /** `comment`, `general`: the comment. `replacement`: the proposed text. */
  text?: string;
  /** `answer`: the question key and the answer. */
  answer?: { key: string; value: string };
}

export type ReviewEventType =
  | "approved"
  | "changes_requested"
  | "feedback"
  | "dismissed"
  | "revised"
  | "closed";

export interface ReviewEvent {
  /** 1-based, gapless, increasing. The agent's cursor. */
  seq: number;
  type: ReviewEventType;
  /** The version the event is about. For `revised`, the new version. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** The reviewer's verified email, when the deployment is behind Cloudflare Access. */
  by?: string;
  /** Reviewer events: the feedback as markdown for an agent to act on. */
  feedback?: string;
  /** `changes_requested` only: the reviewer answered the questions and said nothing else. */
  answersOnly?: true;
  /** Reviewer events: the annotations in this submission. */
  annotations?: Annotation[];
}

/** What `revise` returns: the version now under review, and whether the snapshot was the same. */
export interface Revision {
  version: number;
  unchanged: boolean;
}

/** The browser's submission routes in each mode, and the event each one appends. */
export const SUBMISSIONS: Record<ReviewMode, Record<string, ReviewEventType>> = {
  plan: { "/api/approve": "approved", "/api/deny": "changes_requested" },
  annotate: { "/api/feedback": "feedback", "/api/exit": "dismissed" },
};

export const MAX_ANNOTATIONS = 2_000;

// One reply (RPC result or JSON body) carries at most this much of the log; a reader whose
// cursor is further behind calls again. A single event is at most one 2 MB submission.
const MAX_EVENTS_BYTES = 8 * 1024 * 1024;

const SEQ = "seq";
const CLOSED = "closed";
const eventKey = (seq: number) => `event:${String(seq).padStart(9, "0")}`;

export function lastSeq(store: Store): number {
  return store.get<number>(SEQ) ?? 0;
}

export function isClosed(store: Store): boolean {
  return store.get<boolean>(CLOSED) === true;
}

export function append(store: Store, event: Omit<ReviewEvent, "seq" | "at">): ReviewEvent {
  const seq = lastSeq(store) + 1;
  const full: ReviewEvent = { seq, ...event, at: new Date().toISOString() };
  store.put(eventKey(seq), full);
  store.put(SEQ, seq);
  if (event.type === "closed") store.put(CLOSED, true);
  return full;
}

/** Events with `seq > after`, in order: all of them, or as many as fit in one reply. */
export function eventsAfter(store: Store, after: number): ReviewEvent[] {
  if (!Number.isInteger(after) || after < 0) {
    throw new HttpError(400, "after must be an integer >= 0");
  }
  const out: ReviewEvent[] = [];
  let bytes = 0;
  for (let seq = after + 1, last = lastSeq(store); seq <= last; seq++) {
    const event = store.get<ReviewEvent>(eventKey(seq))!;
    bytes += JSON.stringify(event).length;
    if (out.length > 0 && bytes > MAX_EVENTS_BYTES) break;
    out.push(event);
  }
  return out;
}

export function assertOpen(store: Store): void {
  if (isClosed(store)) throw new HttpError(409, "This review is closed.", { code: "closed" });
}

/**
 * Appends the reviewer event a browser request body describes. Refused (409) once the review is
 * closed, or if the reviewer was looking at a version the agent has since replaced.
 */
export function submit(
  store: Store,
  type: ReviewEventType,
  version: number,
  body: Record<string, unknown>,
  by: string | undefined,
): ReviewEvent {
  assertOpen(store);
  const revision = typeof body.revision === "string" ? Number(body.revision) : body.revision;
  if (typeof revision === "number" && revision !== version) {
    throw new HttpError(
      409,
      "The files were revised while you were reviewing them. Review the new version, then send again.",
      { code: "revised", revision: version },
    );
  }
  if (body.feedback !== undefined && typeof body.feedback !== "string") {
    throw new HttpError(400, "feedback must be a string");
  }
  const annotations = parseAnnotations(body.annotations);
  return append(store, {
    type,
    version,
    ...(by && { by }),
    ...(type !== "dismissed" && body.feedback && { feedback: body.feedback }),
    ...(type === "changes_requested" && body.answersOnly === true && { answersOnly: true }),
    ...(type !== "dismissed" && annotations.length > 0 && { annotations }),
  });
}

export function parseAnnotations(value: unknown): Annotation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "annotations must be an array");
  if (value.length > MAX_ANNOTATIONS) {
    throw new HttpError(400, `annotations must have at most ${MAX_ANNOTATIONS} entries`);
  }
  for (const [i, a] of value.entries()) {
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      throw new HttpError(400, `annotations[${i}] must be an object`);
    }
    const { id, path } = a as Record<string, unknown>;
    if (typeof id !== "string" || typeof path !== "string") {
      throw new HttpError(400, `annotations[${i}] needs a string id and path`);
    }
  }
  return value as Annotation[];
}
