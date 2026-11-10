import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { parseMarkdownToBlocks } from "./markdown/blocks";
import { focusQuestionCard } from "./questions/QuestionCard";
import { questionRows, upsertAnswer } from "./questions/answers";
import { globalComment, type Annotation } from "./review/annotations";
import { Composer } from "./review/Composer";
import { DiffView } from "./review/DiffView";
import { Document } from "./review/Document";
import { Notices, useNotices } from "./review/Notices";
import { Panel } from "./review/Panel";
import { Sidebar } from "./review/Sidebar";
import { useDecision, type Outcome } from "./review/useDecision";
import { useDraft } from "./review/useDraft";
import { usePlanRevision } from "./review/usePlanRevision";
import { useSession, type Session } from "./review/useSession";
import { useVersions } from "./review/useVersions";
import { ModeToggle, ThemeProvider } from "./theme";

export default function App() {
  const state = useSession();
  return (
    <ThemeProvider>
      {state.status === "ready" ? (
        <Review session={state.session} />
      ) : (
        <div className="flex h-dvh items-center justify-center bg-background p-6">
          {state.status === "error" && (
            <p className="max-w-md text-center text-sm text-muted-foreground">{state.message}</p>
          )}
        </div>
      )}
    </ThemeProvider>
  );
}

const button =
  "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors disabled:opacity-50";

