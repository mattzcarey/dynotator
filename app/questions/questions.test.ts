import { describe, expect, test } from "vite-plus/test";
import { parseMarkdownToBlocks } from "../markdown/blocks";
import {
  formatAnswerText,
  formatAnswersSection,
  indexQuestions,
  isRecommendedAnswer,
  parseAnswer,
  parseQuestion,
  recommendedAnswer,
  type QuestionAnswer,
} from "./questions";

const labels = (q: ReturnType<typeof parseQuestion>) =>
  q!.choices.map((c) => [c.label, c.recommended, c.settled]);

describe("parseQuestion", () => {
  test("the documented example", () => {
    const q = parseQuestion(
      "question",
      `Where should we keep the edit that loses a sync conflict?

When two devices edit one note offline, the later save wins.

- [ ] Nowhere — silent loss, as today
- [ ] Local only, purged after 30 days — cheap
- [x] Server-side per user

Recommended: Local only, purged after 30 days`,
    )!;
    expect(q.kind).toBe("single");
    expect(q.prompt).toBe("Where should we keep the edit that loses a sync conflict?");
    expect(q.promptLine).toBe(0);
    expect(q.context).toBe("When two devices edit one note offline, the later save wins.");
    expect(labels(q)).toEqual([
      ["Nowhere", false, false],
      ["Local only, purged after 30 days", true, false],
      ["Server-side per user", false, true],
    ]);
    expect(q.choices[0].description).toBe("silent loss, as today");
    expect(q.suggestedText).toBeUndefined();
    expect(q.key).toMatch(/^q-[0-9a-f]{8}$/);
  });

  test("not a question: wrong kind, no prompt", () => {
    expect(parseQuestion("note", "Which?")).toBeNull();
    expect(parseQuestion("question", "- [ ] a\n- [ ] b")).toBeNull();
  });

  test("kinds: multi, text, and no choices is text", () => {
    const multi = parseQuestion(
      "question-multi",
      "Pick\n- [ ] A\n- [ ] B\n- [ ] C\nRecommended: A and C",
    )!;
    expect(multi.kind).toBe("multi");
    expect(labels(multi).map(([, rec]) => rec)).toEqual([true, false, true]);
    expect(parseQuestion("question", "Why?\n\nSome context.")!.kind).toBe("text");
    const text = parseQuestion("question-text", "Name it?\n- [ ] not a choice")!;
    expect(text.kind).toBe("text");
    expect(text.choices).toEqual([]);
    expect(text.context).toBe("- [ ] not a choice");
  });

  test("plain bullets are the choices when there are no task items", () => {
    const q = parseQuestion(
      "question",
      "Which?\n- **Fast:** cached, may be stale\n- Slow — always fresh\n  and wrapped",
    )!;
    expect(q.choices.map((c) => [c.label, c.description])).toEqual([
      ["Fast", "cached, may be stale"],
      ["Slow", "always fresh and wrapped"],
    ]);
    expect(q.context).toBe("");
  });

  test("a recommendation that names no choice is a suggested answer", () => {
    const q = parseQuestion(
      "question",
      "Which?\n- [ ] A\n- [ ] B\nRecommended: neither, ask legal",
    )!;
    expect(q.choices.some((c) => c.recommended)).toBe(false);
    expect(q.suggestedText).toBe("neither, ask legal");
  });

  test("a recommendation may name a choice by the start of its label", () => {
    const q = parseQuestion(
      "question",
      "Which?\n- [ ] Unpin it: the toast says so\n- [ ] Keep\nRecommended: Unpin it",
    )!;
    expect(labels(q)[0]).toEqual(["Unpin it: the toast says so", true, false]);
  });

  test("(Recommended) markers leave the label and mark the choice", () => {
    const q = parseQuestion("question", "Which?\n- [ ] Redis (Recommended)\n- [ ] Postgres")!;
    expect(labels(q)).toEqual([
      ["Redis", true, false],
      ["Postgres", false, false],
    ]);
    // With a Recommended: line, the line decides.
    const lined = parseQuestion(
      "question",
      "Which?\n- [ ] Redis (Recommended)\n- [ ] Postgres\nRecommended: Postgres",
    )!;
    expect(labels(lined)).toEqual([
      ["Redis", false, false],
      ["Postgres", true, false],
    ]);
  });

  test("the key follows kind and prompt, not formatting", () => {
    const a = parseQuestion("question", "Which store?\n- [ ] A")!;
    const b = parseQuestion("question", "### **Which store**\n- [ ] B")!;
    expect(a.key).toBe(b.key);
    expect(parseQuestion("question-multi", "Which store?\n- [ ] A")!.key).not.toBe(a.key);
  });
});

