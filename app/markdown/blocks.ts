import {
  DIRECTIVE_OPEN_RE,
  codeFenceCloseIndex,
  directiveCloseIndex,
  htmlBlockEndAt,
  resolveReferenceLinks,
  splitFrontmatter,
  type HtmlCloseCache,
} from "./structure";

export type AlertKind = "note" | "tip" | "warning" | "caution" | "important";

/**
 * One annotatable unit of the document. The document is a flat list of these (one per heading,
 * paragraph, list item, fence, table…), each knowing its source lines, so annotations anchor to
 * a block and the feedback can say which lines it is about.
 */
export interface Block {
  /** `block-<n>`; "" for blocks rendered inside another one (see `parseNested`). */
  id: string;
  type:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "list-item"
    | "code"
    | "hr"
    | "table"
    | "html"
    | "directive";
  /** Plain text; raw (unsanitized) HTML for `html`; the quote's own markdown for `blockquote`. */
  content: string;
  /** Heading level (1-6), or list nesting depth. */
  level?: number;
  /** Code fence language. */
  language?: string;
  /** Task list item state; undefined when not a task item. */
  checked?: boolean;
  ordered?: boolean;
  /** The number an ordered item's marker carries ("5." → 5). */
  orderedStart?: number;
  /** `> [!NOTE]` style alerts. */
  alertKind?: AlertKind;
  /** `:::kind` directive containers. */
  directiveKind?: string;
  /** 1-based source lines. */
  startLine: number;
  endLine: number;
}

/** Splits markdown into blocks. A leading frontmatter block is not shown. */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  const { content, contentStartLine } = splitFrontmatter(markdown.replace(/\r\n?/g, "\n"));
  return parse(content, contentStartLine, (n) => `block-${n}`);
}

/** The blocks of a quote, callout or question context: no ids, so they belong to their parent. */
export function parseNested(markdown: string): Block[] {
  return parse(markdown, 1, () => "");
}

const ALERT_RE = /^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*$/i;
const unquote = (line: string) => line.replace(/^\s*>[ \t]?/, "").trimEnd();

