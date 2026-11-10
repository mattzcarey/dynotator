import { useEffect, useRef } from "react";
import type { Block } from "./blocks";
import { blockId } from "./BlockRenderer";
import { HIGHLIGHT_EVENT, highlight } from "./highlight";
import { useTheme } from "../theme";

/** Grid-shaped fences (box drawing, aligned columns) keep their layout and scroll sideways. */
const keepsLayout = (content: string): boolean => /[─-▟]|\S\t+\S|[^\s.!?] {2,}\S/.test(content);

/** Fenced code, highlighted once the fence's grammar has loaded; unknown languages stay plain. */
export function CodeBlock({ block }: { block: Block }) {
  const ref = useRef<HTMLElement>(null);
  const mode = useTheme().resolvedMode;
  const { content, language } = block;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.textContent !== content || el.childElementCount > 0) el.textContent = content;
    if (!language) return;
    let current = true;
    void highlight(content, language.toLowerCase(), mode)
      .catch(() => null)
      .then((html) => {
        if (html === null || !current || !el.isConnected) return;
        el.innerHTML = html;
        el.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
      });
    return () => {
      current = false;
    };
  }, [content, language, mode]);

  return (
    <div className="my-5" data-block-id={blockId(block)}>
      <pre className="overflow-x-auto rounded-md text-[13px]">
        <code
          ref={ref}
          className={`fence font-mono${language ? ` language-${language}` : ""}`}
          data-keep-layout={keepsLayout(content) ? "" : undefined}
        >
          {content}
        </code>
      </pre>
    </div>
  );
}
