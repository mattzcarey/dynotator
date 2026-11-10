import React, { createContext, useContext, useState, useMemo } from "react";
import { transformPlainText } from "../utils/inlineTransforms";
import { getImageSrc } from "./ImageThumbnail";
import { UNAVAILABLE_IMAGE_CLASS, useImageResolver } from "./ImageResolverContext";
import { normalizeMathTex, renderMathToHtml } from "../utils/math";
import { useMathRenderer } from "../hooks/useMathRenderer";

const DANGEROUS_PROTOCOL = /^\s*(javascript|data|vbscript|file)\s*:/i;
/**
 * A code span at the start of `text`, as CommonMark reads one: a run of N
 * backticks closed by the next run of exactly N, so a span can hold shorter
 * runs (``use `x` here``). One space comes off each side when both sides have
 * one and the content is not all spaces, so `` `x` `` shows `x` in backticks.
 * Null when no run of the same length closes it.
 */
export function matchCodeSpan(text: string): { content: string; length: number } | null {
  const open = /^`+/.exec(text);
  if (!open) return null;
  const width = open[0].length;
  const runs = /`+/g;
  runs.lastIndex = width;
  for (let run = runs.exec(text); run; run = runs.exec(text)) {
    if (run[0].length !== width) continue;
    let content = text.slice(width, run.index);
    if (
      content.length > 1 &&
      content[0] === " " &&
      content[content.length - 1] === " " &&
      content.trim() !== ""
    ) {
      content = content.slice(1, -1);
    }
    return content ? { content, length: run.index + width } : null;
  }
  return null;
}

function sanitizeLinkUrl(url: string): string | null {
  if (DANGEROUS_PROTOCOL.test(url)) return null;
  return url;
}