function parse(markdown: string, firstLine: number, idFor: (n: number) => string): Block[] {
  const lines = resolveReferenceLinks(markdown).split("\n");
  const blocks: Block[] = [];
  const htmlCache: HtmlCloseCache = new Map();
  const push = (block: Omit<Block, "id">) => blocks.push({ id: idFor(blocks.length), ...block });

  let paragraph: string[] = [];
  let paragraphStart = 0;
  const flush = (endIndex: number) => {
    if (paragraph.length === 0) return;
    push({
      type: "paragraph",
      content: paragraph.join("\n"),
      startLine: paragraphStart,
      endLine: endIndex + firstLine,
    });
    paragraph = [];
  };

  let previousBlank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNumber = i + firstLine;
    const afterBlank = previousBlank;
    previousBlank = trimmed === "";
    const single = (block: Omit<Block, "id" | "startLine" | "endLine">) => {
      flush(i - 1);
      push({ ...block, startLine: lineNumber, endLine: lineNumber });
    };

    // ATX headings need a space after the `#`s: `#123` and `#!/bin/sh` are text.
    const heading = /^(#{1,6})(?:\s|$)/.exec(trimmed);
    if (heading) {
      single({ type: "heading", content: trimmed.replace(/^#+\s*/, ""), level: heading[1].length });
      continue;
    }

    if (trimmed === "---" || trimmed === "***") {
      single({ type: "hr", content: "" });
      continue;
    }

    const listItem = /^(\*|-|(\d+)\.)\s/.exec(trimmed);
    if (listItem) {
      let content = trimmed.slice(listItem[0].length);
      const task = /^\[([ xX])\]\s*/.exec(content);
      if (task) content = content.slice(task[0].length);
      const indent = /^\s*/.exec(line)![0].replace(/\t/g, "  ").length;
      single({
        type: "list-item",
        content,
        level: Math.floor(indent / 2),
        checked: task ? task[1] !== " " : undefined,
        ordered: listItem[2] !== undefined || undefined,
        orderedStart: listItem[2] === undefined ? undefined : Number(listItem[2]),
      });
      continue;
    }

    // A run of `>` lines is one quote (blank `>` lines included), as GitHub draws it. `[!KIND]`
    // on its first line makes it an alert.
    if (trimmed.startsWith(">")) {
      flush(i - 1);
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith(">")) end++;
      const inner = lines.slice(i, end + 1).map(unquote);
      const alert = ALERT_RE.exec(inner[0]);
      let first = alert ? 1 : 0;
      while (first < inner.length - 1 && inner[first] === "") first++;
      let last = inner.length - 1;
      while (last > first && inner[last] === "") last--;
      push({
        type: "blockquote",
        content: inner.slice(first, last + 1).join("\n"),
        alertKind: alert ? (alert[1].toLowerCase() as AlertKind) : undefined,
        startLine: lineNumber + (alert ? 0 : first),
        endLine: lineNumber + last,
      });
      i = end;
      continue;
    }

    if (trimmed.startsWith("```")) {
      flush(i - 1);
      const close = codeFenceCloseIndex(lines, i);
      const fence = /^`+/.exec(trimmed)![0];
      push({
        type: "code",
        content: lines.slice(i + 1, close).join("\n"),
        language: trimmed.slice(fence.length).trim() || undefined,
        startLine: lineNumber,
        endLine: Math.min(close, lines.length - 1) + firstLine,
      });
      i = close;
      continue;
    }

    if (trimmed.startsWith("|")) {
      flush(i - 1);
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].trim().startsWith("|")) end++;
      push({
        type: "table",
        content: lines.slice(i, end + 1).join("\n"),
        startLine: lineNumber,
        endLine: end + firstLine,
      });
      i = end;
      continue;
    }

    const directive = DIRECTIVE_OPEN_RE.exec(trimmed);
    if (directive) {
      flush(i - 1);
      const close = directiveCloseIndex(lines, i);
      push({
        type: "directive",
        content: lines.slice(i + 1, close).join("\n"),
        directiveKind: directive[1].toLowerCase(),
        startLine: lineNumber,
        endLine: Math.min(close, lines.length - 1) + firstLine,
      });
      i = close;
      continue;
    }

    const htmlEnd = htmlBlockEndAt(lines, i, htmlCache);
    if (htmlEnd !== -1) {
      flush(i - 1);
      push({
        type: "html",
        content: lines.slice(i, htmlEnd + 1).join("\n"),
        startLine: lineNumber,
        endLine: htmlEnd + firstLine,
      });
      i = htmlEnd;
      continue;
    }

    if (trimmed === "") {
      flush(i - 1);
      continue;
    }

    // An indented line right under a list item continues it; after a blank line it needs two
    // spaces and starts a new paragraph within the item.
    const last = blocks[blocks.length - 1];
    if (
      paragraph.length === 0 &&
      last?.type === "list-item" &&
      (afterBlank ? /^\s{2,}/ : /^\s+/).test(line)
    ) {
      last.content += (afterBlank ? "\n\n" : "\n") + trimmed;
      last.endLine = lineNumber;
      continue;
    }

    if (paragraph.length === 0) paragraphStart = lineNumber;
    paragraph.push(line);
  }
  flush(lines.length - 1);
  return blocks;
}

/**
 * The number each item of a run of list items shows, or null for a bullet. Consecutive ordered
 * items at one level count up from the first one's own number (`1. 2. 5.` shows 1, 2, 3, as
 * CommonMark does); a bullet at that level, or leaving the level, restarts the count.
 */
export function computeListIndices(blocks: readonly Block[]): (number | null)[] {
  const counters: (number | null)[] = [];
  return blocks.map((block) => {
    const level = block.level ?? 0;
    counters.length = level + 1;
    if (!block.ordered) {
      counters[level] = null;
      return null;
    }
    const previous = counters[level];
    counters[level] = previous == null ? (block.orderedStart ?? 1) : previous + 1;
    return counters[level];
  });
}

/** Runs of list items grouped so a list renders (and numbers) as one unit. */
export function groupBlocks(blocks: readonly Block[]): (Block | Block[])[] {
  const groups: (Block | Block[])[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (block.type !== "list-item") groups.push(block);
    else if (Array.isArray(last)) last.push(block);
    else groups.push([block]);
  }
  return groups;
}

/** Heading text as an anchor id: inline markdown out, unicode letters kept. */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/** Block id → anchor id for every heading; repeats get `-1`, `-2`… as on GitHub. */
export function headingSlugs(blocks: readonly Block[]): Map<string, string> {
  const map = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const base = slugify(block.content);
    if (!base) continue;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    map.set(block.id, n === 0 ? base : `${base}-${n}`);
  }
  return map;
}
