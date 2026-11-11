import { useCallback, useState } from "react";

export interface Notice {
  text: string;
  actions: { label: string; onClick: () => void }[];
  /** Gone by itself after this many milliseconds. */
  ttl?: number;
}

/** Sets (or, with null, clears) the notice in one slot: a later one replaces it. */
export type Notify = (slot: string, notice: Notice | null) => void;

export function useNotices(): [Map<string, Notice>, Notify] {
  const [notices, setNotices] = useState(new Map<string, Notice>());
  const notify = useCallback<Notify>((slot, notice) => {
    setNotices((prev) => {
      const next = new Map(prev);
      if (notice) next.set(slot, notice);
      else next.delete(slot);
      return next;
    });
    if (notice?.ttl)
      setTimeout(
        () =>
          setNotices((prev) => {
            if (prev.get(slot) !== notice) return prev;
            const next = new Map(prev);
            next.delete(slot);
            return next;
          }),
        notice.ttl,
      );
  }, []);
  return [notices, notify];
}

const BUTTON = "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors";

/** Messages above the bottom edge; the last action of each is the primary one. */
export function Notices({ notices, notify }: { notices: Map<string, Notice>; notify: Notify }) {
  if (notices.size === 0) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-[95] mx-auto flex w-[min(28rem,calc(100%-1rem))] flex-col gap-2"
    >
      {[...notices].map(([slot, { text, actions }]) => (
        <div
          key={slot}
          className="flex items-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-xl"
        >
          <p className="flex-1 text-xs">{text}</p>
          {actions.map(({ label, onClick }, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                notify(slot, null);
                onClick();
              }}
              className={`${BUTTON} ${i === actions.length - 1 ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
