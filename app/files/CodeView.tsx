import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { Annotator } from "../review/Annotator";
import type { Annotation } from "../review/annotations";
import { lineStarts, locateText, splitLines } from "../review/diff";
import { textRange } from "../review/ranges";
import { HIGHLIGHT_EVENT, highlight } from "../markdown/highlight";
import { useTheme } from "../theme";
import type { Location } from "./paths";

/** Above either, a file shows as plain text: Shiki tokenizes on the main thread. */
export const HIGHLIGHT_MAX_BYTES = 256 * 1024;
export const HIGHLIGHT_MAX_LINES = 5_000;

/** Must match `.code-view` line-height and padding in theme.css. */
const LINE_PX = 20;
const PAD_PX = 12;

/**
 * A source file with line numbers. The text is one `<code>` (one text node until highlighted),
 * so a selection maps to lines by counting newlines; the numbers are a separate column outside
 * the selectable text. Long lines scroll sideways inside the view.
 */
export function CodeView({
  path,
  content,
  language,
  annotations,
  sentIds,
  selectedId,
  readOnly,
  target,
  onAdd,
  onSelect,
  onPickLines,
}: {
  path: string;
  content: string;
  language: string | undefined;
  /** This file's annotations, current version. */
  annotations: Annotation[];
  sentIds: ReadonlySet<string>;
  selectedId: string | null;
  readOnly: boolean;
  /** The lines to mark and scroll to; a new object scrolls again. */
  target: Pick<Location, "lines"> | null;
  onAdd: (annotation: Annotation) => void;
  onSelect: (id: string | null) => void;
  /** A click on a line number (shift extends): puts the line in the address. */
  onPickLines: (lines: { start: number; end: number }) => void;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const mode = useTheme().resolvedMode;
  const lineCount = useMemo(() => Math.max(1, splitLines(content).length), [content]);
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );
  const plain =
    !language || content.length > HIGHLIGHT_MAX_BYTES || lineCount > HIGHLIGHT_MAX_LINES;

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    if (el.textContent !== content || el.childElementCount > 0) {
      el.textContent = content;
      // Marks painted before this ran went with the old text.
      el.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
    }
    if (plain || !language) return;
    let current = true;
    void highlight(content, language, mode)
      .catch(() => null)
      .then((html) => {
        if (html === null || !current || !el.isConnected) return;
        el.innerHTML = html;
        el.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
      });
    return () => {
      current = false;
    };
  }, [content, language, mode, plain]);

  const lines = target?.lines;
  const bandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const band = bandRef.current;
    if (!target?.lines || !band) return;
    band.scrollIntoView({ block: "center" });
    // The band spans the widest line: keep the code scrolled to its start.
    const scroller = band.closest(".code-view > div");
    if (scroller) scroller.scrollLeft = 0;
  }, [target]);

  const locate = useCallback((range: Range) => {
    const code = codeRef.current;
    if (!code) return null;
    const before = document.createRange();
    before.setStart(code, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const prefix = before.toString();
    const start = prefix.split("\n").length;
    // A selection that runs to the end of a line takes its newline; that is not the next line.
    const original = range.toString().replace(/\n$/, "");
    const end = start + original.split("\n").length - 1;
    return { lines: { start, end }, original, col: prefix.length - prefix.lastIndexOf("\n") - 1 };
  }, []);
  const starts = useMemo(() => lineStarts(content), [content]);
  const rangeOf = useCallback(
    (annotation: Annotation) => {
      const at = codeRef.current && locateText(content, annotation, starts);
      return at && codeRef.current ? textRange(codeRef.current, at[0], at[1]) : null;
    },
    [content, starts],
  );

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    const line = Math.floor((e.clientY - top - PAD_PX) / LINE_PX) + 1;
    if (line < 1 || line > lineCount) return;
    onPickLines(
      e.shiftKey && lines
        ? { start: Math.min(lines.start, line), end: Math.max(lines.start, line) }
        : { start: line, end: line },
    );
  };

  return (
    <Annotator
      path={path}
      annotations={annotations}
      sentIds={sentIds}
      selectedId={selectedId}
      readOnly={readOnly}
      className="code-view w-full overflow-hidden rounded-xl border border-border"
      locate={locate}
      rangeOf={rangeOf}
      onAdd={onAdd}
      onSelect={onSelect}
    >
      <div className="relative flex overflow-x-auto">
        <div
          aria-hidden="true"
          onClick={pick}
          className="code-gutter annotation-exclude sticky left-0 z-[2] shrink-0 cursor-pointer border-r border-border text-right text-muted-foreground/70 select-none"
        >
          {gutter}
        </div>
        <pre className="relative min-w-max flex-1">
          {lines && (
            <div
              ref={bandRef}
              className="code-band pointer-events-none absolute inset-x-0"
              style={{
                top: PAD_PX + (lines.start - 1) * LINE_PX,
                height: (Math.min(lines.end, lineCount) - lines.start + 1) * LINE_PX,
              }}
            />
          )}
          <code ref={codeRef} className="code-text relative block font-mono">
            {content}
          </code>
        </pre>
      </div>
    </Annotator>
  );
}
