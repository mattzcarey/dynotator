/**
 * The multi-line extents the block parser needs: frontmatter, backtick fences, directives,
 * raw HTML blocks, and link reference definitions resolved into inline links.
 */

/** The markdown after a leading `--- … ---` block, and the 1-based line where it starts. */
export function splitFrontmatter(markdown: string): { content: string; contentStartLine: number } {
  const trimmed = markdown.trimStart();
  const end = trimmed.startsWith("---") ? trimmed.indexOf("\n---", 3) : -1;
  if (end === -1) return { content: markdown, contentStartLine: 1 };
  const after = trimmed.slice(end + 4);
  const content = after.trimStart();
  const consumed = markdown.length - trimmed.length + end + 4 + (after.length - content.length);
  return { content, contentStartLine: markdown.slice(0, consumed).split("\n").length };
}

/** The line closing the backtick fence opened at `i` (a run at least as long), or `lines.length`. */
export function codeFenceCloseIndex(lines: string[], i: number): number {
  const fenceLen = /^`+/.exec(lines[i].trim())?.[0].length ?? 3;
  const closing = new RegExp(`^\\s*\`{${fenceLen},}`);
  let j = i + 1;
  while (j < lines.length && !closing.test(lines[j])) j++;
  return j;
}

/** A fence for quoting `code`: longer than any backtick run in it, so nothing inside closes it. */
export function codeFenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** `:::kind` alone on its line. */
export const DIRECTIVE_OPEN_RE = /^:::\s*([a-zA-Z][a-zA-Z0-9-]*)\s*$/;

/** The first bare `:::` after line `i` (directives do not nest), or `lines.length`. */
export function directiveCloseIndex(lines: string[], i: number): number {
  for (let j = i + 1; j < lines.length; j++) if (lines[j].trim() === ":::") return j;
  return lines.length;
}

/** Block-level tags that open a raw HTML block when a line starts with one. */
const HTML_BLOCK_TAGS = new Set([
  "details",
  "summary",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "ul",
  "ol",
  "li",
  "p",
  "img",
  "video",
  "picture",
]);
const VOID_TAGS = new Set(["img"]);
const HTML_BLOCK_OPEN_RE = /^<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s|>|\/|$)/;

/**
 * Per tag name: the running count of open minus close tags before each line, and for each line
 * the next line where the count is back at or below it. That makes finding where a block closes
 * O(1), so a document of thousands of unclosed `<div>` lines stays linear.
 */
interface TagIndex {
  depth: number[];
  nextAtOrBelow: number[];
}
export type HtmlCloseCache = Map<string, TagIndex>;

const tagCount = (line: string, tag: string): number =>
  (line.match(new RegExp(`<${tag}(?:\\s|>|/|$)`, "gi")) ?? []).length -
  (line.match(new RegExp(`</${tag}\\s*>`, "gi")) ?? []).length;

function buildTagIndex(lines: string[], tag: string): TagIndex {
  const depth = [0];
  for (const line of lines) depth.push(depth[depth.length - 1] + tagCount(line, tag));
  const nextAtOrBelow = depth.map(() => -1);
  const stack: number[] = [];
  for (let m = depth.length - 1; m >= 0; m--) {
    while (stack.length && depth[stack[stack.length - 1]] > depth[m]) stack.pop();
    nextAtOrBelow[m] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(m);
  }
  return { depth, nextAtOrBelow };
}

/**
 * The last line of the raw HTML block line `i` opens, or -1 when it opens none. A leading close
 * tag runs to the next blank line, `<img>` to the line closing it with `>`, any other tag to its
 * balanced close tag (blank lines included, as GitHub renders `<details>`), or only its own line
 * when it never closes.
 */
export function htmlBlockEndAt(lines: string[], i: number, cache: HtmlCloseCache): number {
  const trimmed = lines[i].trim();
  const tag = HTML_BLOCK_OPEN_RE.exec(trimmed)?.[1].toLowerCase();
  if (!tag || !HTML_BLOCK_TAGS.has(tag)) return -1;
  let end = i;
  if (trimmed.startsWith("</")) {
    while (end + 1 < lines.length && lines[end + 1].trim() !== "") end++;
    return end;
  }
  if (VOID_TAGS.has(tag)) {
    while (!lines[end].includes(">") && end + 1 < lines.length && lines[end + 1].trim() !== "")
      end++;
    return end;
  }
  if (tagCount(lines[i], tag) <= 0) return i;
  let index = cache.get(tag);
  if (!index) {
    index = buildTagIndex(lines, tag);
    cache.set(tag, index);
  }
  const m = index.nextAtOrBelow[i];
  return m !== -1 && index.depth[m] === index.depth[i] ? m - 1 : i;
}