function Review({ session }: { session: Session }) {
  const { mode, markdown } = session;
  const plan = mode === "plan";
  const blocks = useMemo(() => parseMarkdownToBlocks(markdown), [markdown]);
  const title = useMemo(
    () =>
      session.title ??
      blocks.find((block) => block.type === "heading")?.content ??
      (plan ? "Plan" : "Document"),
    [blocks, plan, session.title],
  );
  useEffect(() => {
    document.title = `${title} · Dynotator`;
  }, [title]);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1280);
  const [composer, setComposer] = useState<"global" | "changes" | null>(null);
  const [diffActive, setDiffActive] = useState(false);
  const [decided, setDecided] = useState(false);

  const [notices, notify] = useNotices();
  const draft = useDraft({ annotations, enabled: !decided, notify, onRestore: setAnnotations });
  const { cancelPending } = draft;
  const decision = useDecision({
    planRevision: session.planRevision,
    getDraftGeneration: draft.getDraftGeneration,
    onDecided: useCallback(() => {
      cancelPending();
      setDecided(true);
    }, [cancelPending]),
    notify,
  });
  usePlanRevision({
    revision: session.planRevision,
    denied: decision.outcome === "changes",
    active: !decision.outcome || decision.outcome === "changes",
    notify,
  });
  const versions = useVersions(markdown, session.version, session.previousPlan);

  const questions = useMemo(() => questionRows(blocks, annotations), [annotations, blocks]);
  const comments = annotations.filter((a) => a.questionAnswer == null);
  const answersOnly = plan && comments.length === 0 && annotations.length > 0;
  const feedback = { mode, blocks, annotations };

  const add = (annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation]);
    setSelectedId(annotation.id);
  };
  const requestChanges = (note: string) => {
    const withNote = note ? [...annotations, globalComment(note)] : annotations;
    setAnnotations(withNote);
    decision.requestChanges({ ...feedback, annotations: withNote }, answersOnly && !note);
  };

  // Mod+Enter: the primary decision.
  const primary = plan ? () => decision.approve(feedback) : () => decision.sendFeedback(feedback);
  const onPrimaryKey = useEffectEvent(primary);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, [contenteditable='true']")) return;
      e.preventDefault();
      onPrimaryKey();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (decision.outcome) return <Done outcome={decision.outcome} plan={plan} />;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 md:gap-2 md:px-4">
        <button
          type="button"
          aria-label="Contents"
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
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
        <ModeToggle />
        <button
          type="button"
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
          className={`${button} border border-border hover:bg-muted`}
        >
          Notes{comments.length > 0 && ` ${comments.length}`}
        </button>
        {plan ? (
          <>
            <button
              type="button"
              disabled={decision.busy}
              onClick={() => setComposer("changes")}
              className={`${button} border border-border hover:bg-muted`}
            >
              {answersOnly ? (
                "Send answers"
              ) : (
                <>
                  <span className="sm:hidden">Changes</span>
                  <span className="hidden sm:inline">Request changes</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={decision.busy}
              onClick={primary}
              className={`${button} bg-primary text-primary-foreground`}
            >
              Approve
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={decision.busy}
              onClick={decision.close}
              className={`${button} text-muted-foreground hover:bg-muted`}
            >
              Close
            </button>
            <button
              type="button"
              disabled={decision.busy}
              onClick={primary}
              className={`${button} bg-primary text-primary-foreground`}
            >
              Send feedback
            </button>
          </>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1">
        {(sidebarOpen || panelOpen) && (
          // Narrow screens: the open sidebar or panel covers the page; a tap beside it closes it.
          <button
            type="button"
            aria-label="Dismiss"
            tabIndex={-1}
            className={`absolute inset-0 z-20 bg-black/20 ${sidebarOpen ? "xl:hidden" : "lg:hidden"}`}
            onClick={() => {
              if (window.innerWidth < 1280) setSidebarOpen(false);
              if (window.innerWidth < 1024) setPanelOpen(false);
            }}
          />
        )}
        {sidebarOpen && (
          <aside className="absolute inset-y-0 left-0 z-30 w-72 border-r border-border bg-card shadow-xl xl:static xl:w-64 xl:shadow-none">
            <Sidebar
              blocks={blocks}
              version={session.version}
              totalVersions={session.totalVersions}
              versions={versions.versions}
              baseVersion={versions.base}
              diffActive={diffActive}
              onLoadVersions={versions.loadVersions}
              onSelectBase={versions.selectBase}
              onShowDiff={setDiffActive}
              onNavigate={() => window.innerWidth < 1280 && setSidebarOpen(false)}
            />
          </aside>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[860px] px-2 py-3 md:px-6 md:py-8">
            {diffActive && versions.diff && versions.base !== null ? (
              <DiffView entries={versions.diff} baseVersion={versions.base} />
            ) : (
              <Document
                blocks={blocks}
                annotations={annotations}
                selectedId={selectedId}
                readOnly={decided}
                onAdd={add}
                onSelect={(id) => {
                  setSelectedId(id);
                  if (id) setPanelOpen(true);
                }}
                onAnswerQuestion={(blockId, answer, key) =>
                  setAnnotations((prev) => upsertAnswer(prev, blockId, answer, key))
                }
              />
            )}
          </div>
        </main>
        {panelOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 w-[min(22rem,100%)] border-l border-border bg-card shadow-xl lg:static lg:w-80 lg:shadow-none">
            <Panel
              annotations={annotations}
              questions={questions}
              selectedId={selectedId}
              readOnly={decided}
              onSelect={setSelectedId}
              onDelete={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
              onEdit={(id, text) =>
                setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)))
              }
              onSelectQuestion={(key) => {
                setDiffActive(false);
                requestAnimationFrame(() => focusQuestionCard(key));
              }}
              onGlobalComment={() => setComposer("global")}
            />
          </aside>
        )}
      </div>

      {composer === "global" && (
        <Composer
          title="General comment"
          onCancel={() => setComposer(null)}
          onSave={(text) => {
            add(globalComment(text));
            setComposer(null);
          }}
        />
      )}
      {composer === "changes" && (
        <Composer
          title={answersOnly ? "Send answers" : "Request changes"}
          saveLabel="Send"
          allowEmpty={annotations.length > 0}
          onCancel={() => setComposer(null)}
          onSave={(note) => {
            setComposer(null);
            requestChanges(note);
          }}
        />
      )}
      <Notices notices={notices} notify={notify} />
    </div>
  );
}

const DONE: Record<Outcome, [string, string]> = {
  approved: ["Approved", "The agent will proceed."],
  changes: ["Changes requested", "The agent will revise. The new version opens here."],
  sent: ["Feedback sent", "The agent will address your feedback."],
  done: ["Done", "Nothing was sent."],
  closed: ["Closed", "The session was closed without feedback."],
  taken: ["Already decided", "This review was decided in another window."],
};

function Done({ outcome, plan }: { outcome: Outcome; plan: boolean }) {
  const [title, subtitle] = DONE[outcome];
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <h1 className="text-xl font-semibold">
        {plan && outcome === "approved" ? "Plan approved" : title}
      </h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
