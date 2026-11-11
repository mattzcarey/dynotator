import { describe, expect, test } from "vite-plus/test";
import { globalComment, toWire, type Annotation } from "./annotations";
import { buildFeedback } from "./feedback";
import { answersInForce, mergeEvents, reviewState, unsent, type ReviewEvent } from "./events";

const note = (id: string, text = id): Annotation => ({
  id,
  path: "a.md",
  type: "comment",
  lines: { start: 1, end: 1 },
  original: "x",
  text,
});
let seq = 0;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 10, minute)).toISOString();
const event = (
  type: ReviewEvent["type"],
  version: number,
  annotations: Annotation[] = [],
  by?: string,
): ReviewEvent => ({
  seq: ++seq,
  type,
  version,
  at: at(seq),
  ...(by && { by }),
  ...(annotations.length > 0 && { annotations: annotations.map(toWire) }),
});

describe("mergeEvents", () => {
  const a = { seq: 1, type: "feedback", version: 1, at: at(1) } as const;
  const b = { seq: 2, type: "approved", version: 1, at: at(2) } as const;
  const c = { seq: 3, type: "feedback", version: 1, at: at(3) } as const;

  test("in order, each once, the newer copy kept", () => {
    const { events, cursor } = mergeEvents([b, a], [c, b, { ...a, by: "r@x" }]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0].by).toBe("r@x");
    expect(cursor).toBe(3);
  });

  test("a gap holds the cursor before it, so the next fetch fills it", () => {
    const gappy = mergeEvents([a], [c]);
    expect(gappy.events.map((e) => e.seq)).toEqual([1, 3]);
    expect(gappy.cursor).toBe(1);
    expect(mergeEvents(gappy.events, [b, c]).cursor).toBe(3);
    expect(mergeEvents([], []).cursor).toBe(0);
  });
});

describe("partition by ids in the log", () => {
  test("sent is what the log holds; unsent is the rest, whatever the draft says", () => {
    seq = 0;
    const one = note("one");
    const two = note("two");
    const three = note("three");
    const log = [event("feedback", 1, [one, two])];
    const { sent, sentIds } = reviewState(log, 1);
    expect(sent.map((a) => a.id)).toEqual(["one", "two"]);
    // A stale draft still holding sent ones, plus a new one.
    expect(unsent([one, two, three], sentIds).map((a) => a.id)).toEqual(["three"]);
  });

  test("a second submission's event carries only its own annotations", () => {
    seq = 0;
    const log = [event("feedback", 1, [note("one")]), event("feedback", 1, [note("two")])];
    const state = reviewState(log, 1);
    expect(state.submissions.map((s) => s.annotations.map((a) => a.id))).toEqual([
      ["one"],
      ["two"],
    ]);
  });

  test("feedback text covers only what is unsent", () => {
    seq = 0;
    const first = note("first", "Earlier remark");
    const second = note("second", "New remark");
    const { sentIds } = reviewState([event("feedback", 1, [first])], 1);
    const text = buildFeedback({
      files: ["a.md"],
      questions: [],
      annotations: unsent([first, second], sentIds),
    });
    expect(text).toContain("New remark");
    expect(text).not.toContain("Earlier remark");
    expect(text).toContain("1 piece of feedback");
  });

  test("answers in force: an unsent one over the latest sent one", () => {
    const answer = (id: string, selected: string): Annotation => ({
      id,
      path: "a.md",
      type: "answer",
      answer: { key: "q", value: selected },
      questionAnswer: { key: "q", kind: "single", prompt: "Q?", selected: [selected] },
    });
    const order = answersInForce([answer("u", "C")], [answer("s1", "A"), answer("s2", "B")]);
    expect(order.map((a) => a.id)).toEqual(["u", "s2", "s1"]);
    expect(answersInForce([globalComment("x")], [])).toEqual([]);
  });
});

describe("reviewState", () => {
  test("approved, withdrawn by later feedback, approved again", () => {
    seq = 0;
    const log = [event("feedback", 1)];
    expect(reviewState(log, 1).latest?.type).toBe("feedback");
    log.push(event("approved", 1, [], "r@x"));
    expect(reviewState(log, 1).latest).toMatchObject({ type: "approved", by: "r@x" });
    log.push(event("feedback", 1, [note("n")]));
    expect(reviewState(log, 1).latest?.type).toBe("feedback");
    log.push(event("approved", 1));
    expect(reviewState(log, 1).latest?.type).toBe("approved");
  });

  test("per version: a revision starts with no approval and nothing sent", () => {
    seq = 0;
    const log = [event("approved", 1, [note("old")]), event("revised", 2)];
    const v2 = reviewState(log, 2);
    expect(v2.latest).toBeNull();
    expect(v2.sent).toEqual([]);
    // Ids sent on any version stay sent: a carried-over draft cannot resend them.
    expect(v2.sentIds.has("old")).toBe(true);
    expect(reviewState(log, 1).latest?.type).toBe("approved");
  });

  test("closed", () => {
    seq = 0;
    const log = [event("feedback", 1), event("closed", 1)];
    expect(reviewState(log, 1).closed?.seq).toBe(2);
    expect(reviewState(log.slice(0, 1), 1).closed).toBeNull();
  });
});
