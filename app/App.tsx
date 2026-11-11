import { useCallback, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { CodeView } from "./files/CodeView";
import { FileTree } from "./files/FileTree";
import { formatHash, isMarkdown, languageFor, resolveLink, type Location } from "./files/paths";
import { buildTree, countByPath, fileOrder } from "./files/tree";
import { useFile } from "./files/useFile";
import { useHashLocation } from "./files/useHashLocation";
import { LinkResolver } from "./markdown/links";
import { focusQuestionCard } from "./questions/QuestionCard";
import { upsertAnswer } from "./questions/answers";
import { MARKDOWN_MAX_BYTES, blocksOf, useQuestions } from "./questions/useQuestions";
import { globalComment, isNote, type Annotation } from "./review/annotations";
import { Composer } from "./review/Composer";
import { DiffView, type Notes } from "./review/DiffView";
import { Document } from "./review/Document";
import { answersInForce, reviewState, unsent } from "./review/events";
import { Header } from "./review/Header";
import { Notices, useNotices } from "./review/Notices";
import { Panel } from "./review/Panel";
import { Sidebar } from "./review/Sidebar";
import { useDraft } from "./review/useDraft";
import { useEvents } from "./review/useEvents";
import { useSession, type Session } from "./review/useSession";
import { useSubmit } from "./review/useSubmit";
import { useVersions } from "./review/useVersions";
import { ThemeProvider } from "./theme";

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

function Review({ session }: { session: Session }) {
  const { version, files } = session;
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

  const title = useMemo(
    () =>
      session.title ??
      (single
        ? (blocks?.find((block) => block.type === "heading")?.content ??
          (isMarkdown(path) || !path ? "Document" : path))
        : "Review"),
    [blocks, path, session.title, single],
  );
  useEffect(() => {
    document.title = `${title} · Dynotator`;
  }, [title]);

  // The page's annotations on this version. Those whose id is in the log are sent; the rest
  // are editable, saved as the draft, and what the next submission carries.
  const [mine, setMine] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1280);
  const [composer, setComposer] = useState<"global" | "feedback" | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const [notices, notify] = useNotices();
  const load = () => {
    draft.flush(true);
    window.location.reload();
  };
  const log = useEvents({ version, initial: session.events, notify, onLoad: load });
  const { closed, latest, submissions, sent, sentIds } = useMemo(
    () => reviewState(log.events, version),
    [log.events, version],
  );
  const editable = useMemo(() => unsent(mine, sentIds), [mine, sentIds]);
  const draft = useDraft({
    annotations: editable,
    enabled: !closed,
    onRestore: (restored) =>
      setMine((prev) => [...prev, ...restored.filter((a) => !prev.some((p) => p.id === a.id))]),
  });
  const answers = useMemo(() => answersInForce(editable, sent), [editable, sent]);
  const all = useMemo(() => [...editable, ...sent], [editable, sent]);
  const { questions, describe } = useQuestions({
    files,
    order,
    version,
    path,
    shown: content !== null,
    answers,
  });
  const { busy, submit } = useSubmit({
    revision: version,
    describe,
    refresh: log.refresh,
    onLoad: load,
    notify,
  });
  const versions = useVersions(version, session.versions, session.base);

  const notes = editable.filter(isNote);
  const counts = useMemo(() => {
    const perFile = new Map<string, number>();
    for (const a of all)
      if (isNote(a) && a.path) perFile.set(a.path, (perFile.get(a.path) ?? 0) + 1);
    return countByPath(perFile);
  }, [all]);

  const add = (annotation: Annotation) => {
    setMine((prev) => [...prev, annotation]);
    setSelectedId(annotation.id);
  };
  const sendFeedback = () => {
    if (editable.length === 0) setComposer("feedback");
    else void submit("feedback", editable);
  };
  const onSendKey = useEffectEvent(() => !closed && sendFeedback());
  useEffect(() => {
    // Mod+Enter sends feedback.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("textarea, input, [contenteditable='true']")) return;
      e.preventDefault();
      onSendKey();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) setPanelOpen(true);
  };
  const viewNotes: Notes = {
    annotations: all,
    sentIds,
    selectedId,
    readOnly: !!closed,
    onAdd: add,
    onSelect: select,
  };

  const changed = versions.changes.status === "ready" ? versions.changes.files : [];
  const diffFile =
    changed.find((f) => f.path === diffPath) ?? changed.find((f) => f.path === path) ?? changed[0];
  const wide = versions.active || !markdown;
  const fileNotes = all.filter((a) => a.path === path && a.side !== "old");

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
          sourceMarkdown={session.base}
          notes={viewNotes}
          onSelect={setDiffPath}
          onOpenFile={(next) => open({ path: next })}
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
          annotations={fileNotes}
          answers={answers.filter((a) => a.path === path)}
          sentIds={sentIds}
          selectedId={selectedId}
          readOnly={!!closed}
          target={target}
          onAdd={add}
          onSelect={select}
          onAnswerQuestion={(blockId, lines, answer, key) =>
            setMine((prev) =>
              upsertAnswer(unsent(prev, sentIds), path, blockId, lines, answer, key),
            )
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
        annotations={fileNotes}
        sentIds={sentIds}
        selectedId={selectedId}
        readOnly={!!closed}
        target={target}
        onAdd={add}
        onSelect={select}
        onPickLines={(lines) => navigate({ path, lines })}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <Header
        title={title}
        single={single}
        sidebarOpen={sidebarOpen}
        panelOpen={panelOpen}
        notes={notes.length}
        latest={latest}
        closed={closed}
        busy={busy}
        onToggleSidebar={() => setSidebarOpen((was) => !was)}
        onTogglePanel={() => setPanelOpen((was) => !was)}
        onSendFeedback={sendFeedback}
        onApprove={() => void submit("approve", editable)}
      />

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
              hasBase={session.base}
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
            {!versions.active && (path || versions.base !== null) && (
              <PathBar
                path={single ? null : path}
                onShowChanges={versions.base !== null ? () => versions.show(true) : null}
              />
            )}
            {body}
          </div>
        </main>
        {panelOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 w-[min(22rem,100%)] border-l border-border bg-card shadow-xl lg:static lg:w-80 lg:shadow-none">
            <Panel
              editable={editable}
              submissions={submissions}
              approved={latest?.type === "approved"}
              questions={questions}
              files={order}
              current={path}
              selectedId={selectedId}
              closed={!!closed}
              onSelect={(annotation) => {
                setSelectedId(annotation.id);
                if (!annotation.path) return;
                if (annotation.side && versions.base !== null) {
                  setDiffPath(annotation.path);
                  versions.show(true);
                } else if (annotation.path !== path || versions.active)
                  open({ path: annotation.path });
              }}
              onOpenFile={(next) => open({ path: next })}
              onDelete={(id) => setMine((prev) => prev.filter((a) => a.id !== id))}
              onEdit={(id, text) =>
                setMine((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)))
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
      {composer === "feedback" && (
        <Composer
          title="Send feedback"
          saveLabel="Send"
          onCancel={() => setComposer(null)}
          onSave={(text) => {
            const note = globalComment(text);
            setComposer(null);
            setMine((prev) => [...prev, note]);
            void submit("feedback", [...editable, note]);
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

/** The open file's path, and the way back to the changes when there are some. */
function PathBar({
  path,
  onShowChanges,
}: {
  path: string | null;
  onShowChanges: (() => void) | null;
}) {
  const parts = path?.split("/") ?? [];
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      {onShowChanges && (
        <button
          type="button"
          onClick={onShowChanges}
          className="h-6 shrink-0 rounded-full border border-primary/40 px-2.5 font-mono text-[11px] tracking-[0.04em] text-primary hover:bg-primary/5"
        >
          ← Changes
        </button>
      )}
      {path && (
        <p
          className="min-w-0 truncate font-mono text-[11px] tracking-[0.04em] text-muted-foreground"
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
      )}
    </div>
  );
}
