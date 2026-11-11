import { ModeToggle } from "../theme";
import { formatWhen, type ReviewEvent, type Submission } from "./events";

const button =
  "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-50";

/**
 * The bar: the review's name, the current version's state (approved, or the feedback that
 * withdrew or preceded an approval), and the two actions. A closed review has no actions and a
 * banner instead.
 */
export function Header({
  title,
  single,
  sidebarOpen,
  panelOpen,
  notes,
  latest,
  closed,
  busy,
  onToggleSidebar,
  onTogglePanel,
  onSendFeedback,
  onApprove,
}: {
  title: string;
  single: boolean;
  sidebarOpen: boolean;
  panelOpen: boolean;
  /** Unsent notes. */
  notes: number;
  latest: Submission | null;
  closed: ReviewEvent | null;
  busy: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
  onSendFeedback: () => void;
  onApprove: () => void;
}) {
  const approved = latest?.type === "approved";
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 md:gap-2 md:px-4">
        <button
          type="button"
          aria-label={single ? "Contents" : "Files"}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
        <span className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold sm:flex">
          <span aria-hidden="true">🦖🥔</span>
          Dynotator
          <span aria-hidden="true" className="font-normal text-muted-foreground">
            /
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        {latest && (
          <span
            role="status"
            title={[formatWhen(latest.at), latest.by].filter(Boolean).join(" · ")}
            className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 font-mono text-[11px] tracking-[0.04em] ${approved ? "border-success/40 text-success" : "border-dashed border-border-strong text-muted-foreground"}`}
          >
            {approved ? "Approved" : "Feedback sent"}
            <span className="hidden text-muted-foreground md:inline">
              {formatWhen(latest.at)}
              {latest.by && ` · ${latest.by}`}
            </span>
          </span>
        )}
        <ModeToggle />
        <button
          type="button"
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
          className={`${button} border border-border hover:bg-muted`}
        >
          Notes{notes > 0 && ` ${notes}`}
        </button>
        {!closed && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onSendFeedback}
              className={`${button} border border-border hover:bg-muted`}
            >
              <span className="sm:hidden">Send</span>
              <span className="hidden sm:inline">Send feedback</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className={`${button} bg-primary text-primary-foreground`}
            >
              Approve
            </button>
          </>
        )}
      </header>
      {closed && (
        <p
          role="status"
          className="shrink-0 border-b border-dashed border-border bg-muted px-4 py-2 text-center font-mono text-[11px] tracking-[0.04em] text-muted-foreground"
        >
          The agent closed this review {formatWhen(closed.at)}. Everything stays readable; nothing
          more can be sent.
        </p>
      )}
    </>
  );
}
