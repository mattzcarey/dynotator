import { fromWire, type Annotation } from "./annotations";

export type EventType =
  | "approved"
  | "changes_requested"
  | "feedback"
  | "dismissed"
  | "revised"
  | "closed";

/** `GET /api/events`: one entry of the review's log. */
export interface ReviewEvent {
  seq: number;
  type: EventType;
  version: number;
  at: string;
  by?: string;
  feedback?: string;
  answersOnly?: true;
  annotations?: unknown[];
  /** Made here from a submission's answer, until the server's copy arrives. */
  local?: true;
}

const REVIEWER = new Set<EventType>(["approved", "changes_requested", "feedback", "dismissed"]);
const TYPES = new Set<string>([...REVIEWER, "revised", "closed"]);

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
 * The log with `incoming` merged in, by `seq`: in order, each once, the server's copy over a
 * local one. `cursor` is the last `seq` up to which the server's log is held without a gap; the
 * next fetch asks for what comes after it, so a gap is filled and a local copy replaced.
 */
export function mergeEvents(
  known: readonly ReviewEvent[],
  incoming: readonly ReviewEvent[],
): { events: ReviewEvent[]; cursor: number } {
  const bySeq = new Map(known.map((e) => [e.seq, e]));
  for (const event of incoming) {
    if (event.local && bySeq.has(event.seq)) continue;
    bySeq.set(event.seq, event);
  }
  const events = [...bySeq.values()].toSorted((a, b) => a.seq - b.seq);
  let cursor = 0;
  for (const event of events) {
    if (event.seq !== cursor + 1 || event.local) break;
    cursor = event.seq;
  }
  return { events, cursor };
}

export interface Verdict {
  type: EventType;
  at: string;
  by?: string;
}

/** One submission on the current version, with the annotations it carried. */
export interface Submission extends Verdict {
  seq: number;
  annotations: Annotation[];
}

export interface ReviewState {
  closed: Verdict | null;
  /** Plan: the latest approval or request for changes on the version; it decides the state. */
  verdict: Verdict | null;
  /** The latest submission of any kind on the version. */
  latest: Verdict | null;
  submissions: Submission[];
  /** Everything sent on the version, oldest first. */
  sent: Annotation[];
}

const verdictOf = ({ type, at, by }: ReviewEvent): Verdict => ({ type, at, ...(by && { by }) });

/** The state of `version` as the log tells it. */
export function reviewState(events: readonly ReviewEvent[], version: number): ReviewState {
  let closed: Verdict | null = null;
  let verdict: Verdict | null = null;
  let latest: Verdict | null = null;
  const submissions: Submission[] = [];
  for (const event of events) {
    if (event.type === "closed") closed = verdictOf(event);
    if (!REVIEWER.has(event.type) || event.version !== version) continue;
    latest = verdictOf(event);
    if (event.type === "approved" || event.type === "changes_requested") verdict = latest;
    const annotations = (event.annotations ?? []).flatMap((a) => fromWire(a) ?? []);
    submissions.push({ ...latest, seq: event.seq, annotations });
  }
  return { closed, verdict, latest, submissions, sent: submissions.flatMap((s) => s.annotations) };
}

/** The draft without what was sent: what the next submission carries. */
export function unsent(draft: readonly Annotation[], sent: readonly Annotation[]): Annotation[] {
  if (sent.length === 0) return [...draft];
  const ids = new Set(sent.map((a) => a.id));
  return draft.filter((a) => !ids.has(a.id));
}

/**
 * Answers in force: one per file and question, the draft's over the latest sent one. Ordered so
 * the first per key wins, as `collectAnswers` reads them.
 */
export function answersInForce(
  draft: readonly Annotation[],
  sent: readonly Annotation[],
): Annotation[] {
  return [...draft, ...sent.toReversed()].filter((a) => a.questionAnswer);
}
