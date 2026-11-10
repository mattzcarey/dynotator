import React from "react";

/**
 * A list item's marker and text. Ordered items show their number, task items
 * a circle or a check (both, for `1. [ ] task`), others a bullet.
 *
 * The marker is `annotation-exclude` and `select-none`: it is never part of a
 * selection, so it must not be painted into a highlight either, or a
 * highlight across two items would not match its stored text on restore.
 */
export const ListItemBody: React.FC<{
  ordered?: boolean;
  orderedIndex?: number | null;
  /** undefined: not a task item. */
  checked?: boolean;
  textClassName: string;
  content: string;
  renderInline: (text: string) => React.ReactNode;
}> = ({ ordered, orderedIndex, checked, textClassName, content, renderInline }) => {
  const numbered = !!ordered && orderedIndex != null;
  const paragraphs = content.split(/\n\n+/);
  return (
    <>
      <span className="annotation-exclude flex shrink-0 select-none items-center gap-1 self-start">
        {numbered && (
          <span
            className="min-w-6 text-right font-mono text-[0.8em] leading-[1.9] text-muted-foreground tabular-nums"
            data-list-numeral=""
          >
            {orderedIndex}.
          </span>
        )}
        {checked !== undefined ? (
          <svg
            data-list-check=""
            className={`mt-[3px] h-4 w-4 ${checked ? "text-primary" : "text-muted-foreground/50"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={checked ? 2.5 : 2}
          >
            {checked ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            ) : (
              <circle cx="12" cy="12" r="9" />
            )}
          </svg>
        ) : (
          !numbered && <span className="text-primary/60">{"•"}</span>
        )}
      </span>
      {paragraphs.length === 1 ? (
        <span className={textClassName}>{renderInline(content)}</span>
      ) : (
        <div className={textClassName}>
          {paragraphs.map((para, i) => (
            <p key={i} className={i > 0 ? "mt-3" : ""}>
              {renderInline(para)}
            </p>
          ))}
        </div>
      )}
    </>
  );
};
