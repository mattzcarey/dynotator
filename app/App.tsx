import { useCallback, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { CodeView } from "./files/CodeView";
import { FileTree } from "./files/FileTree";
import {
  formatHash,
  isMarkdown,
  languageFor,
  parseHash,
  resolveLink,
  type Location,
} from "./files/paths";
import { buildTree, countByPath, fileOrder } from "./files/tree";
import { loadFile, useFile } from "./files/useFile";
import { parseMarkdownToBlocks, type Block } from "./markdown/blocks";
import { LinkResolver } from "./markdown/links";
import { focusQuestionCard } from "./questions/QuestionCard";
import { questionRows, upsertAnswer } from "./questions/answers";
import { indexQuestions } from "./questions/questions";
import { globalComment, type Annotation } from "./review/annotations";
import { Composer } from "./review/Composer";
import { DiffView } from "./review/DiffView";
import { Document } from "./review/Document";
import type { FeedbackInput } from "./review/feedback";
import { Notices, useNotices } from "./review/Notices";
import { Panel, type PanelQuestion } from "./review/Panel";
import { Sidebar } from "./review/Sidebar";
import { useDecision, type Outcome } from "./review/useDecision";
import { useDraft } from "./review/useDraft";
import { useRevision } from "./review/useRevision";
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

/** A larger markdown file shows as source: rendering it would stall the page. */
const MARKDOWN_MAX_BYTES = 512 * 1024;

/**
 * In a small review the markdown files are read in the background once the first file is on
 * screen, so the panel's questions span every file; a larger one finds questions as files open.
 */
const PREFETCH = { maxFiles: 200, maxMarkdown: 20, maxBytes: 128 * 1024 };

const blockCache = new Map<string, Block[]>();
function blocksOf(content: string): Block[] {
  let blocks = blockCache.get(content);
  if (!blocks) {
    blocks = parseMarkdownToBlocks(content);
    blockCache.set(content, blocks);
  }
  return blocks;
}

/**
 * The location in the hash (`#/path:L1-2`, `#/path#anchor`), or the review's first file. The
 * scroll target is a new object on every hash change, a repeated one included.
 */
function useHashLocation(fallback: string, has: (path: string) => boolean) {
  const [hash, setHash] = useState(() => ({ value: location.hash, seq: 0 }));
  useEffect(() => {
    const onChange = () => setHash(({ seq }) => ({ value: location.hash, seq: seq + 1 }));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  // A new object per hash change: the views scroll when it changes.
  const parsed = useMemo(() => parseHash(hash.value), [hash]);
  const known = parsed && has(parsed.path) ? parsed : null;
  const at: Location = known ?? { path: fallback };
  const target = known && (known.lines || known.anchor) ? known : null;
  const navigate = useCallback((next: Location) => {
    const value = formatHash(next);
    if (location.hash === value) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = value;
  }, []);
  return { at, target, navigate };
}

function Review({ session }: { session: Session }) {
  const { mode, version, files } = session;
  const plan = mode === "plan";
  const single = files.length <= 1;
  const tree = useMemo(() => buildTree(files), [files]);
  const order = useMemo(() => fileOrder(tree), [tree]);
  const has = useMemo(() => {
    const paths = new Set(files.map((f) => f.path));
    return (path: string) => paths.has(path);
  }, [files]);
  const { at, target, navigate } = useHashLocation(session.open, has);
  const path = at.path;

  const [opened, retry] = useFile(path || null, version);
  const content = opened.status === "ready" ? opened.content : null;
  const markdown = content !== null && isMarkdown(path) && content.length <= MARKDOWN_MAX_BYTES;
  const blocks = useMemo(
    () => (markdown && content !== null ? blocksOf(content) : null),
    [content, markdown],
  );

  // Markdown files read so far, for the questions across files.
  const [readMarkdown, setReadMarkdown] = useState<ReadonlyMap<string, string>>(new Map());
  const remember = useCallback((file: string, text: string) => {
    if (!isMarkdown(file) || text.length > MARKDOWN_MAX_BYTES) return;
    setReadMarkdown((prev) => (prev.get(file) === text ? prev : new Map(prev).set(file, text)));
  }, []);
  const firstShown = content !== null;
  useEffect(() => {
    // Served from the cache by now: this only records the open file as read.
    if (firstShown && path)
      loadFile(path, version).then(
        (text) => remember(path, text),
        () => {},
      );
  }, [firstShown, path, remember, version]);
  useEffect(() => {
    if (!firstShown || single || files.length > PREFETCH.maxFiles) return;
    files
      .filter((f) => isMarkdown(f.path) && f.size <= PREFETCH.maxBytes)
      .slice(0, PREFETCH.maxMarkdown)
      .forEach((f) =>
        loadFile(f.path, version).then(
          (text) => remember(f.path, text),
          () => {},
        ),
      );
  }, [files, firstShown, remember, single, version]);

  const title = useMemo(
    () =>
      session.title ??
      (single
        ? (blocks?.find((block) => block.type === "heading")?.content ??
          (isMarkdown(path) || !path ? (plan ? "Plan" : "Document") : path))
        : plan
          ? "Plan"
          : "Review"),
    [blocks, path, plan, session.title, single],
  );
  useEffect(() => {
    document.title = `${title} · Dynotator`;
  }, [title]);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1280);
  const [composer, setComposer] = useState<"global" | "changes" | null>(null);
  const [decided, setDecided] = useState(false);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const [notices, notify] = useNotices();
  const draft = useDraft({ annotations, enabled: !decided, notify, onRestore: setAnnotations });
  const { cancelPending } = draft;

  const getFeedback = async (list: Annotation[]): Promise<FeedbackInput> => {
    // An answer restored from a draft may sit in a file not read since the reload.
    const texts = new Map(readMarkdown);
    const unread = new Set(
      list.filter((a) => a.questionAnswer && a.path && !texts.has(a.path)).map((a) => a.path),
    );
    await Promise.all(
      [...unread].map((file) =>
        loadFile(file, version).then(
          (text) => texts.set(file, text),
          () => {},
        ),
      ),
    );
    const questions = order.flatMap((file) => {
      const text = texts.get(file);
      return text === undefined
        ? []
        : indexQuestions(blocksOf(text)).map((q) => ({ ...q, path: file }));
    });
    return { mode, files: order, questions, annotations: list };
  };

  const decision = useDecision({
    revision: version,
    getFeedback,
    getDraftGeneration: draft.getDraftGeneration,
    onDecided: useCallback(() => {
      cancelPending();
      setDecided(true);
    }, [cancelPending]),
    notify,
  });
  useRevision({
    revision: version,
    denied: decision.outcome === "changes",
    active: !decision.outcome || decision.outcome === "changes",
    notify,
  });
  const versions = useVersions(version, session.versions);

  const fileAnnotations = useMemo(
    () => annotations.filter((a) => a.path === path),
    [annotations, path],
  );
  const questions = useMemo<PanelQuestion[]>(
    () =>
      order.flatMap((file) => {
        const text = readMarkdown.get(file);
        if (text === undefined) return [];
        const own = annotations.filter((a) => a.path === file);
        return questionRows(blocksOf(text), own).map((row) => ({ ...row, path: file }));
      }),
    [annotations, order, readMarkdown],
  );
  const comments = annotations.filter((a) => a.questionAnswer == null);
  const counts = useMemo(() => {
    const perFile = new Map<string, number>();
    for (const a of annotations) {
      if (a.questionAnswer == null && a.path) perFile.set(a.path, (perFile.get(a.path) ?? 0) + 1);
    }
    return countByPath(perFile);
  }, [annotations]);
  const answersOnly = plan && comments.length === 0 && annotations.length > 0;

  const add = (annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation]);
    setSelectedId(annotation.id);
  };
  const requestChanges = (note: string) => {
    const withNote = note ? [...annotations, globalComment(note)] : annotations;
    setAnnotations(withNote);
    void decision.requestChanges(withNote, answersOnly && !note);
  };
  const open = (next: Location) => {
    versions.show(false);
    navigate(next);
  };
  const narrow = () => window.innerWidth < 1280 && setSidebarOpen(false);
  const resolve = useCallback(
    (href: string) => {
      const link = resolveLink(path, href, has);
      return link ? formatHash(link) : null;
    },
    [has, path],
  );

  // Mod+Enter: the primary decision.
  const primary = plan
    ? () => decision.approve(annotations)
    : () => decision.sendFeedback(annotations);
  const onPrimaryKey = useEffectEvent(primary);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("textarea, input, [contenteditable='true']")) return;
      e.preventDefault();
      void onPrimaryKey();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (decision.outcome) return <Done outcome={decision.outcome} plan={plan} />;

  const changed = versions.changes.status === "ready" ? versions.changes.files : [];
  const diffFile =
    changed.find((f) => f.path === diffPath) ?? changed.find((f) => f.path === path) ?? changed[0];
  const wide = versions.active ? !!diffFile && !isMarkdown(diffFile.path) : !markdown;

  let body: ReactNode;
  if (versions.active && versions.base !== null) {
    body =
      versions.changes.status === "ready" ? (
        <DiffView
          base={versions.base}
          version={version}
          files={changed}
          showList={!single || changed.length > 1}
          selected={diffFile ?? null}
          onSelect={setDiffPath}
        />
      ) : (
        <Quiet>
          {versions.changes.status === "error" ? versions.changes.message : "Loading changes…"}
        </Quiet>
      );
  } else if (!path) {
    body = <Quiet>This review has no files.</Quiet>;
  } else if (opened.status === "loading") {
    body = <Quiet>Loading {path}…</Quiet>;
  } else if (opened.status === "error") {
    body = (
      <Quiet>
        {opened.message}{" "}
        <button
          type="button"
          onClick={retry}
          className="ml-1 h-7 rounded-full border border-border px-3 text-xs text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </Quiet>
    );
  } else if (blocks) {
    body = (
      <LinkResolver.Provider value={resolve}>
        <Document
          key={path}
          path={path}
          blocks={blocks}
          annotations={fileAnnotations}
          selectedId={selectedId}
          readOnly={decided}
          target={target}
          onAdd={add}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setPanelOpen(true);
          }}
          onAnswerQuestion={(blockId, answer, key) =>
            setAnnotations((prev) => upsertAnswer(prev, path, blockId, answer, key))
          }
        />
      </LinkResolver.Provider>
    );
  } else {
    body = (
      <CodeView
        key={path}
        path={path}
        content={opened.content}
        language={isMarkdown(path) ? undefined : languageFor(path)}
        annotations={fileAnnotations}
        selectedId={selectedId}
        readOnly={decided}
        target={target}
        onAdd={add}
        onSelect={(id) => {
          setSelectedId(id);
          if (id) setPanelOpen(true);
        }}
        onPickLines={(lines) => navigate({ path, lines })}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 md:gap-2 md:px-4">
        <button
          type="button"
          aria-label={single ? "Contents" : "Files"}
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((was) => !was)}
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
          onClick={() => setPanelOpen((was) => !was)}
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
              files={
                single ? null : (
                  <FileTree
                    root={tree}
                    current={path}
                    counts={counts}
                    onOpen={(next) => {
                      open({ path: next });
                      narrow();
                    }}
                  />
                )
              }
              blocks={versions.active ? null : blocks}
              version={version}
              versions={session.versions}
              baseVersion={versions.base}
              diffActive={versions.active}
              onSelectBase={versions.selectBase}
              onShowDiff={versions.show}
              onNavigate={narrow}
            />
          </aside>
        )}
        {/* Keyed so each file, and the changes, start at the top. */}
        <main key={versions.active ? "\n" : path} className="min-w-0 flex-1 overflow-y-auto">
          <div
            className={`mx-auto px-2 py-3 md:px-6 md:py-8 ${wide ? "max-w-[1200px]" : "max-w-[860px]"}`}
          >
            {!single && !versions.active && path && <PathBar path={path} />}
            {body}
          </div>
        </main>
        {panelOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 w-[min(22rem,100%)] border-l border-border bg-card shadow-xl lg:static lg:w-80 lg:shadow-none">
            <Panel
              annotations={annotations}
              questions={questions}
              files={order}
              current={path}
              selectedId={selectedId}
              readOnly={decided}
              onSelect={(annotation) => {
                setSelectedId(annotation.id);
                if (annotation.path && (annotation.path !== path || versions.active))
                  open({ path: annotation.path });
              }}
              onOpenFile={(next) => open({ path: next })}
              onDelete={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
              onEdit={(id, text) =>
                setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)))
              }
              onSelectQuestion={(row) => {
                if (row.path !== path || versions.active) open({ path: row.path });
                whenPresent(`fieldset[data-question-key="${CSS.escape(row.key)}"]`, () =>
                  focusQuestionCard(row.key),
                );
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

/** Run `then` once an element matching `selector` is on the page (a file may still be loading). */
function whenPresent(selector: string, then: () => void, frames = 120): void {
  requestAnimationFrame(() => {
    if (document.querySelector(selector)) then();
    else if (frames > 0) whenPresent(selector, then, frames - 1);
  });
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center rounded-xl bg-card px-4 py-6 text-xs text-muted-foreground md:px-10">
      {children}
    </p>
  );
}

function PathBar({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <p
      className="mb-2 truncate px-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground"
      title={path}
    >
      {parts.slice(0, -1).map((part, i) => (
        <span key={i}>
          {part}
          <span className="px-0.5 text-border-strong">/</span>
        </span>
      ))}
      <span className="text-foreground">{parts[parts.length - 1]}</span>
    </p>
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
