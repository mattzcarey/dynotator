import React, { useEffect, useRef } from "react";
import type { Block } from "../../types";
import {
  applyHighlight,
  codeBlockClassName,
  codeBlockKeepsLayout,
} from "../../utils/codeHighlight";
import { useFenceTheme } from "../../hooks/useFenceTheme";

/** A fenced code block, highlighted after mount (fences without a language stay plain). */
export const CodeBlock: React.FC<{ block: Block }> = ({ block }) => {
  const codeRef = useRef<HTMLElement>(null);
  const fenceTheme = useFenceTheme();

  useEffect(() => {
    if (!codeRef.current) return;
    codeRef.current.className = codeBlockClassName(block.language);
    applyHighlight(codeRef.current, block.content, block.language, fenceTheme);
  }, [block.content, block.language, fenceTheme]);

  return (
    <div className="my-5" data-block-id={block.id}>
      <pre className="overflow-x-auto rounded-md text-[13px]">
        <code
          ref={codeRef}
          className={codeBlockClassName(block.language)}
          data-keep-layout={codeBlockKeepsLayout(block.content) ? "" : undefined}
        >
          {block.content}
        </code>
      </pre>
    </div>
  );
};