// CommonMark bounds labels to 999 characters; the bound also keeps a long run of `[` linear.
const LABEL = "[^\\]]{1,999}";
// `[label]: destination "optional title"`. Trailing prose (`[Reminder]: call the bank`) is not one.
const DEFINITION_RE = new RegExp(
  `^ {0,3}\\[(${LABEL})\\]:[ \\t]*(?:<([^>]*)>|(\\S+))[ \\t]*(?:"[^"]*"|'[^']*'|\\([^)]*\\))?[ \\t]*$`,
);
// A whole code span (kept verbatim), or `[text]`, `[text][label]`, `[text][]`, `![...]...`.
const REFERENCE_RE = new RegExp(
  `(\`+)[^\\n]{0,5000}?\\1|(!?)\\[(${LABEL})\\](\\[([^\\]]{0,999})\\])?`,
  "g",
);

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

/** Lines inside fences or raw HTML blocks, which reference resolution leaves alone. */
function protectedLines(lines: string[]): boolean[] {
  const out = lines.map(() => false);
  const cache: HtmlCloseCache = new Map();
  for (let i = 0; i < lines.length; i++) {
    const end = lines[i].trim().startsWith("```")
      ? Math.min(codeFenceCloseIndex(lines, i), lines.length - 1)
      : htmlBlockEndAt(lines, i, cache);
    if (end === -1) continue;
    for (let j = i; j <= end; j++) out[j] = true;
    i = end;
  }
  return out;
}

/**
 * Reference links (`[text][id]`, `[id]`) rewritten as inline links, and the definitions they
 * used blanked in place so every block keeps its line numbers. Unknown references, unused
 * definitions, footnotes (`[^1]:`), and anything in code or raw HTML stay as written.
 */
export function resolveReferenceLinks(markdown: string): string {
  if (!markdown.includes("]:")) return markdown;
  const lines = markdown.split("\n");
  const skip = protectedLines(lines);
  const defs = new Map<string, string>();
  const defLabel: (string | null)[] = lines.map(() => null);
  // A definition cannot interrupt a paragraph.
  let canStart = true;
  lines.forEach((line, i) => {
    if (skip[i]) {
      canStart = true;
      return;
    }
    const match = canStart && line.trim() ? DEFINITION_RE.exec(line) : null;
    if (!match) {
      canStart = line.trim() === "";
      return;
    }
    if (match[1].startsWith("^")) return;
    const label = normalizeLabel(match[1]);
    const dest = match[2] ?? match[3];
    if (label && dest && !defs.has(label)) defs.set(label, dest);
    defLabel[i] = label;
  });
  if (defs.size === 0) return markdown;

  const used = new Set<string>();
  const resolve = (line: string) =>
    line.replace(
      REFERENCE_RE,
      (match, ticks, bang, text: string, second, label: string, offset: number, whole: string) => {
        if (ticks !== undefined) return match;
        if (second === undefined) {
          // `[text](…)` is an inline link; `- [x]` a task marker.
          if (whole[offset + match.length] === "(") return match;
          if (/^[ xX]$/.test(text) && /^\s*(?:[-*+]|\d+[.)])\s+$/.test(whole.slice(0, offset)))
            return match;
        }
        const key = normalizeLabel(second === undefined || label === "" ? text : label);
        const dest = defs.get(key);
        if (!dest) return match;
        used.add(key);
        return `${bang}[${text}](${dest})`;
      },
    );
  const resolved = lines.map((line, i) =>
    skip[i] || defLabel[i] !== null || !line.includes("[") ? line : resolve(line),
  );
  return resolved
    .map((line, i) => (defLabel[i] !== null && used.has(defLabel[i]) ? "" : line))
    .join("\n");
}
