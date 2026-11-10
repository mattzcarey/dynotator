import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";
import type { Block } from "./blocks";
import { useTheme } from "../theme";

let initializedFor: string | null = null;

/**
 * A ```mermaid fence drawn as a diagram. This module is loaded on the first
 * diagram only, so documents without one never fetch Mermaid.
 */
export default function Mermaid({ block }: { block: Block }) {
  const { resolvedMode } = useTheme();
  const id = `mermaid-${useId().replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (initializedFor !== resolvedMode) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Labels as SVG text: the sanitizer below drops HTML inside foreignObject.
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: resolvedMode === "dark" ? "dark" : "neutral",
      });
      initializedFor = resolvedMode;
    }
    mermaid
      .render(id, block.content)
      .then(({ svg: rendered }) => {
        if (cancelled) return;
        setSvg(DOMPurify.sanitize(rendered, { USE_PROFILES: { svg: true, svgFilters: true } }));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not draw the diagram.");
      });
    return () => {
      cancelled = true;
    };
  }, [block.content, id, resolvedMode]);

  if (error || svg === null) {
    return (
      <div className="annotation-exclude my-5" data-block-id={block.id}>
        {error && <p className="mb-1 text-xs text-destructive">{error}</p>}
        <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">{block.content}</pre>
      </div>
    );
  }
  return (
    <div
      data-block-id={block.id}
      className="annotation-exclude my-5 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
