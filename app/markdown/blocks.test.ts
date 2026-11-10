import { describe, expect, test } from "vite-plus/test";
import { computeListIndices, groupBlocks, headingSlugs, parseMarkdownToBlocks } from "./blocks";

const DOC = `---
title: hidden
---

# Plan

Intro line one
line two.

- Top
  - Nested **bold**
1. First
2. Second
5. Third

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

:::question
Which store?
- [ ] Redis
:::

> [!WARNING]
> Careful.

> quoted
>
> more

<details>
<summary>More</summary>

Hidden text.
</details>

See [the docs][docs].

[docs]: https://example.com
`;

describe("parseMarkdownToBlocks", () => {
  const blocks = parseMarkdownToBlocks(DOC);
  const summary = blocks.map((b) => [b.type, b.startLine, b.endLine]);

  test("hides frontmatter and keeps source line numbers", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1, content: "Plan", startLine: 5 });
    expect(DOC.includes("title: hidden")).toBe(true);
    expect(blocks.some((b) => b.content.includes("title: hidden"))).toBe(false);
  });

  test("splits every construct into one block with its line span", () => {
    expect(summary).toEqual([
      ["heading", 5, 5],
      ["paragraph", 7, 8],
      ["list-item", 10, 10],
      ["list-item", 11, 11],
      ["list-item", 12, 12],
      ["list-item", 13, 13],
      ["list-item", 14, 14],
      ["table", 16, 18],
      ["code", 20, 22],
      ["code", 24, 27],
      ["directive", 29, 32],
      ["blockquote", 34, 35],
      ["blockquote", 37, 39],
      ["html", 41, 45],
      ["paragraph", 47, 47],
    ]);
  });

  test("reads list nesting, ordering and numbering", () => {
    const items = blocks.filter((b) => b.type === "list-item");
    expect(items.map((b) => b.level)).toEqual([0, 1, 0, 0, 0]);
    expect(items[1].content).toBe("Nested **bold**");
    expect(computeListIndices(items)).toEqual([null, null, 1, 2, 3]);
    expect(groupBlocks(blocks).filter(Array.isArray)).toHaveLength(1);
  });

  test("keeps fence languages, mermaid included", () => {
    const fences = blocks.filter((b) => b.type === "code");
    expect(fences.map((b) => [b.language, b.content])).toEqual([
      ["ts", "const x = 1;"],
      ["mermaid", "graph TD\n  A --> B"],
    ]);
  });

  test("reads directives, alerts and quotes", () => {
    const directive = blocks.find((b) => b.type === "directive")!;
    expect(directive).toMatchObject({
      directiveKind: "question",
      content: "Which store?\n- [ ] Redis",
    });
    const [alert, quote] = blocks.filter((b) => b.type === "blockquote");
    expect(alert).toMatchObject({ alertKind: "warning", content: "Careful." });
    expect(quote).toMatchObject({ content: "quoted\n\nmore" });
  });

  test("resolves reference links and blanks the used definition", () => {
    expect(blocks[blocks.length - 1].content).toBe("See [the docs](https://example.com).");
  });

  test("a task item records its state", () => {
    const [done, open, plain] = parseMarkdownToBlocks("- [x] done\n- [ ] open\n- plain");
    expect([done.checked, open.checked, plain.checked]).toEqual([true, false, undefined]);
    expect(done.content).toBe("done");
  });

  test("`#123` and an unclosed fence", () => {
    expect(parseMarkdownToBlocks("#123 fixed")[0].type).toBe("paragraph");
    const [fence] = parseMarkdownToBlocks("```\na\nb");
    expect(fence).toMatchObject({ type: "code", content: "a\nb", startLine: 1, endLine: 3 });
  });

  test("CRLF reads as LF", () => {
    expect(parseMarkdownToBlocks("# A\r\n\r\ntext\r\n")).toMatchObject([
      { type: "heading", content: "A" },
      { type: "paragraph", content: "text", startLine: 3 },
    ]);
  });
});

test("headingSlugs dedupes like GitHub", () => {
  const blocks = parseMarkdownToBlocks("# Setup\n## `bun` **install**\n# Setup");
  expect([...headingSlugs(blocks).values()]).toEqual(["setup", "bun-install", "setup-1"]);
});
