import { describe, expect, test } from "bun:test";
import { AnnotationType, globalComment, type Annotation } from "./annotations";
import { buildFeedback, NO_FEEDBACK } from "./feedback";
import { parseMarkdownToBlocks } from "../markdown/blocks";
import { indexQuestions } from "../questions/questions";
import { upsertAnswer } from "../questions/answers";

const PLAN = `# Plan

Ship it behind a flag
and roll out slowly.

- Step one

:::question
Which store?
- [ ] Redis
- [ ] Postgres
Recommended: Redis
:::
`;
const blocks = parseMarkdownToBlocks(PLAN);
const id = (type: string) => blocks.find((b) => b.type === type)!.id;

const note = (fields: Partial<Annotation>): Annotation => ({
  id: crypto.randomUUID(),
  blockId: "",
  type: AnnotationType.COMMENT,
  originalText: "",
  ...fields,
});

describe("buildFeedback", () => {
  test("nothing annotated is the fixed sentence", () => {
    expect(buildFeedback({ mode: "plan", blocks, annotations: [] })).toBe(NO_FEEDBACK);
  });

  test("comments, deletions and the general comment, in document order with lines", () => {
    const annotations = [
      globalComment("Looks fine\noverall."),
      note({ blockId: id("list-item"), originalText: "Step one", text: "Replace with: Step 1" }),
      note({
        blockId: id("paragraph"),
        type: AnnotationType.DELETION,
        originalText: "behind a ``` flag",
      }),
      note({ blockId: id("heading"), originalText: "Plan", text: "Rename\nit" }),
    ];
    expect(buildFeedback({ mode: "plan", blocks, annotations })).toBe(`# Plan Feedback

I've reviewed this plan and have 4 pieces of feedback:

## 1. General feedback about the plan
> Looks fine
> overall.

## 2. (line 1) Feedback on: "Plan"
> Rename
> it

## 3. (lines 3–4) Remove this
\`\`\`\`
behind a \`\`\` flag
\`\`\`\`
> I don't want this in the plan.

## 4. (line 6) Feedback on: "Step one"
> Replace with: Step 1

---
`);
  });

  test("answers come first, under their own heading", () => {
    const [question] = indexQuestions(blocks);
    const answered = upsertAnswer(
      [],
      question.blockId,
      {
        key: question.question.key,
        kind: "single",
        prompt: question.question.prompt,
        selected: ["Postgres"],
      },
      question.question.key,
    );
    const annotations = [
      ...answered,
      note({ blockId: id("heading"), originalText: "Plan", text: "ok" }),
    ];
    const out = buildFeedback({ mode: "annotate", blocks, annotations });
    expect(
      out.startsWith(
        "# Document Feedback\n\n## Answers to your questions\n\n1 of 1 question answered.\n\n### Q1. Which store? (line 9)\nAnswer: Postgres\n\n",
      ),
    ).toBe(true);
    expect(out).toContain("I've reviewed this document and have 1 piece of feedback:");
  });

  test("answers only: no comment section", () => {
    const [question] = indexQuestions(blocks);
    const annotations = upsertAnswer(
      [],
      question.blockId,
      {
        key: question.question.key,
        kind: "single",
        prompt: question.question.prompt,
        selected: ["Redis"],
      },
      question.question.key,
    );
    const out = buildFeedback({ mode: "plan", blocks, annotations });
    expect(out).toContain("Answer: Redis (your recommendation)");
    expect(out).not.toContain("I've reviewed");
    expect(out.endsWith("---\n")).toBe(true);
  });
});

test("upsertAnswer replaces in place and removes an emptied answer", () => {
  const [question] = indexQuestions(blocks);
  const { key, prompt } = question.question;
  const base = { key, kind: "single" as const, prompt, selected: ["Redis"] };
  const first = upsertAnswer([globalComment("x")], question.blockId, base, key);
  const second = upsertAnswer(first, question.blockId, { ...base, selected: ["Postgres"] }, key);
  expect(second).toHaveLength(2);
  expect(second[1].questionAnswer?.selected).toEqual(["Postgres"]);
  expect(upsertAnswer(second, question.blockId, { ...base, selected: [] }, key)).toHaveLength(1);
});
