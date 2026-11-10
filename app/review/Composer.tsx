import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const isSubmitKey = (e: KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey);

/**
 * A small floating box for writing a comment. Anchored under `rect` when
 * given, centred otherwise. Mod+Enter saves, Escape cancels.
 */
export function Composer({
  rect,
  title,
  quote,
  saveLabel = "Save",
  allowEmpty = false,
  onSave,
  onCancel,
}: {
  rect?: DOMRect;
  title: string;
  quote?: string;
  saveLabel?: string;
  allowEmpty?: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const canSave = allowEmpty || text.trim().length > 0;
  const save = () => canSave && onSave(text.trim());

  const width = Math.min(360, window.innerWidth - 16);
  const position = rect
    ? {
        top: Math.min(rect.bottom + 8, window.innerHeight - 220),
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      }
    : { top: "30%", left: `calc(50% - ${width / 2}px)` };

  return (
    <div
      role="dialog"
      aria-label={title}
      className="annotation-exclude fixed z-[90] flex flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-xl"
      style={{ ...position, width }}
    >
      <div className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground">{title}</div>
      {quote && (
        <p className="line-clamp-2 font-mono text-[11px] text-muted-foreground/80">“{quote}”</p>
      )}
      <textarea
        ref={ref}
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Write a comment…"
        className="w-full resize-y rounded-md border border-border bg-card px-2.5 py-2 text-base text-foreground outline-none focus:border-primary/50 md:text-sm"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="h-8 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