const DOC = `# Plan

:::question
Which store?
- [ ] Redis
- [ ] Postgres
Recommended: Redis
:::

:::question
Which store?
- [ ] Redis
:::

:::question-text
Anything else?
:::

:::question
Region?
- [x] EU
- [ ] US
:::

> :::question
> Not a question
> :::
`;

const answer = (key: string, fields: Partial<QuestionAnswer>): QuestionAnswer => ({
  key,
  kind: "single",
  prompt: "",
  selected: [],
  ...fields,
});

describe("indexQuestions and the answers section", () => {
  const questions = indexQuestions(parseMarkdownToBlocks(DOC));
  const [store, again, anything, region] = questions;

  test("numbers questions, gives prompt lines, dedupes keys", () => {
    expect(questions.map((q) => [q.number, q.line])).toEqual([
      [1, 4],
      [2, 11],
      [3, 16],
      [4, 20],
    ]);
    expect(again.question.key).toBe(`${store.question.key}-2`);
  });

  test("formats answers, recommendations, notes, skips, unanswered and settled", () => {
    const section = formatAnswersSection(questions, [
      answer(store.question.key, { selected: ["Redis"], note: "Line one\nline two" }),
      answer(again.question.key, { skipped: true }),
      answer("q-00000000", { prompt: "Old question", text: "gone" }),
    ]);
    expect(section).toBe(`## Answers to your questions

1 of 3 questions answered. 1 already settled in the document was left as is.

### Q1. Which store? (line 4)
Answer: Redis (your recommendation)
Note:
> Line one
> line two

### Q2. Which store? (line 11)
Skipped

### Old question (this question is no longer in the document)
Answer:
> gone

### Unanswered
- Q3. Anything else? (line 16)

`);
  });

  test("a note on a settled question reports the settled choice", () => {
    const section = formatAnswersSection([region], [answer(region.question.key, { note: "fine" })]);
    expect(section).toContain("Answer: EU (already settled in the document)\nNote: fine\n");
    expect(section).toContain("1 of 1 question answered.");
  });

  test("several picks and Other", () => {
    const section = formatAnswersSection(
      [anything],
      [answer(store.question.key, { kind: "multi", selected: ["A", "B"], other: "C" })],
    );
    expect(section).toContain("Answer:\n- A\n- B\n- Other: C\n");
  });

  test("nothing to report is empty", () => {
    expect(formatAnswersSection(questions, [answer(store.question.key, {})])).toBe("");
  });

  test("recommended answers", () => {
    const base = answer(store.question.key, {});
    const rec = recommendedAnswer(store.question, { ...base, note: "kept" })!;
    expect(rec).toMatchObject({ selected: ["Redis"], note: "kept" });
    expect(isRecommendedAnswer(store.question, rec)).toBe(true);
    expect(isRecommendedAnswer(store.question, { ...rec, selected: ["Postgres"] })).toBe(false);
    expect(recommendedAnswer(anything.question, base)).toBeNull();
  });
});

describe("answers", () => {
  test("parseAnswer keeps known fields and refuses malformed records", () => {
    expect(
      parseAnswer({
        key: "q-0123abcd",
        kind: "single",
        prompt: "P",
        selected: [" A ", "A", ""],
        other: " ",
        extra: 1,
      }),
    ).toEqual({ key: "q-0123abcd", kind: "single", prompt: "P", selected: ["A"] });
    expect(parseAnswer({ key: "x", kind: "single", prompt: "P", selected: [] })).toBeNull();
    expect(parseAnswer({ key: "q-0123abcd", kind: "nope", prompt: "P", selected: [] })).toBeNull();
    expect(
      parseAnswer({ key: "q-0123abcd", kind: "single", prompt: "P", selected: [1] }),
    ).toBeNull();
    expect(parseAnswer(null)).toBeNull();
  });

  test("formatAnswerText", () => {
    expect(formatAnswerText(answer("q-0123abcd", { selected: ["A"], note: "n" }))).toBe(
      "Answer: A — note: n",
    );
    expect(formatAnswerText(answer("q-0123abcd", { skipped: true }))).toBe("Skipped");
  });
});
