import type { Block } from "../types";
import {
  DIRECTIVE_OPEN_RE,
  codeFenceCloseIndex,
  directiveCloseIndex,
  htmlBlockEndAt,
  resolveReferenceLinks,
  scanDisplayMath,
  splitFrontmatter,
  type TagCloseIndex,
} from "@dynotator/core/markdown-structure";

export interface ParseMarkdownOptions {
  /** Hide a leading `--- ... ---` frontmatter block (default true). */
  frontmatter?: boolean;
}

/**
 * Splits markdown into a flat list of blocks (one per heading, paragraph,
 * list item, fence, table, ...). Flat blocks with source line numbers keep
 * annotation anchoring and the feedback's line labels predictable.
 */
export const parseMarkdownToBlocks = (
  markdown: string,
  options?: ParseMarkdownOptions,
): Block[] => {
  const { content: rawContent, contentStartLine } =
    options?.frontmatter === false
      ? { content: markdown, contentStartLine: 1 }
      : splitFrontmatter(markdown);
  // Resolve link reference definitions into inline links before splitting. This
  // blanks definition lines in place, so line count (and every block's
  // startLine) is preserved.
  const cleanMarkdown = resolveReferenceLinks(rawContent);
  const lines = cleanMarkdown.split("\n");
  const blocks: Block[] = [];
  let currentId = 0;
  // Cache for findHtmlBlockEnd's per-tag-name prefix-sum index — scoped per
  // parse call (per document) and shared across every HTML-block opener
  // encountered below, so a document with many consecutive openers of the
  // same tag only pays its one-time O(N) build cost once.
  const htmlCloseCache = new Map<string, TagCloseIndex>();

  let buffer: string[] = [];
  let currentType: Block["type"] = "paragraph";
  let currentLevel = 0;
  let bufferStartLine = contentStartLine;
  let lastLineWasBlank = false;

  const flush = () => {
    if (buffer.length > 0) {
      const content = buffer.join("\n");
      blocks.push({
        id: `block-${currentId++}`,
        type: currentType,
        content: content,
        level: currentLevel,
        order: currentId,
        startLine: bufferStartLine,
      });
      buffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const currentLineNum = i + contentStartLine;
    const prevLineWasBlank = lastLineWasBlank;
    lastLineWasBlank = false;

    // Headings: one to six `#` followed by a space or the end of the line
    // (CommonMark ATX). `#123 fixed`, `#hashtag` and `#!/bin/sh` are text,
    // so an issue ref that starts a line keeps its link.
    const headingMatch = trimmed.match(/^(#{1,6})(?:\s|$)/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      blocks.push({
        id: `block-${currentId++}`,
        type: "heading",
        content: trimmed.replace(/^#+\s*/, ""),
        level,
        order: currentId,
        startLine: currentLineNum,
      });
      continue;
    }

    // Horizontal Rule
    if (trimmed === "---" || trimmed === "***") {
      flush();
      blocks.push({
        id: `block-${currentId++}`,
        type: "hr",
        content: "",
        order: currentId,
        startLine: currentLineNum,
      });
      continue;
    }

    // List Items (Simple detection)
    const listMatch = trimmed.match(/^(\*|-|(\d+)\.)\s/);
    if (listMatch) {
      flush(); // Treat each list item as a separate block for easier annotation
      // Calculate indentation level from leading whitespace
      const leadingWhitespace = line.match(/^(\s*)/)?.[1] || "";
      // Count spaces (2 spaces = 1 level) or tabs (1 tab = 1 level)
      const spaceCount = leadingWhitespace.replace(/\t/g, "  ").length;
      const listLevel = Math.floor(spaceCount / 2);

      // Distinguish numeric markers (\d+.) from bullet markers (* / -)
      const ordered = listMatch[2] !== undefined;
      const orderedStart = ordered ? parseInt(listMatch[2]!, 10) : undefined;

      // Remove list marker
      let content = trimmed.slice(listMatch[0].length);

      // Check for checkbox syntax: [ ] or [x] or [X]
      let checked: boolean | undefined = undefined;
      const checkboxMatch = content.match(/^\[([ xX])\]\s*/);
      if (checkboxMatch) {
        checked = checkboxMatch[1].toLowerCase() === "x";
        content = content.replace(/^\[([ xX])\]\s*/, "");
      }

      blocks.push({
        id: `block-${currentId++}`,
        type: "list-item",
        content,
        level: listLevel,
        checked,
        ordered: ordered || undefined,
        orderedStart,
        order: currentId,
        startLine: currentLineNum,
      });
      continue;
    }

    // Blockquotes: a run of consecutive `>` lines (blank `>` lines included)
    // is ONE quote block, the way GitHub renders it: one quote, one bar. A
    // truly blank line ends the run, so the next `>` starts a fresh quote; a
    // line without `>` is not a lazy continuation (it starts a paragraph).
    //
    // `content` is the quote's own markdown: each line with its `>` marker and
    // one following space or tab removed (deeper indentation is kept, so a
    // fenced code block or a nested list inside the quote keeps its shape) and
    // trailing whitespace trimmed, one content line per source line. Blank
    // lines at the quote's edges are dropped (`startLine` moves past leading
    // ones), so the block's line span is the quote's text. The renderer
    // (`BlockquoteBlock`) parses `content` again with this function and draws
    // the inner blocks (paragraphs, code fences, lists, nested quotes) inside
    // the one quote, while the quote stays a single annotatable block with a
    // single `data-block-id`.
    //
    // GitHub alerts (`> [!KIND]` as the run's first line): the marker line tags
    // the block, and the body is every later line with its `>` marker and one
    // following space or tab removed and trailing whitespace trimmed, as a
    // quote's content is (so a fence nested under a list item keeps its
    // indentation), empty leading lines skipped. AlertBlock renders it.
    if (trimmed.startsWith(">")) {
      flush();
      let runEnd = i;
      while (runEnd + 1 < lines.length && lines[runEnd + 1].trim().startsWith(">")) runEnd++;
      const run = lines.slice(i, runEnd + 1);
      const quoteStartLine = currentLineNum;
      i = runEnd;
      const alertMatch = trimmed
        .replace(/^>\s*/, "")
        .match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*$/i);
      if (alertMatch) {
        const body = run.slice(1).reduce((acc, raw) => {
          const stripped = raw.replace(/^\s*>[ \t]?/, "").trimEnd();
          return acc ? acc + "\n" + stripped : stripped;
        }, "");
        blocks.push({
          id: `block-${currentId++}`,
          type: "blockquote",
          content: body,
          alertKind: alertMatch[1].toLowerCase() as
            | "note"
            | "tip"
            | "warning"
            | "caution"
            | "important",
          order: currentId,
          startLine: quoteStartLine,
        });
        continue;
      }
      const inner = run.map((raw) => raw.replace(/^\s*>[ \t]?/, "").trimEnd());
      let first = 0;
      while (first < inner.length - 1 && inner[first] === "") first++;
      let last = inner.length - 1;
      while (last > first && inner[last] === "") last--;
      blocks.push({
        id: `block-${currentId++}`,
        type: "blockquote",
        content: inner.slice(first, last + 1).join("\n"),
        order: currentId,
        startLine: quoteStartLine + first,
      });
      continue;
    }

    // Code blocks (naive). Count backticks in the opening fence to support
    // nested fences (e.g. ```` wrapping ```); the extent is shared with core.
    if (trimmed.startsWith("```")) {
      flush();
      const codeStartLine = currentLineNum;
      const fenceLen = trimmed.match(/^`+/)?.[0].length ?? 3;
      // Extract language from fence (e.g., ```rust → "rust")
      const language = trimmed.slice(fenceLen).trim() || undefined;
      const close = codeFenceCloseIndex(lines, i);
      const codeContent = lines.slice(i + 1, close);
      i = close;
      blocks.push({
        id: `block-${currentId++}`,
        type: "code",
        content: codeContent.join("\n"),
        language,
        order: currentId,
        startLine: codeStartLine,
      });
      continue;
    }

    // Display math: $$ ... $$ or \[ ... \] — only when the close actually
    // exists. An unclosed opener (a stray delimiter, informal money like
    // "$$100k for infra", a `\[deprecated\]`-style line) must NOT swallow the
    // rest of the document: scanDisplayMath scans ahead without committing
    // and answers null, and the line falls through as ordinary text.
    const mathDelimiter = trimmed.startsWith("$$")
      ? "$$"
      : trimmed.startsWith("\\[")
        ? "\\["
        : null;
    const math = mathDelimiter ? scanDisplayMath(lines, i, mathDelimiter) : null;
    if (math) {
      flush();
      const mathStartLine = currentLineNum;
      i = math.closeLine;
      blocks.push({
        id: `block-${currentId++}`,
        type: "math",
        content: math.body.join("\n"),
        order: currentId,
        startLine: mathStartLine,
        sourceLineCount: i + contentStartLine - mathStartLine + 1,
      });
      // Trailing text after the close isn't math — reprocess it as its own
      // line so it renders normally instead of being swallowed into the block.
      if (math.remainder) {
        lines[i] = math.remainder;
        i--;
      }
      continue;
    }

    // Tables (lines starting with |)
    if (trimmed.startsWith("|")) {
      flush();
      const tableStartLine = currentLineNum;
      const tableLines: string[] = [line];

      // Collect all consecutive table lines
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // Continue if line starts with | (table row or separator)
        if (nextLine.startsWith("|")) {
          i++;
          tableLines.push(lines[i]);
        } else {
          break;
        }
      }

      blocks.push({
        id: `block-${currentId++}`,
        type: "table",
        content: tableLines.join("\n"),
        order: currentId,
        startLine: tableStartLine,
      });
      continue;
    }

    // Directive container: `:::kind` opens, `:::` closes. Inline kind is
    // restricted to simple identifiers (letters, digits, hyphens). Body is
    // accumulated verbatim and rendered with inline markdown.
    const directiveOpen = trimmed.match(DIRECTIVE_OPEN_RE);
    if (directiveOpen) {
      flush();
      const directiveStartLine = currentLineNum;
      const kind = directiveOpen[1].toLowerCase();
      const close = directiveCloseIndex(lines, i);
      const bodyLines = lines.slice(i + 1, close);
      i = close;
      blocks.push({
        id: `block-${currentId++}`,
        type: "directive",
        content: bodyLines.join("\n"),
        directiveKind: kind,
        order: currentId,
        startLine: directiveStartLine,
      });
      continue;
    }

    // Raw HTML blocks. A line starting with a known block-level HTML tag
    // opens an HTML block. For opening tags we accumulate until the matching
    // close tag is balanced (so `<details>…blank line…</details>` renders as
    // one unit, matching GitHub's flavored behavior rather than strict
    // CommonMark §4.6 Type 6 blank-line termination). For a line that starts
    // with a close tag, we fall back to blank-line termination. Content is
    // sanitized at render time, not here.
    const htmlEnd = htmlBlockEndAt(lines, i, htmlCloseCache);
    if (htmlEnd !== -1) {
      flush();
      const htmlStartLine = currentLineNum;
      const htmlLines = lines.slice(i, htmlEnd + 1);
      i = htmlEnd;
      blocks.push({
        id: `block-${currentId++}`,
        type: "html",
        content: htmlLines.join("\n"),
        order: currentId,
        startLine: htmlStartLine,
      });
      continue;
    }

    // Empty lines separate paragraphs
    if (trimmed === "") {
      flush();
      currentType = "paragraph";
      lastLineWasBlank = true;
      continue;
    }
    // List continuation: indented line after a list item merges into it.
    // Tight (no blank line): 1+ whitespace, joined with \n (same paragraph).
    // Loose (after blank line): 2+ spaces, joined with \n\n (new paragraph within the item).
    if (
      buffer.length === 0 &&
      blocks.length > 0 &&
      blocks[blocks.length - 1].type === "list-item" &&
      (prevLineWasBlank ? /^\s{2,}/ : /^\s+/).test(line)
    ) {
      const sep = prevLineWasBlank ? "\n\n" : "\n";
      blocks[blocks.length - 1].content += sep + trimmed;
      continue;
    }

    // Accumulate paragraph text
    if (buffer.length === 0) {
      bufferStartLine = currentLineNum;
    }
    buffer.push(line);
  }

  flush(); // Final flush

  return blocks;
};

