import { HttpError } from "./http";
import type { Store } from "./store";

/** One annotation as the browser sends it. Only `id` and `path` are checked; the rest is kept. */
export interface Annotation {
  id: string;
  /** "" for a comment on the review as a whole. */
  path: string;
  type: "comment" | "replacement" | "answer";
  /** 1-based, inclusive. Absent for a comment on the whole review. */
  lines?: { start: number; end: number };
  /** Present when made in a diff. Default "new". */
  side?: "old" | "new";
  /** With `side: "old"`: the version the removed lines are numbered in (0 is the base). */
  against?: number;
  /** The exact text selected. */
  original?: string;
  /** `comment`: the comment. `replacement`: the proposed text ("" proposes deleting). */
  text?: string;
  /** `answer`: the question's key and the answer given. */
  answer?: { key: string; value: string };
}

export interface ReviewEvent {
  /** 1-based, gapless, increasing. The agent's cursor. */
  seq: number;
  type: "feedback" | "approved" | "revised" | "closed";
  /** The version the event is about. For `revised`, the new version. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** The reviewer's verified email, when the deployment is behind Cloudflare Access. */
  by?: string;
  /** `feedback`, `approved`: what the reviewer said, as markdown for an agent to act on. */
  feedback?: string;
  /** `feedback`, `approved`: the annotations in this submission, structured. */
  annotations?: Annotation[];
}

/** What `revise` returns: the version now under review, and whether the snapshot was the same. */
export interface Revision {
  version: number;
  unchanged: boolean;
}

export type SubmissionType = "feedback" | "approved";

export const MAX_ANNOTATIONS = 2_000;

// One reply (RPC result or JSON body) carries at most this much of the log; a reader whose
// cursor is further behind gets the rest on its next call. One event is at most one 2 MB body.
const MAX_EVENTS_BYTES = 8 * 1024 * 1024;

const SEQ = "seq";
const CLOSED = "closed";
const eventKey = (seq: number) => `event:${String(seq).padStart(9, "0")}`;
/** Marks an annotation id as logged: what makes an annotation "sent". */
const sentKey = (id: string) => `sent:${id}`;
/** The type of the latest reviewer event on a version. */
const verdictKey = (version: number) => `verdict:${version}`;

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

/**
 * Appends what a browser submission adds to the log: its annotations whose ids are not logged
 * yet, and its feedback text. Refused (409) once the review is closed, or if the reviewer was
 * looking at a version the agent has since replaced. A submission that adds nothing (a retry, a
 * second tab, an approval of an already approved version) appends nothing, so the answer is the
 * last `seq` and `event` is absent.
 */
export function submit(
  store: Store,
  type: SubmissionType,
  version: number,
  body: Record<string, unknown>,
  by: string | undefined,
): { seq: number; event?: ReviewEvent } {
  if (isClosed(store)) throw new HttpError(409, "This review is closed.", { code: "closed" });
  if (typeof body.revision !== "number") throw new HttpError(400, "revision must be a number");
  if (body.revision !== version) {
    throw new HttpError(
      409,
      "The files were revised while you were reviewing them. Review the new version, then send again.",
      { code: "revised", revision: version },
    );
  }
  if (body.feedback !== undefined && typeof body.feedback !== "string") {
    throw new HttpError(400, "feedback must be a string");
  }
  const seen = new Set<string>();
  const annotations = parseAnnotations(body.annotations).filter((a) => {
    if (seen.has(a.id) || store.get(sentKey(a.id)) !== undefined) return false;
    seen.add(a.id);
    return true;
  });
  const feedback = body.feedback;
  const adds = annotations.length > 0 || Boolean(feedback);
  const approves = type === "approved" && store.get(verdictKey(version)) !== "approved";
  if (!adds && !approves) return { seq: lastSeq(store) };
  const event = append(store, {
    type,
    version,
    ...(by && { by }),
    ...(feedback && { feedback }),
    ...(annotations.length > 0 && { annotations }),
  });
  for (const a of annotations) store.put(sentKey(a.id), event.seq);
  store.put(verdictKey(version), type);
  return { seq: event.seq, event };
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
