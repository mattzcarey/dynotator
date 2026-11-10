import React, { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Block } from "./blocks";
import { blockId } from "./BlockRenderer";

const ALLOWED_TAGS = [
  "sub",
  "sup",
  "b",
  "i",
  "em",
  "strong",
  "br",
  "hr",
  "p",
  "span",
  "del",
  "ins",
  "mark",
  "small",
  "abbr",
  "kbd",
  "var",
  "samp",
  "details",
  "summary",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "video",
  "source",
  "picture",
];

// No `autoplay`, no event handlers, no inline styles.
const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "align",
  "open",
  "controls",
  "poster",
  "muted",
  "loop",
  "playsinline",
  "type",
  "srcset",
  "media",
  "sizes",
];

/**
 * A raw HTML block. Markdown between its tags renders too (`**x**` inside `<details>`), as on
 * GitHub; then everything outside the allowlist goes. The markup is set imperatively so React
 * never replaces it on re-render (an open `<details>` stays open).
 */
function HtmlBlockImpl({ block }: { block: Block }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(block.content, { async: false, gfm: true }), {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
      }),
    [block.content],
  );
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.innerHTML !== html) root.innerHTML = html;
    for (const a of root.querySelectorAll("a")) {
      if (/^(https?:|\/\/)/i.test(a.getAttribute("href") ?? "")) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    }
  }, [html]);
  return (
    <div
      ref={ref}
      data-block-id={blockId(block)}
      className="html-block my-4 text-[15px] leading-relaxed text-foreground/90"
    />
  );
}

export default React.memo(
  HtmlBlockImpl,
  (a, b) => a.block.content === b.block.content && a.block.id === b.block.id,
);