/**
 * Compute the display index for each list item in a contiguous list group.
 *
 * Returns a parallel array where each entry is either:
 *   - a positive integer (the numeral to render for an ordered item), or
 *   - null (the item is unordered, render a bullet symbol).
 *
 * Semantics:
 *   - A run of consecutive ordered items at the same level increments
 *     sequentially. The first item in a run uses its `orderedStart` (the
 *     number from the source markdown); subsequent items renumber from there
 *     so `1. / 2. / 5.` renders as 1, 2, 3 (matches CommonMark).
 *   - An unordered item at level L breaks the ordered streak at L. The next
 *     ordered item at L restarts from its own `orderedStart`.
 *   - Visiting a level shallower than the current one truncates deeper-level
 *     state, so re-entering that depth later starts fresh. Top-level numbering
 *     continues across nested children of any kind.
 */
export const computeListIndices = (blocks: Block[]): (number | null)[] => {
  const counters: number[] = [];
  const lastOrderedAtLevel: boolean[] = [];

  return blocks.map((block) => {
    const lvl = block.level || 0;
    // Sibling change at any deeper level resets those levels.
    counters.length = lvl + 1;
    lastOrderedAtLevel.length = lvl + 1;

    if (!block.ordered) {
      lastOrderedAtLevel[lvl] = false;
      return null;
    }

    if (lastOrderedAtLevel[lvl]) {
      counters[lvl] = (counters[lvl] ?? 0) + 1;
    } else {
      counters[lvl] = block.orderedStart ?? 1;
    }
    lastOrderedAtLevel[lvl] = true;
    return counters[lvl];
  });
};

/** A run of blocks to render: a single block, or consecutive list items grouped
 *  together so list numbering/indent can be computed across the run. */
export type RenderGroup =
  | { type: "single"; block: Block }
  | { type: "list-group"; blocks: Block[]; key: string };

/** Groups consecutive list-item blocks so a list renders as one unit. */
export function groupBlocks(blocks: Block[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].type === "list-item") {
      const listBlocks: Block[] = [];
      while (i < blocks.length && blocks[i].type === "list-item") {
        listBlocks.push(blocks[i]);
        i++;
      }
      groups.push({ type: "list-group", blocks: listBlocks, key: `list-${listBlocks[0].id}` });
    } else {
      groups.push({ type: "single", block: blocks[i] });
      i++;
    }
  }
  return groups;
}

/** Wrap feedback output with the deny preamble for pasting into agent sessions */