const InlineMath: React.FC<{ tex: string }> = ({ tex }) => {
  const normalizedTex = normalizeMathTex(tex);
  const renderer = useMathRenderer();
  const html = useMemo(
    () => renderMathToHtml(normalizedTex, false, renderer),
    [normalizedTex, renderer],
  );

  // Same wrapper in both branches (see MathBlock): the placeholder carries the
  // attributes annotation restore keys on, with the TeX as a text child.
  if (html === null) {
    return (
      <span
        className="math-inline math-annotatable text-foreground"
        data-math-tex={normalizedTex}
        data-math-display="false"
        aria-label={normalizedTex}
      >
        {normalizedTex}
      </span>
    );
  }

  return (
    <span
      className="math-inline math-annotatable text-foreground"
      data-math-tex={normalizedTex}
      data-math-display="false"
      aria-label={normalizedTex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

function canRenderSpacedDollarMath(tex: string): boolean {
  const trimmed = normalizeMathTex(tex);
  if (!trimmed) return false;
  if (!/^\s|\s$/.test(tex)) return true;
  // Padding must be symmetric (`$ y $`). In `$write-better on the copy, and $`
  // the closing `$` is really the opener of the next `$skill` token.
  if (/^\s/.test(tex) !== /\s$/.test(tex)) return false;
  return (
    /\\[a-zA-Z]+/.test(trimmed) || /[=^_{}+\-*/<>|]/.test(trimmed) || /^[a-zA-Z]$/.test(trimmed)
  );
}

// Trim trailing sentence punctuation from a bare URL, but keep closing
// brackets when they balance an opener inside the URL (Wikipedia-style
// https://…/Function_(mathematics) should keep its closing paren).
export function trimUrlTail(url: string): string {
  const balanced = (u: string, close: string, open: string): boolean => {
    let opens = 0,
      closes = 0;
    for (const c of u) {
      if (c === open) opens++;
      else if (c === close) closes++;
    }
    return opens >= closes;
  };
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (!/[.,;:!?)\]}>"']/.test(last)) break;
    if (last === ")" && balanced(url, ")", "(")) break;
    if (last === "]" && balanced(url, "]", "[")) break;
    if (last === "}" && balanced(url, "}", "{")) break;
    url = url.slice(0, -1);
  }
  return url;
}

// Index of the first bare `http(s)://` URL that starts after index 0 and
// before `end` at a word boundary AND runs past `end`, or -1. Only such a
// URL needs the chunk split: one that ends inside the chunk is linked by
// emitPlainTextWithBareUrls in the same pass, exactly as before, so a
// paragraph of many URLs stays one pass instead of a loop turn (and a
// rescan of the rest of the text) per URL. Index 0 is left to the caller's
// own bare-URL check, which already ran for it.
const BARE_URL_SCHEME = /https?:\/\//g;
const BARE_URL_AT = /https?:\/\/[^\s<>"']+/y;
function bareUrlRunningPast(text: string, end: number): number {
  // Only a scheme that starts before `end` counts, so read no further than
  // `end` plus the longest scheme ("https://" less its first character).
  const window = text.slice(0, end + 7);
  BARE_URL_SCHEME.lastIndex = 1;
  let m: RegExpExecArray | null;
  while ((m = BARE_URL_SCHEME.exec(window)) !== null && m.index < end) {
    if (/\w/.test(window[m.index - 1])) continue;
    BARE_URL_AT.lastIndex = m.index;
    const url = BARE_URL_AT.exec(text);
    if (!url) continue;
    const urlEnd = m.index + trimUrlTail(url[0]).length;
    if (urlEnd > end) return m.index;
    // The URL ends inside the chunk; look for the next one after it.
    BARE_URL_SCHEME.lastIndex = Math.max(urlEnd, m.index + 1);
  }
  return -1;
}

// Scan a plain-text chunk for bare https?:// URLs and bare code file paths
// at word boundaries, emitting them as interactive nodes. Surrounding text
// passes through transformPlainText for emoji shortcodes + smart punctuation.
function emitPlainTextWithBareUrls(
  text: string,
  previousChar: string,
  parts: React.ReactNode[],
  nextKey: () => number,
): void {
  if (text.length === 0) return;

  type Span = { start: number; end: number; value: string };
  const spans: Span[] = [];

  // Collect bare URLs
  const urlRe = /https?:\/\/[^\s<>"']+/g;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    const before = m.index === 0 ? previousChar : text[m.index - 1];
    if (/\w/.test(before)) continue;
    const url = trimUrlTail(m[0]);
    const safe = url.length > 0 ? sanitizeLinkUrl(url) : null;
    if (!safe) continue;
    spans.push({ start: m.index, end: m.index + url.length, value: url });
    urlRe.lastIndex = m.index + url.length;
  }

  if (spans.length === 0) {
    parts.push(transformPlainText(text));
    return;
  }

  spans.sort((a, b) => a.start - b.start);

  let last = 0;
  for (const span of spans) {
    if (span.start > last) {
      parts.push(transformPlainText(text.slice(last, span.start)));
    }
    parts.push(
      <a
        key={nextKey()}
        href={span.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
      >
        {span.value}
      </a>,
    );
    last = span.end;
  }
  if (last < text.length) {
    parts.push(transformPlainText(text.slice(last)));
  }
}

/**
 * An image a host resolver chose; a load failure shows the placeholder.
 *
 * The `<img>` element itself never leaves the document: on failure the
 * placeholder is inserted BEFORE it (React's reference node is then the
 * `<img>`, which it owns) and the `<img>` is hidden. Replacing the `<img>`
 * would make React insert before the node that follows it, and when that is
 * a text node the annotation highlighter already moved into a `<mark>` (a
 * restored comment starting right after the image), `insertBefore` throws
 * and the whole document unmounts. A loaded image's DOM is unchanged.
 */
const HostResolvedImage: React.FC<{
  src: string;
  alt: string;
  /** The original's width when `src` is a smaller copy (`ImageResolution.width`). */
  width?: number;
  /** The src as written in the markdown (`data-image-src`, read by the image viewer's region comments). */
  writtenSrc?: string;
  onImageClick?: (src: string, alt: string) => void;
}> = ({ src, alt, width, writtenSrc, onImageClick }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  return (
    <>
      {failed && (
        <span
          key="unavailable"
          className={`${UNAVAILABLE_IMAGE_CLASS} annotation-exclude`}
          title="Image could not be loaded"
          data-image-unavailable=""
        >
          {alt || "Image"}
        </span>
      )}
      <img
        key="image"
        src={src}
        alt={failed ? "" : alt}
        width={width}
        data-image-src={writtenSrc}
        data-image-failed={failed ? "" : undefined}
        hidden={failed || undefined}
        aria-hidden={failed || undefined}
        className={failed ? undefined : "max-w-full rounded my-2 cursor-zoom-in"}
        loading="lazy"
        // Only for a host's smaller copy (`width`): the default stays as it was for every other host.
        decoding={width ? "async" : undefined}
        onError={() => setFailedSrc(src)}
        onClick={(e) => {
          e.stopPropagation();
          if (!failed) onImageClick?.(src, alt);
        }}
      />
    </>
  );
};

/**
 * Forge comment text (a GitHub issue, PR or comment body) shows every newline
 * as a line break. Provided by `RenderedMarkdown`'s `softLineBreaks` prop;
 * absent (false), a bare newline stays a soft break (a space), as in files.
 */
export const SoftLineBreaksContext = createContext<boolean>(false);

/**
 * Scanner that walks a text string and emits React nodes for inline markdown:
 * emphasis (**bold**, *italic*, _italic_, ***both***), `code`, ~~strikethrough~~,
 * [label](url) / ![alt](src) / <autolink>, bare https:// URLs, [[wiki-links]],
 * inline math ($...$), hex color swatches (#fff / #123abc), @mentions, #issue-refs, and backslash
 * escapes. Plain-text chunks outside these patterns pass through
 * `transformPlainText` for emoji shortcodes + smart punctuation.
 */
export const InlineMarkdown: React.FC<{
  text: string;
  onNavigateAnchor?: (hash: string) => void;
  imageBaseDir?: string;
  onImageClick?: (src: string, alt: string) => void;
  /**
   * The text is a link's label: code, emphasis, strikethrough, escapes, math
   * and images render, and nothing that is itself a link does, since a link
   * cannot hold another.
   */
  linkLabel?: boolean;
}> = ({ text, onNavigateAnchor, imageBaseDir, onImageClick, linkLabel = false }) => {
  const softLineBreaks = useContext(SoftLineBreaksContext);
  const resolveImage = useImageResolver();
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  let previousChar = "";

  while (remaining.length > 0) {
    // HTML comments: skip entirely — they should be invisible per CommonMark.
    // The parser doesn't recognize <!-- --> as a block-level construct, so
    // comments inside paragraphs land here. Without this, path detection
    // would linkify paths inside comments.
    let match = remaining.match(/^<!--[\s\S]*?-->/);
    if (match) {
      remaining = remaining.slice(match[0].length);
      previousChar = ">";
      continue;
    }

    // Inline math: \( ... \) or $...$ — require non-space content and avoid
    // display fences.
    if (remaining.startsWith("\\(")) {
      let end = -1;
      for (let i = 2; i < remaining.length - 1; i++) {
        if (remaining[i] === "\\" && remaining[i + 1] === ")") {
          if (i > 0 && remaining[i - 1] === "\\") continue;
          end = i;
          break;
        }
      }
      if (end > 1) {
        const tex = remaining.slice(2, end);
        if (tex.trim()) {
          parts.push(<InlineMath key={key++} tex={tex} />);
          remaining = remaining.slice(end + 2);
          previousChar = ")";
          continue;
        }
      }
    }

    // Backslash escaping: \. \* \_ \` \[ \~ \$ etc. — emit literal char, hide backslash
    match = remaining.match(/^\\([\\*_`\[\]~!.()\-#>+|{}&$])/);
    if (match) {
      parts.push(match[1]);
      remaining = remaining.slice(2);
      previousChar = match[1];
      continue;
    }

    // Inline math: $...$ — require non-space content and avoid $$ display fences.
    if (remaining.startsWith("$") && previousChar !== "$" && !remaining.startsWith("$$")) {
      let end = -1;
      for (let i = 1; i < remaining.length; i++) {
        if (remaining[i] === "\\") {
          i++;
          continue;
        }
        if (remaining[i] === "$") {
          end = i;
          break;
        }
      }
      if (end > 1) {
        const tex = remaining.slice(1, end);
        // Money guard: `$A$B` where a digit immediately follows the closing `$`
        // is almost always two currency amounts ("$5-$10", "$50,000-$100,000",
        // "$5/mo and tier B is $10/mo"), not inline math — real inline math never
        // abuts a digit across the closing delimiter. Leave such text literal.
        const afterClose = remaining[end + 1];
        const looksLikeMoney =
          /^\s*\d/.test(tex) && afterClose !== undefined && /\d/.test(afterClose);
        if (!looksLikeMoney && canRenderSpacedDollarMath(tex)) {
          parts.push(<InlineMath key={key++} tex={tex} />);
          remaining = remaining.slice(end + 1);
          previousChar = "$";
          continue;
        }
      }
    }

    // Bare URL autolink: https://… preceded by word boundary.
    // Trailing sentence punctuation is trimmed so "See https://x.com."
    // renders the period outside the link. Closing brackets are kept when
    // they balance an earlier opener inside the URL (e.g. Wikipedia's
    // https://…/Function_(mathematics) keeps its trailing paren).
    if (!linkLabel && !/\w/.test(previousChar)) {
      const bareMatch = remaining.match(/^https?:\/\/[^\s<>"']+/);
      if (bareMatch) {
        const url = trimUrlTail(bareMatch[0]);
        const safe = url.length > 0 ? sanitizeLinkUrl(url) : null;
        if (safe) {
          parts.push(
            <a
              key={key++}
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
            >
              {url}
            </a>,
          );
          remaining = remaining.slice(url.length);
          previousChar = url[url.length - 1];
          continue;
        }
      }
    }

    // Autolinks: <https://url> or <email@domain.com>
    match = remaining.match(/^<(https?:\/\/[^>]+)>/);
    if (match && !linkLabel) {
      const url = match[1];
      parts.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
        >
          {url}
        </a>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = ">";
      continue;
    }
    match = remaining.match(/^<([^@>\s]+@[^>\s]+)>/);
    if (match && !linkLabel) {
      const email = match[1];
      parts.push(
        <a
          key={key++}
          href={`mailto:${email}`}
          className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
        >
          {email}
        </a>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = ">";
      continue;
    }

    // Keep custom autolinks literal; their contents should not
    // recurse into markdown parsing.
    match = remaining.match(/^<([A-Za-z][A-Za-z0-9.+-]{0,31}:[^\s<>]*)>/);
    if (match) {
      const content = match[1];
      parts.push(<span key={key++}>{`<${content}>`}</span>);
      remaining = remaining.slice(match[0].length);
      previousChar = ">";
      continue;
    }

    // Strikethrough: ~~text~~
    match = remaining.match(/^~~([\s\S]+?)~~/);
    if (match) {
      parts.push(
        <del key={key++}>
          <InlineMarkdown
            imageBaseDir={imageBaseDir}
            onImageClick={onImageClick}
            text={match[1]}
            onNavigateAnchor={onNavigateAnchor}
          />
        </del>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Bold + italic: ***text***
    match = remaining.match(/^\*\*\*([\s\S]+?)\*\*\*/);
    if (match) {
      parts.push(
        <strong key={key++} className="font-semibold">
          <em>
            <InlineMarkdown
              imageBaseDir={imageBaseDir}
              onImageClick={onImageClick}
              text={match[1]}
              onNavigateAnchor={onNavigateAnchor}
            />
          </em>
        </strong>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Bold: **text** ([\s\S]+? allows matching across hard line breaks)
    match = remaining.match(/^\*\*([\s\S]+?)\*\*/);
    if (match) {
      parts.push(
        <strong key={key++} className="font-semibold">
          <InlineMarkdown
            imageBaseDir={imageBaseDir}
            onImageClick={onImageClick}
            text={match[1]}
            onNavigateAnchor={onNavigateAnchor}
          />
        </strong>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Italic: *text* or _text_ (avoid intraword underscores)
    match = remaining.match(/^\*([\s\S]+?)\*/);
    if (match) {
      parts.push(
        <em key={key++}>
          <InlineMarkdown
            imageBaseDir={imageBaseDir}
            onImageClick={onImageClick}
            text={match[1]}
            onNavigateAnchor={onNavigateAnchor}
          />
        </em>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    match = !/\w/.test(previousChar)
      ? remaining.match(/^_([^_\s](?:[\s\S]*?[^_\s])?)_(?!\w)/)
      : null;
    if (match) {
      parts.push(
        <em key={key++}>
          <InlineMarkdown
            imageBaseDir={imageBaseDir}
            onImageClick={onImageClick}
            text={match[1]}
            onNavigateAnchor={onNavigateAnchor}
          />
        </em>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Inline code: `code` — when the content is a code file path, render as clickable
    const codeSpan = remaining[0] === "`" ? matchCodeSpan(remaining) : null;
    if (remaining[0] === "`" && !codeSpan) {
      // A run with no closing run of the same length is literal, all of it: its
      // tail must not open a shorter span with a later backtick.
      const run = remaining.match(/^`+/)![0];
      parts.push(run);
      remaining = remaining.slice(run.length);
      previousChar = "`";
      continue;
    }
    if (codeSpan) {
      const codeContent = codeSpan.content;
      parts.push(
        <code
          key={key++}
          className="px-1 py-px rounded border border-border bg-surface-0 text-[0.84em] font-mono"
        >
          {codeContent}
        </code>,
      );
      remaining = remaining.slice(codeSpan.length);
      previousChar = "`";
      continue;
    }

    // Hex color swatch — 3/4-digit forms need an a-f letter to avoid matching issue refs like #123.
    match = remaining.match(
      /^(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{4}|(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3}))(?![0-9a-fA-F\w])/,
    );
    if (match) {
      const hex = match[1];
      parts.push(
        <span key={key++} className="inline-flex items-center gap-1 align-middle">
          <span
            className="inline-block w-3.5 h-3.5 rounded-sm border border-black/20 dark:border-white/20 flex-shrink-0"
            style={{ backgroundColor: hex }}
            title={hex}
          />
          <code className="px-1 py-px rounded border border-border bg-surface-0 text-[0.84em] font-mono">
            {hex}
          </code>
        </span>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Issue / PR reference: #123 — only at word boundary, digits only.
    // Hex-swatch branch above already consumed #fff / #123abc etc. (and digit-only
    // #123456 / #12345678 unless the host opted in), so a bare #\d+ here is an issue ref.
    if (!linkLabel && !/\w/.test(previousChar)) {
      match = remaining.match(/^#(\d+)(?!\w)/);
      if (match) {
        const num = match[1];
        const label = `#${num}`;
        parts.push(
          <span key={key++} className="text-primary font-medium">
            {label}
          </span>,
        );
        remaining = remaining.slice(match[0].length);
        previousChar = match[0][match[0].length - 1];
        continue;
      }
    }

    // @mention — only at word boundary. GitHub-style handle pattern.
    if (!linkLabel && !/\w/.test(previousChar)) {
      match = remaining.match(/^@([a-zA-Z][a-zA-Z0-9_-]{0,38})(?!\w)/);
      if (match) {
        const handle = match[1];
        const label = `@${handle}`;
        parts.push(
          <span key={key++} className="text-primary font-medium">
            {label}
          </span>,
        );
        remaining = remaining.slice(match[0].length);
        previousChar = match[0][match[0].length - 1];
        continue;
      }
    }

    // Wikilinks: [[filename]] or [[filename|display text]]
    match = remaining.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (match && !linkLabel) {
      const target = match[1].trim();
      const storedLabel = match[2]?.trim();
      parts.push(
        <span key={key++} className="text-primary">
          {storedLabel || target}
        </span>,
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Images: ![alt](path)
    match = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (match) {
      const alt = match[1];
      const src = match[2];
      // A host's resolver (RenderedMarkdown `resolveImage`) decides first;
      // null from it, or no resolver, keeps the default resolution.
      const resolvedImage = resolveImage ? resolveImage(src) : null;
      if (resolvedImage?.kind === "unavailable") {
        parts.push(
          <span
            key={key++}
            className={UNAVAILABLE_IMAGE_CLASS}
            title={resolvedImage.title}
            data-image-unavailable=""
          >
            {alt || "Image"}
          </span>,
        );
        remaining = remaining.slice(match[0].length);
        previousChar = match[0][match[0].length - 1] || previousChar;
        continue;
      }
      const imgSrc =
        resolvedImage?.kind === "src"
          ? resolvedImage.src
          : /^(https?:\/\/|data:|blob:)/i.test(src)
            ? src
            : getImageSrc(src, imageBaseDir);
      parts.push(
        resolveImage ? (
          // With a host resolver, an image that fails to load becomes the
          // same placeholder instead of a broken-image icon.
          <HostResolvedImage
            key={key++}
            src={imgSrc}
            alt={alt}
            width={resolvedImage?.kind === "src" ? resolvedImage.width : undefined}
            writtenSrc={src}
            onImageClick={onImageClick}
          />
        ) : (
          <img
            key={key++}
            src={imgSrc}
            alt={alt}
            data-image-src={src}
            className="max-w-full rounded my-2 cursor-zoom-in"
            loading="lazy"
            onClick={(e) => {
              e.stopPropagation();
              onImageClick?.(imgSrc, alt);
            }}
          />
        ),
      );
      remaining = remaining.slice(match[0].length);
      previousChar = match[0][match[0].length - 1] || previousChar;
      continue;
    }

    // Links: [text](url) — url may contain balanced parens (e.g. Wikipedia
    // /Function_(mathematics)). Plain `[^)]+` would truncate at the first
    // inner close-paren, so we scan the destination manually tracking depth.
    const linkParsed = (() => {
      if (linkLabel || remaining[0] !== "[") return null;
      let i = 1;
      let depth = 1;
      while (i < remaining.length && depth > 0) {
        const ch = remaining[i];
        if (ch === "\\" && i + 1 < remaining.length) {
          i += 2;
          continue;
        }
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        if (depth === 0) break;
        i++;
      }
      if (depth !== 0 || remaining[i + 1] !== "(") return null;
      const textEnd = i;
      let j = i + 2;
      let parenDepth = 1;
      while (j < remaining.length && parenDepth > 0) {
        const ch = remaining[j];
        if (ch === "\\" && j + 1 < remaining.length) {
          j += 2;
          continue;
        }
        if (ch === "(") parenDepth++;
        else if (ch === ")") {
          parenDepth--;
          if (parenDepth === 0) break;
        } else if (ch === "\n") return null;
        j++;
      }
      if (parenDepth !== 0) return null;
      const linkText = remaining.slice(1, textEnd);
      const linkUrl = remaining.slice(i + 2, j);
      if (!linkText || !linkUrl) return null;
      return { linkText, linkUrl, consumed: j + 1 };
    })();
    if (linkParsed) {
      const { linkText, linkUrl, consumed } = linkParsed;
      // Its label is markdown too (`` [`README.md`](…) ``), drawn without links.
      const label = <InlineMarkdown text={linkText} linkLabel imageBaseDir={imageBaseDir} />;
      const safeLinkUrl = sanitizeLinkUrl(linkUrl);

      // Dangerous protocol stripped — render as plain text, not a dead link
      if (safeLinkUrl === null) {
        parts.push(<span key={key++}>{label}</span>);
        remaining = remaining.slice(consumed);
        previousChar = ")";
        continue;
      }

      const isInPageAnchor = safeLinkUrl.startsWith("#");
      if (isInPageAnchor) {
        parts.push(
          <a
            key={key++}
            href={safeLinkUrl}
            onClick={
              onNavigateAnchor
                ? (e) => {
                    e.preventDefault();
                    onNavigateAnchor(safeLinkUrl);
                  }
                : undefined
            }
            className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
          >
            {label}
          </a>,
        );
      } else {
        parts.push(
          <a
            key={key++}
            href={safeLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary"
          >
            {label}
          </a>,
        );
      }
      remaining = remaining.slice(consumed);
      previousChar = ")";
      continue;
    }

    // Forge text: a bare newline is a line break too.
    if (softLineBreaks && remaining[0] === "\n") {
      parts.push(<br key={key++} />);
      remaining = remaining.slice(1);
      previousChar = "\n";
      continue;
    }

    // Hard line break: two+ trailing spaces + newline, or backslash + newline
    match = remaining.match(/ {2,}\n|\\\n/);
    if (match && match.index !== undefined) {
      const before = remaining.slice(0, match.index);
      if (before) {
        parts.push(
          <InlineMarkdown
            key={key++}
            text={before}
            onNavigateAnchor={onNavigateAnchor}
            imageBaseDir={imageBaseDir}
            onImageClick={onImageClick}
          />,
        );
      }
      parts.push(<br key={key++} />);
      remaining = remaining.slice(match.index + match[0].length);
      previousChar = "\n";
      continue;
    }

    // Find next special character or consume one regular character.
    // `h` is intentionally NOT in this class — plain-text chunks may contain
    // `h` mid-word (e.g. ":heart:", "hello"), and splitting on it breaks
    // multi-char patterns like emoji shortcodes. Bare URLs are instead
    // detected inline via emitPlainTextWithBareUrls() below.
    const nextSpecial = remaining
      .slice(1)
      .search(softLineBreaks ? /[\*_`\[!~\\<#@$\n]/ : /[\*_`\[!~\\<#@$]/);
    // A bare URL that starts inside this plain-text chunk and runs past its
    // end would be cut there, and `_`, `~`, `#`, `@`, `$` and `!` all end a
    // chunk (`…/w/ws_01…` rendered a link to `…/w/ws`). Stop the chunk where
    // that URL starts instead, so the bare-URL branch above takes it whole.
    const chunkEnd = nextSpecial === -1 ? remaining.length : nextSpecial + 1;
    const splitAt = linkLabel ? -1 : bareUrlRunningPast(remaining, chunkEnd);
    if (splitAt !== -1) {
      const before = remaining.slice(0, splitAt);
      if (linkLabel) parts.push(transformPlainText(before));
      else emitPlainTextWithBareUrls(before, previousChar, parts, () => key++);
      previousChar = before[before.length - 1] || previousChar;
      remaining = remaining.slice(splitAt);
      continue;
    }
    const plainText = nextSpecial === -1 ? remaining : remaining.slice(0, nextSpecial + 1);
    if (linkLabel) parts.push(transformPlainText(plainText));
    else emitPlainTextWithBareUrls(plainText, previousChar, parts, () => key++);
    previousChar = plainText[plainText.length - 1] || previousChar;
    if (nextSpecial === -1) {
      break;
    }
    remaining = remaining.slice(nextSpecial + 1);
  }

  return <>{parts}</>;
};
