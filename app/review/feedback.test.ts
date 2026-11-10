import { describe, expect, test } from "vite-plus/test";
import { AnnotationType, globalComment, type Annotation } from "./annotations";
import { buildFeedback, NO_FEEDBACK } from "./feedback";
import { parseMarkdownToBlocks } from "../markdown/blocks";
import { indexQuestions, type QuestionAnswer } from "../questions/questions";
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
const block = (type: string) => blocks.find((b) => b.type === type)!;
const questions = indexQuestions(blocks).map((q) => ({ ...q, path: "PLAN.md" }));
const [question] = questions;

const note = (fields: Partial<Annotation>): Annotation => ({
  id: crypto.randomUUID(),
  path: "PLAN.md",
  blockId: "",
  type: AnnotationType.COMMENT,
  originalText: "",
  ...fields,
});
const onBlock = (type: string, fields: Partial<Annotation>) => {
  const { id, startLine, endLine } = block(type);
  return note({ blockId: id, lines: { start: startLine, end: endLine }, ...fields });
};
const answer = (path: string, selected: string[], annotations: Annotation[] = []) => {
  const { key, prompt } = question.question;
  const value: QuestionAnswer = { key, kind: "single", prompt, selected };
  return upsertAnswer(annotations, path, question.blockId, value, key);
};

describe("one file", () => {
  const files = ["PLAN.md"];

  test("nothing annotated is the fixed sentence", () => {
    expect(buildFeedback({ mode: "plan", files, questions, annotations: [] })).toBe(NO_FEEDBACK);
  });

  test("comments, deletions and the general comment, in document order with lines", () => {
    const annotations = [
      globalComment("Looks fine\noverall."),
      onBlock("list-item", { originalText: "Step one", text: "Replace with: Step 1" }),
      onBlock("paragraph", { type: AnnotationType.DELETION, originalText: "behind a ``` flag" }),
      onBlock("heading", { originalText: "Plan", text: "Rename\nit" }),
      onBlock("paragraph", { originalText: "a flag\nand roll", text: "Two lines" }),
    ];
    expect(buildFeedback({ mode: "plan", files, questions, annotations })).toBe(`# Plan Feedback

I've reviewed this plan and have 5 pieces of feedback:

## 1. General feedback about the plan
> Looks fine
> overall.

## 2. (line 1) Feedback on: "Plan"
> Rename
> it

## 3. (lines 3-4) Remove this
\`\`\`\`
behind a \`\`\` flag
\`\`\`\`
> I don't want this in the plan.

## 4. (lines 3-4) Feedback on:
\`\`\`
a flag
and roll
\`\`\`
> Two lines

## 5. (line 6) Feedback on: "Step one"
> Replace with: Step 1

---
`);
  });

  test("answers come first, under their own heading, without a file name", () => {
    const annotations = answer("PLAN.md", ["Postgres"], [onBlock("heading", { text: "ok" })]);
    const out = buildFeedback({ mode: "annotate", files, questions, annotations });
    expect(
      out.startsWith(
        "# Document Feedback\n\n## Answers to your questions\n\n1 of 1 question answered.\n\n### Q1. Which store? (line 9)\nAnswer: Postgres\n\n",
      ),
    ).toBe(true);
    expect(out).toContain("I've reviewed this document and have 1 piece of feedback:");
  });

  test("answers only: no comment section", () => {
    const out = buildFeedback({
      mode: "plan",
      files,
      questions,
      annotations: answer("PLAN.md", ["Redis"]),
    });
    expect(out).toContain("Answer: Redis (your recommendation)");
    expect(out).not.toContain("I've reviewed");
    expect(out.endsWith("---\n")).toBe(true);
  });
});

describe("several files", () => {
  const files = ["docs/PLAN.md", "worker/api.ts", "README.md"];
  const twin = [
    ...questions.map((q) => ({ ...q, path: "docs/PLAN.md" })),
    ...questions.map((q) => ({ ...q, path: "README.md" })),
  ];

  test("a heading per file in tree order, line references, quoted selections", () => {
    const annotations = [
      note({
        path: "README.md",
        lines: { start: 3, end: 3 },
        originalText: "Intro",
        text: "Shorter.",
      }),
      note({
        path: "worker/api.ts",
        lines: { start: 48, end: 50 },
        type: AnnotationType.DELETION,
        originalText: "if (x) {\n  run(`a`);\n}",
      }),
      globalComment("Overall fine."),
      note({
        path: "worker/api.ts",
        lines: { start: 42, end: 42 },
        originalText: "export",
        text: "Why\nexported?",
      }),
    ];
    expect(buildFeedback({ mode: "annotate", files, questions: [], annotations }))
      .toBe(`# Review Feedback

I've reviewed these files and have 4 pieces of feedback:

## 1. General feedback about the files
> Overall fine.

## worker/api.ts

### 2. Line 42
\`\`\`
export
\`\`\`
> Why
> exported?

### 3. Lines 48-50: remove this
\`\`\`
if (x) {
  run(\`a\`);
}
\`\`\`
> I don't want this.

## README.md

### 4. Line 3
\`\`\`
Intro
\`\`\`
> Shorter.

---
`);
  });

  test("the same question in two files keeps two answers, each naming its file", () => {
    const annotations = answer("README.md", ["Redis"], answer("docs/PLAN.md", ["Postgres"]));
    const out = buildFeedback({ mode: "plan", files, questions: twin, annotations });
    expect(out).toContain("2 of 2 questions answered.");
    expect(out).toContain("### Q1. Which store? (docs/PLAN.md, line 9)\nAnswer: Postgres\n");
    expect(out).toContain(
      "### Q1. Which store? (README.md, line 9)\nAnswer: Redis (your recommendation)\n",
    );
  });

  test("an unanswered question names its file", () => {
    const out = buildFeedback({
      mode: "plan",
      files,
      questions: twin,
      annotations: answer("README.md", ["Redis"]),
    });
    expect(out).toContain("### Unanswered\n- Q1. Which store? (docs/PLAN.md, line 9)\n");
  });

  test("a file outside the tree (deleted since) comes last; a path cannot break the heading", () => {
    const annotations = [
      note({ path: "gone\n# x.ts", lines: { start: 1, end: 1 }, originalText: "a", text: "b" }),
      note({ path: "README.md", lines: { start: 1, end: 1 }, originalText: "c", text: "d" }),
    ];
    const out = buildFeedback({ mode: "annotate", files, questions: [], annotations });
    expect(out.indexOf("## README.md")).toBeLessThan(out.indexOf("## gone # x.ts"));
  });
});

test("upsertAnswer replaces in place, scopes by file and removes an emptied answer", () => {
  const first = answer("PLAN.md", ["Redis"], [globalComment("x")]);
  const second = answer("PLAN.md", ["Postgres"], first);
  expect(second).toHaveLength(2);
  expect(second[1]).toMatchObject({ path: "PLAN.md", questionAnswer: { selected: ["Postgres"] } });
  expect(answer("OTHER.md", ["Redis"], second)).toHaveLength(3);
  expect(answer("PLAN.md", [], second)).toHaveLength(1);
});
