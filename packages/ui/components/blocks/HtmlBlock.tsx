import React, { useEffect, useMemo, useRef } from "react";
import type { Block } from "../../types";
import { sanitizeBlockHtml } from "../../utils/sanitizeHtml";

/**
 * A raw HTML block, sanitized. The inner HTML is set imperatively so React
 * never replaces it on re-render (an open <details> stays open); web links
 * open in a new tab.
 */
const HtmlBlockImpl: React.FC<{ block: Block }> = ({ block }) => {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => sanitizeBlockHtml(block.content), [block.content]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.innerHTML !== html) root.innerHTML = html;
    root.querySelectorAll("a").forEach((a) => {
      if (/^(https?:|\/\/)/i.test(a.getAttribute("href") ?? "")) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
    });
  }, [html]);
  return (
    <div
      ref={ref}
      data-block-id={block.id}
      data-block-type="html"
      className="html-block my-4 text-[15px] leading-relaxed text-foreground/90"
    />
  );
};

export const HtmlBlock = React.memo(
  HtmlBlockImpl,
  (prev, next) => prev.block.id === next.block.id && prev.block.content === next.block.content,
);
