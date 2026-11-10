// KaTeX and the name dictionary register eagerly so the first paint has them.
import "@dynotator/ui/utils/math-eager";
import "@dynotator/ui/utils/identity-tater";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { getAgentName } from "@dynotator/shared/agents";
import { extractFrontmatter, parseMarkdownToBlocks } from "@dynotator/ui/utils/parser";
import { Viewer, type ViewerHandle } from "@dynotator/ui/components/Viewer";
import type { AnnotationRestoreReport } from "@dynotator/ui/hooks/useAnnotationHighlighter";
import { AnnotationPanel } from "@dynotator/ui/components/AnnotationPanel";
import { ExportModal } from "@dynotator/ui/components/ExportModal";
import { ConfirmDialog } from "@dynotator/ui/components/ConfirmDialog";
import type { EditorMode, InputMethod, ActionsLabelMode } from "@dynotator/ui/types";
import { ThemeProvider } from "@dynotator/ui/components/ThemeProvider";
import { TooltipProvider } from "@dynotator/ui/components/Tooltip";
import { AnnotationToolstrip } from "@dynotator/ui/components/AnnotationToolstrip";
import { StickyHeaderLane } from "@dynotator/ui/components/StickyHeaderLane";
import { useActiveSection } from "@dynotator/ui/hooks/useActiveSection";
import { tocHeadings } from "@dynotator/ui/utils/annotationHelpers";
import { copyTextToClipboard } from "@dynotator/ui/utils/clipboard";
import { useConfigValue } from "@dynotator/ui/config";
import { CompletionOverlay } from "@dynotator/ui/components/CompletionOverlay";
import { useDocumentTextSize } from "@dynotator/ui/hooks/useDocumentTextSize";
import { useDocumentFont } from "@dynotator/ui/hooks/useDocumentFont";
import { getUIPreferences, type PlanWidth } from "@dynotator/ui/utils/uiPreferences";
import { getEditorMode, saveEditorMode } from "@dynotator/ui/utils/editorMode";
import { getInputMethod, saveInputMethod } from "@dynotator/ui/utils/inputMethod";
import { useInputMethodSwitch } from "@dynotator/ui/hooks/useInputMethodSwitch";
import { usePrintMode } from "@dynotator/ui/hooks/usePrintMode";
import { useResizablePanel } from "@dynotator/ui/hooks/useResizablePanel";
import { ResizeHandle } from "@dynotator/ui/components/ResizeHandle";
import { OverlayScrollArea } from "@dynotator/ui/components/OverlayScrollArea";
import {
  getDocumentScrollViewport,
  ScrollViewportProvider,
} from "@dynotator/ui/hooks/useScrollViewport";
import { useScrollKeyRouting } from "@dynotator/ui/hooks/useScrollKeyRouting";
import { useOverlayViewport } from "@dynotator/ui/hooks/useOverlayViewport";
import { useCompactTouchLayout, useIsMobile } from "@dynotator/ui/hooks/useIsMobile";
import { useViewportEnvironment } from "@dynotator/ui/hooks/useViewportEnvironment";
import {
  getPermissionModeSettings,
  needsPermissionModeSetup,
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "@dynotator/ui/utils/permissionMode";
import { PermissionModeSetup } from "@dynotator/ui/components/PermissionModeSetup";
import { ImageAnnotator } from "@dynotator/ui/components/ImageAnnotator";
import { deriveImageName } from "@dynotator/ui/components/AttachmentsButton";
import { useSidebar, type SidebarTab } from "@dynotator/ui/hooks/useSidebar";
import { usePlanDiff } from "@dynotator/ui/hooks/usePlanDiff";
import { SidebarTabs } from "@dynotator/ui/components/sidebar/SidebarTabs";
import { SidebarContainer } from "@dynotator/ui/components/sidebar/SidebarContainer";
import { PlanDiffViewer } from "@dynotator/ui/components/plan-diff/PlanDiffViewer";
import type { PlanDiffMode } from "@dynotator/ui/components/plan-diff/PlanDiffModeSwitcher";
import { buildDecisionSpec, type DecisionActionId } from "@dynotator/ui/utils/decisionSpec";
import {
  DecisionNoteDialog,
  type DecisionControlProps,
  type DecisionHandler,
} from "@dynotator/ui/components/DecisionControl";
import { PermissionModeMenuLine } from "@dynotator/ui/components/PlanDecisionMenuExtras";
import { annotationOwnsHighlight } from "@dynotator/ui/utils/annotationOwnsHighlight";
import {
  buildQuestionPanelRows,
  focusQuestionCard,
  nextOpenQuestionKey,
  questionProgress,
  type QuestionPanelRow,
} from "@dynotator/ui/utils/questionAnswers";
import {
  useAnnotationModeShortcuts,
  useHistoryShortcuts,
  useSidebarShortcuts,
} from "@dynotator/ui/shortcuts";
import { hasActiveHistoryOverlay, isNativeHistoryOwner } from "@dynotator/ui/utils/undoHistory";
import { setRichCopyEnabled } from "@dynotator/ui/utils/richCopyPolicy";
import { setTouchSelectionToolbar } from "@dynotator/ui/utils/touchToolbarPlacement";
import type { CompactPlanAction } from "@dynotator/ui/components/PlanHeaderMenu";
import { AppHeader } from "./components/AppHeader";
import { CompactAnnotationControls } from "./components/CompactAnnotationControls";
import { CompactPlanStage } from "./components/CompactPlanStage";
import {
  CompactPlanCompletion,
  CompactPlanReview,
  type CompactPlanReviewAction,
} from "./components/CompactPlanReview";
import { compactPrimaryIdForDecision, compactRowIdForDecisionItem } from "./annotateDecision";
import { countQuestionAnswers, isAnswersOnlyFeedback } from "./questionDecision";
import { applyRestoredAnchors } from "./restoredAnchors";
import { observeActionsLabelMode } from "./actionsLabelMode";
import { shouldPrintOnKey } from "./printShortcut";
import { buildFeedback, hasFeedback, wrapCopiedFeedback, type FeedbackInput } from "./feedback";
import { useSession, type Session } from "./hooks/useSession";
import { useAnnotations } from "./hooks/useAnnotations";
import { useDraft } from "./hooks/useDraft";
import { useDecision } from "./hooks/useDecision";
import { usePlanDiffViewAutoExit } from "./hooks/usePlanDiffViewAutoExit";
import { useRevisionWatch } from "./hooks/useRevisionWatch";

// Copy puts rich text on the clipboard, and on touch screens the selection
// toolbar sits below the selection, clear of the system edit menu.
setRichCopyEnabled(true);
setTouchSelectionToolbar(true);

const RESIZE_HANDLE_TOOLTIP = "Click to close · Drag to resize";
const PLAN_WIDTHS: Record<PlanWidth, number> = { compact: 832, default: 1040, wide: 1280 };

type CompactSurface = "artifact" | "navigator" | "annotations" | "review";

const App: React.FC = () => {
  const state = useSession();
  if (state.status === "ready") return <Review session={state.session} />;
  return (
    <ThemeProvider>
      <div className="pn-app-viewport bg-background flex items-center justify-center p-6">
        {state.status === "error" && (
          <p className="max-w-md text-center text-sm text-muted-foreground">{state.message}</p>
        )}
      </div>
    </ThemeProvider>
  );
};

const basename = (path: string) => path.split(/[\\/]/).pop() || path;

const Review: React.FC<{ session: Session }> = ({ session }) => {
  useViewportEnvironment();
  usePrintMode();
  useDocumentTextSize();
  useDocumentFont();
  const { mode, markdown } = session;
  const annotateMode = mode === "annotate";
  const agentName = useMemo(() => getAgentName(session.origin), [session.origin]);

  const frontmatter = useMemo(() => extractFrontmatter(markdown).frontmatter, [markdown]);
  const blocks = useMemo(() => parseMarkdownToBlocks(markdown), [markdown]);
  const planHeading = useMemo(
    () => blocks.find((block) => block.type === "heading")?.content ?? null,
    [blocks],
  );
  const documentName = useMemo(
    () => ({
      name:
        session.title ??
        (session.filePath ? basename(session.filePath) : null) ??
        planHeading ??
        (annotateMode ? "Document" : "Plan"),
      title: session.filePath ?? undefined,
    }),
    [annotateMode, planHeading, session.filePath, session.title],
  );
  useEffect(() => {
    document.title = `${documentName.name} · Dynotator`;
  }, [documentName.name]);

  const viewerRef = useRef<ViewerHandle>(null);
  const planAreaRef = useRef<HTMLDivElement>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(getEditorMode);
  const [inputMethod, setInputMethod] = useState<InputMethod>(() => getInputMethod());
  const [uiPrefs, setUiPrefs] = useState(() => getUIPreferences());
  const [actionsLabelMode, setActionsLabelMode] = useState<ActionsLabelMode>("full");
  const gridEnabled = useConfigValue("gridEnabled");
  const vimModeEnabled = useConfigValue("vimModeEnabled");
  const vimHudEnabled = useConfigValue("vimHudEnabled");
  const vimHudKeyPanelEnabled = useConfigValue("vimHudKeyPanelEnabled");
  const [isPanelOpen, setIsPanelOpen] = useState(() => window.innerWidth >= 768);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [isPlanDiffActive, setIsPlanDiffActive] = useState(false);
  const [planDiffMode, setPlanDiffMode] = useState<PlanDiffMode>("classic");
  const [pendingPasteImage, setPendingPasteImage] = useState<{
    file: File;
    blobUrl: string;
    initialName: string;
  } | null>(null);
  const showsPermissionMode = !annotateMode && session.origin === "claude-code";
  const [showPermissionModeSetup, setShowPermissionModeSetup] = useState(
    () => showsPermissionMode && needsPermissionModeSetup(),
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    () => getPermissionModeSettings().mode,
  );
  const [compactSurface, setCompactSurface] = useState<CompactSurface>("artifact");
  const [compactNavigatorTab, setCompactNavigatorTab] = useState<SidebarTab>("toc");
  const [compactDecisionComposer, setCompactDecisionComposer] = useState<DecisionActionId | null>(
    null,
  );
  const [compactDecisionConfirm, setCompactDecisionConfirm] = useState<DecisionActionId | null>(
    null,
  );
  const [unanchoredIds, setUnanchoredIds] = useState<ReadonlySet<string>>(() => new Set());

  const isMobile = useIsMobile();
  const isCompact = useCompactTouchLayout();
  const effectiveEditorMode: EditorMode = isCompact ? "selection" : editorMode;
  const planMaxWidth = PLAN_WIDTHS[uiPrefs.planWidth] ?? 832;

  const [decided, setDecided] = useState(false);
  const ann = useAnnotations({ blocks, viewerRef, readOnly: decided });
  const { annotations, globalAttachments } = ann;
  const diffAnnotations = useMemo(() => annotations.filter((a) => !!a.diffContext), [annotations]);
  const viewerAnnotations = useMemo(
    () => annotations.filter((a) => !a.diffContext),
    [annotations],
  );
  const feedbackInput = useMemo<FeedbackInput>(
    () => ({ mode, blocks, annotations, globalAttachments }),
    [annotations, blocks, globalAttachments, mode],
  );
  const feedbackReady = hasFeedback(feedbackInput);
  const feedbackCount = annotations.length + globalAttachments.length;
  const answerCount = useMemo(() => countQuestionAnswers([annotations]), [annotations]);
  const answersOnly =
    !annotateMode &&
    isAnswersOnlyFeedback({
      answerCount,
      feedbackCount,
      hasDirectEdits: false,
      hasSavedFileChanges: false,
    });

  const draft = useDraft({ draft: { annotations, globalAttachments }, enabled: !decided });
  const decision = useDecision({
    mode,
    feedbackInput,
    answersOnly,
    permissionMode: showsPermissionMode ? permissionMode : null,
    getDraftGeneration: draft.getDraftGeneration,
    addAnnotation: ann.add,
    onDecided: draft.cancelPending,
  });
  const { submitted, isSubmitting } = decision;
  useEffect(() => {
    if (submitted) setDecided(true);
  }, [submitted]);
  const revisionReady = useRevisionWatch({
    active: submitted === "denied" && !annotateMode,
    version: session.versionInfo?.version ?? 0,
  });

  const restoreDraft = useCallback(() => {
    const restored = draft.restore();
    if (!restored) return;
    ann.history.clear();
    ann.setAnnotations(restored.annotations);
    ann.setGlobalAttachments(restored.globalAttachments);
    setTimeout(() => {
      viewerRef.current?.applySharedAnnotations(
        restored.annotations.filter((a) => annotationOwnsHighlight(a) && !a.diffContext),
      );
    }, 100);
  }, [ann, draft]);

  const handleRestoreReport = useCallback(
    ({ attempted, unanchored, moved }: AnnotationRestoreReport) => {
      if (moved && moved.length > 0) ann.setAnnotations((current) => applyRestoredAnchors(current, moved));
      setUnanchoredIds((prev) => {
        const next = new Set(prev);
        for (const id of attempted) next.delete(id);
        for (const id of unanchored) next.add(id);
        return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
      });
    },
    [ann],
  );

  // Phones scroll the page itself so the browser can collapse its chrome.
  const { viewport: scrollViewport, onViewportReady } = useOverlayViewport();
  const mainViewportRef = useRef<HTMLElement | null>(null);
  const handleDocumentViewportReady = useCallback(
    (next: HTMLElement | null) => {
      mainViewportRef.current = next;
      onViewportReady(next && isCompact ? getDocumentScrollViewport() : next);
    },
    [isCompact, onViewportReady],
  );
  useEffect(() => {
    if (!mainViewportRef.current) return;
    onViewportReady(isCompact ? getDocumentScrollViewport() : mainViewportRef.current);
  }, [isCompact, onViewportReady]);
  useScrollKeyRouting({ viewport: scrollViewport, enabled: !vimModeEnabled });

  const hasTocEntries = useMemo(() => tocHeadings(blocks).length > 0, [blocks]);
  const sidebar = useSidebar(uiPrefs.tocEnabled && hasTocEntries);
  const panelResize = useResizablePanel({
    storageKey: "plannotator-panel-width",
    onSnapClose: () => setIsPanelOpen(false),
    onClick: () => setIsPanelOpen(false),
    apply: (w) => document.documentElement.style.setProperty("--rpanel-w", `${w}px`),
  });
  const tocResize = useResizablePanel({
    storageKey: "plannotator-toc-width",
    defaultWidth: 240,
    minWidth: 160,
    maxWidth: 400,
    side: "left",
    onSnapClose: sidebar.close,
    onClick: sidebar.close,
    apply: (w) => document.documentElement.style.setProperty("--toc-w", `${w}px`),
  });
  const lastTocPrefRef = useRef(uiPrefs.tocEnabled);
  useEffect(() => {
    if (lastTocPrefRef.current === uiPrefs.tocEnabled) return;
    lastTocPrefRef.current = uiPrefs.tocEnabled;
    if (uiPrefs.tocEnabled && hasTocEntries) sidebar.open("toc");
    else if (!uiPrefs.tocEnabled) sidebar.close();
  }, [hasTocEntries, sidebar, uiPrefs.tocEnabled]);

  const planDiff = usePlanDiff(markdown, session.previousPlan, session.versionInfo);
  const exitPlanDiff = useCallback(() => setIsPlanDiffActive(false), []);
  usePlanDiffViewAutoExit(isPlanDiffActive, planDiff.hasPreviousVersion, exitPlanDiff);
  const showVersionsTab = (session.versionInfo?.totalVersions ?? 0) > 1;
  useEffect(() => {
    if (!isPlanDiffActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setIsPlanDiffActive(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPlanDiffActive]);

  const headingCount = useMemo(() => blocks.filter((b) => b.type === "heading").length, [blocks]);
  const activeSection = useActiveSection(planAreaRef, headingCount, scrollViewport);

  useLayoutEffect(() => {
    const el = planAreaRef.current;
    if (!el) return;
    return observeActionsLabelMode(el, (next) =>
      setActionsLabelMode((prev) => (prev === next ? prev : next)),
    );
  }, []);

  // --- Selection and panels ------------------------------------------------
  const closeCompactSurface = useCallback(() => setCompactSurface("artifact"), []);
  const handleSelectAnnotation = useCallback(
    (id: string | null) => {
      ann.select(id);
      if (id && isMobile && !isCompact) setIsPanelOpen(true);
    },
    [ann, isCompact, isMobile],
  );
  const handleAnnotationPanelToggle = useCallback(() => {
    if (isCompact) setCompactSurface("annotations");
    else setIsPanelOpen((open) => !open);
  }, [isCompact]);
  const toggleSidebarTab = useCallback(
    (tab: SidebarTab) => {
      if (isCompact) {
        setCompactNavigatorTab(tab);
        setCompactSurface((s) => (s === "navigator" && compactNavigatorTab === tab ? "artifact" : "navigator"));
      } else {
        sidebar.toggleTab(tab);
      }
    },
    [compactNavigatorTab, isCompact, sidebar],
  );
  useEffect(() => {
    if (!isCompact) setCompactSurface("artifact");
  }, [isCompact]);

  const navigateToAnchor = useCallback(
    (hash: string) => {
      const go = () => viewerRef.current?.scrollToAnchor?.(hash);
      if (compactSurface !== "annotations" && !isPlanDiffActive) return go();
      closeCompactSurface();
      setIsPlanDiffActive(false);
      requestAnimationFrame(go);
    },
    [closeCompactSurface, compactSurface, isPlanDiffActive],
  );

  // --- Questions -----------------------------------------------------------
  const questionRows = useMemo(
    () => buildQuestionPanelRows(blocks, viewerAnnotations),
    [blocks, viewerAnnotations],
  );
  const lastQuestionJumpRef = useRef<string | null>(null);
  const jumpToQuestion = useCallback(
    (key: string) => {
      lastQuestionJumpRef.current = key;
      if (compactSurface === "annotations" || isPlanDiffActive) {
        closeCompactSurface();
        setIsPlanDiffActive(false);
        requestAnimationFrame(() => focusQuestionCard(key));
        return;
      }
      focusQuestionCard(key);
    },
    [closeCompactSurface, compactSurface, isPlanDiffActive],
  );
  const handleQuestionChipJump = useCallback(() => {
    const last = lastQuestionJumpRef.current;
    const skipped = questionRows.filter((row) => !row.orphaned && row.status === "skipped");
    const key =
      nextOpenQuestionKey(questionRows, last) ??
      skipped[(skipped.findIndex((row) => row.key === last) + 1) % Math.max(skipped.length, 1)]
        ?.key ??
      null;
    if (key) jumpToQuestion(key);
  }, [jumpToQuestion, questionRows]);
  const progress = useMemo(() => questionProgress(questionRows), [questionRows]);
  const headerQuestionProgress =
    progress.total > 0
      ? {
          ...progress,
          hasOpen: nextOpenQuestionKey(questionRows) !== null,
          onJump: handleQuestionChipJump,
        }
      : undefined;
  const handleSelectQuestionRow = useCallback(
    (row: QuestionPanelRow) => {
      if (!row.orphaned) jumpToQuestion(row.key);
    },
    [jumpToQuestion],
  );

  // --- Decision ------------------------------------------------------------
  const decisionSpec = useMemo(
    () =>
      annotateMode
        ? buildDecisionSpec({
            app: "annotate",
            gate: false,
            count: feedbackCount,
            hasFeedback: feedbackReady,
            approvalNotesSupported: false,
          })
        : buildDecisionSpec({
            app: "plan",
            gate: true,
            count: feedbackCount,
            hasFeedback: feedbackReady,
            approvalNotesSupported: session.approvalNotesSupported,
            plan: { answers: answerCount, directEdits: false, answersOnly, agentName },
          }),
    [
      agentName,
      annotateMode,
      answerCount,
      answersOnly,
      feedbackCount,
      feedbackReady,
      session.approvalNotesSupported,
    ],
  );
  const actRef = useRef(decision.act);
  actRef.current = decision.act;
  const decisionHandlers = useMemo<Record<DecisionActionId, DecisionHandler>>(
    () => ({
      primary: () => actRef.current("primary"),
      "note-with-approval": (note) => actRef.current("note-with-approval", note),
      "request-changes": (note) => actRef.current("request-changes", note),
      "note-with-feedback": (note) => actRef.current("note-with-feedback", note),
      "approve-with-notes": () => actRef.current("approve-with-notes"),
      "discard-and-finish": () => actRef.current("discard-and-finish"),
    }),
    [],
  );
  const permissionModeLabel =
    PERMISSION_MODE_OPTIONS.find((option) => option.value === permissionMode)?.label ??
    permissionMode;
  const menuFooter = useMemo<DecisionControlProps["menuFooter"]>(
    () =>
      showsPermissionMode
        ? ({ closeMenu }: { closeMenu: () => void }) => (
            <PermissionModeMenuLine
              agentName={agentName}
              modeLabel={permissionModeLabel}
              onChange={() => {
                closeMenu();
                setSettingsOpen(true);
              }}
            />
          )
        : undefined,
    [agentName, permissionModeLabel, showsPermissionMode],
  );
  const headerDecision = useMemo(
    () => ({ spec: decisionSpec, handlers: decisionHandlers, menuFooter }),
    [decisionHandlers, decisionSpec, menuFooter],
  );

  const dialogOpen = showExport || settingsOpen || showPermissionModeSetup || !!pendingPasteImage;
  const busy = !!submitted || isSubmitting;

  // Mod+Enter is the visible primary decision.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable)
        return;
      if (document.querySelector('[data-plannotator-confirm-dialog="true"]')) return;
      if (dialogOpen || busy) return;
      e.preventDefault();
      actRef.current("primary");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dialogOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldPrintOnKey(e, dialogOpen || !!submitted)) return;
      e.preventDefault();
      window.print();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, submitted]);

  const canHandleChromeShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogOpen || busy) return false;
      if (document.querySelector('[data-plannotator-confirm-dialog="true"]')) return false;
      const target = event.target as HTMLElement | null;
      return target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA" && !target?.isContentEditable;
    },
    [busy, dialogOpen],
  );
  const canHandleHistoryShortcut = useCallback(
    (event: KeyboardEvent) =>
      !event.defaultPrevented &&
      !busy &&
      !pendingPasteImage &&
      !isNativeHistoryOwner(event) &&
      !hasActiveHistoryOverlay(document),
    [busy, pendingPasteImage],
  );
  useHistoryShortcuts({
    handlers: {
      undo: {
        when: (event) => canHandleHistoryShortcut(event) && ann.history.canUndo,
        handle: () => void ann.history.undo(),
      },
      redo: {
        when: (event) => canHandleHistoryShortcut(event) && ann.history.canRedo,
        handle: () => void ann.history.redo(),
      },
    },
  });

  useSidebarShortcuts({
    handlers: {
      toggleContents: { when: canHandleChromeShortcut, handle: () => toggleSidebarTab("toc") },
    },
  });

  const toolstripVisible = !isPlanDiffActive;
  const handleEditorModeChange = useCallback((next: EditorMode) => {
    setEditorMode(next);
    saveEditorMode(next);
  }, []);
  const handleInputMethodChange = useCallback((next: InputMethod) => {
    setInputMethod(next);
    saveInputMethod(next, "markdown");
  }, []);
  useInputMethodSwitch(inputMethod, handleInputMethodChange);
  const canHandleModeShortcut = useCallback(
    (event: KeyboardEvent) => toolstripVisible && canHandleChromeShortcut(event),
    [canHandleChromeShortcut, toolstripVisible],
  );
  useAnnotationModeShortcuts({
    handlers: {
      selectMarkupMode: { when: canHandleModeShortcut, handle: () => handleEditorModeChange("selection") },
      selectCommentMode: { when: canHandleModeShortcut, handle: () => handleEditorModeChange("comment") },
      selectRedlineMode: { when: canHandleModeShortcut, handle: () => handleEditorModeChange("redline") },
      selectQuickLabelMode: {
        when: canHandleModeShortcut,
        handle: () => handleEditorModeChange("quickLabel"),
      },
    },
  });

  // --- Pasted images -------------------------------------------------------
  useEffect(() => {
    if (decided) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-comment-popover="true"], textarea, input')) return;
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        setPendingPasteImage({
          file,
          blobUrl: URL.createObjectURL(file),
          initialName: deriveImageName(
            file.name,
            globalAttachments.map((g) => g.name),
          ),
        });
        return;
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [decided, globalAttachments]);
  const closePastedImage = () => {
    if (pendingPasteImage) URL.revokeObjectURL(pendingPasteImage.blobUrl);
    setPendingPasteImage(null);
  };
  const acceptPastedImage = async (blob: Blob, hasDrawings: boolean, name: string) => {
    if (!pendingPasteImage) return;
    try {
      const form = new FormData();
      form.append(
        "file",
        hasDrawings ? new File([blob], "annotated.png", { type: "image/png" }) : pendingPasteImage.file,
      );
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const data = (await res.json()) as { path: string };
      ann.setGlobalAttachments((prev) => [...prev, { path: data.path, name }]);
    } catch (error) {
      toast.error("Could not upload the image", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      closePastedImage();
    }
  };

  // --- Export --------------------------------------------------------------
  const getFeedback = () => buildFeedback(feedbackInput);
  const wrapForAgent = useCallback(
    (feedback: string) => wrapCopiedFeedback(feedback, mode, session.filePath ?? documentName.name),
    [documentName.name, mode, session.filePath],
  );
  const downloadAnnotations = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([buildFeedback(feedbackInput)], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "annotations.md";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded annotations");
  }, [feedbackInput]);

  // --- Compact layout ------------------------------------------------------
  const compactNavigatorTabs: SidebarTab[] = [
    ...(hasTocEntries ? ["toc" as const] : []),
    ...(showVersionsTab ? ["versions" as const] : []),
  ];
  const effectiveCompactTab = compactNavigatorTabs.includes(compactNavigatorTab)
    ? compactNavigatorTab
    : (compactNavigatorTabs[0] ?? "toc");
  const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const compactReviewActions: CompactPlanReviewAction[] = [
    ...(annotateMode
      ? [
          {
            id: "exit" as const,
            label: "Close session",
            onSelect: decision.close,
            disabled: busy,
          },
        ]
      : []),
    {
      id: compactPrimaryIdForDecision(decisionSpec.primary),
      label: decisionSpec.primary.mobileLabel ?? decisionSpec.primary.label,
      subtitle: answersOnly
        ? countLabel(answerCount, "answer")
        : feedbackCount > 0
          ? countLabel(feedbackCount, "annotation")
          : undefined,
      onSelect: () => decision.act("primary"),
      disabled: busy,
    },
    ...decisionSpec.items.map((item) => ({
      id: compactRowIdForDecisionItem(item.id),
      label: item.label,
      subtitle: item.subtitle,
      onSelect: () => {
        if (item.composer) setCompactDecisionComposer(item.id);
        else if (item.confirm) setCompactDecisionConfirm(item.id);
        else decision.act(item.id);
      },
      disabled: busy,
    })),
  ];
  const compactFeedbackSummary =
    feedbackCount > 0
      ? `${countLabel(feedbackCount, "annotation")} ${feedbackCount === 1 ? "is" : "are"} ready.`
      : annotateMode
        ? "No feedback added. You can finish or keep reviewing."
        : "No feedback added. You can approve or keep reviewing.";
  const compactSessionActions: CompactPlanAction[] = isCompact
    ? [
        {
          id: "annotations",
          label: "Annotations",
          subtitle: feedbackCount > 0 ? countLabel(feedbackCount, "item") : undefined,
          onSelect: () => setCompactSurface("annotations"),
        },
        {
          id: "review",
          label: "Review and finish",
          subtitle: feedbackReady ? "Feedback ready" : annotateMode ? "Finish" : "Approve or send feedback",
          onSelect: () => setCompactSurface("review"),
        },
      ]
    : [];
  const findSpecItem = (id: DecisionActionId | null) =>
    id === null ? null : (decisionSpec.items.find((item) => item.id === id) ?? null);
  const compactComposerItem = findSpecItem(compactDecisionComposer);
  const compactConfirmItem = findSpecItem(compactDecisionConfirm);

  const renderSidebar = (presentation: "desktop" | "overlay") => {
    const compact = presentation === "overlay";
    return (
      <SidebarContainer
        presentation={presentation}
        activeTab={compact ? effectiveCompactTab : sidebar.activeTab}
        onTabChange={(tab) => (compact ? setCompactNavigatorTab(tab) : sidebar.toggleTab(tab))}
        onClose={compact ? closeCompactSurface : sidebar.close}
        width={compact ? "100%" : `var(--toc-w, ${tocResize.width}px)`}
        showContentsTab={!compact || hasTocEntries}
        blocks={blocks}
        annotations={annotations}
        activeSection={activeSection}
        onTocNavigate={() => compact && closeCompactSurface()}
        showVersionsTab={showVersionsTab}
        versionInfo={session.versionInfo}
        versions={planDiff.versions}
        selectedBaseVersion={planDiff.diffBaseVersion}
        onSelectBaseVersion={planDiff.selectBaseVersion}
        isPlanDiffActive={isPlanDiffActive}
        hasPreviousVersion={planDiff.hasPreviousVersion}
        onActivatePlanDiff={() => {
          setIsPlanDiffActive(true);
          if (compact) closeCompactSurface();
        }}
        isLoadingVersions={planDiff.isLoadingVersions}
        isSelectingVersion={planDiff.isSelectingVersion}
        fetchingVersion={planDiff.fetchingVersion}
        onFetchVersions={planDiff.fetchVersions}
      />
    );
  };

  const renderAnnotationPanel = (presentation: "panel" | "embedded", isOpen = true) => (
    <AnnotationPanel
      isOpen={isOpen}
      presentation={presentation}
      blocks={blocks}
      onNavigateAnchor={navigateToAnchor}
      annotations={annotations}
      selectedId={ann.selectedId}
      onSelect={handleSelectAnnotation}
      onDelete={ann.remove}
      onEdit={ann.edit}
      width={presentation === "panel" ? `var(--rpanel-w, ${panelResize.width}px)` : undefined}
      unanchoredIds={unanchoredIds.size > 0 ? unanchoredIds : undefined}
      onClose={presentation === "panel" ? () => setIsPanelOpen(false) : closeCompactSurface}
      onQuickCopy={() => copyTextToClipboard(wrapForAgent(getFeedback()))}
      readOnly={decided}
      questionRows={questionRows.length > 0 ? questionRows : undefined}
      onSelectQuestion={handleSelectQuestionRow}
    />
  );

  const showCollapsedSidebarTabs = !isCompact && !sidebar.isOpen;
  const isResizing = panelResize.isDragging || tocResize.isDragging;
  const browserCanvas = gridEnabled ? "background" : "card";

  return (
    <ThemeProvider>
      <TooltipProvider disableHoverableContent>
        <div
          data-print-region="root"
          data-pn-browser-canvas={browserCanvas}
          data-pn-compact-touch-layout={isCompact ? "true" : undefined}
          data-pn-document-scroll={isCompact ? "true" : undefined}
          className={`pn-app-viewport flex flex-col ${isCompact ? "overflow-visible" : "overflow-hidden"} ${gridEnabled ? "bg-background" : "bg-card"}`}
        >
          <AppHeader
            sticky={!isCompact}
            compactTouchLayout={isCompact}
            compactNavigatorAvailable={compactNavigatorTabs.length > 0}
            compactNavigatorOpen={isCompact && compactSurface === "navigator"}
            onCompactNavigatorToggle={() => toggleSidebarTab(effectiveCompactTab)}
            compactSessionActions={compactSessionActions}
            documentName={documentName}
            annotateMode={annotateMode}
            origin={session.origin}
            isSubmitting={isSubmitting}
            isPanelOpen={isPanelOpen}
            annotationCount={feedbackCount}
            questionProgress={headerQuestionProgress}
            decision={headerDecision}
            onClose={decision.close}
            settingsOpen={settingsOpen}
            onOpenSettings={() => setSettingsOpen(true)}
            onCloseSettings={() => setSettingsOpen(false)}
            onOpenExport={() => setShowExport(true)}
            onDownloadAnnotations={downloadAnnotations}
            onPrint={() => window.print()}
            onAnnotationPanelToggle={handleAnnotationPanelToggle}
            onIdentityChange={ann.renameAuthor}
            onUIPreferencesChange={setUiPrefs}
            onPermissionModeChange={setPermissionMode}
          />

          <ScrollViewportProvider viewport={scrollViewport}>
            {isCompact && compactSurface === "navigator" && compactNavigatorTabs.length > 0 &&
              renderSidebar("overlay")}

            {isCompact && compactSurface === "annotations" && (
              <CompactPlanStage
                id="pn-compact-plan-annotations"
                title="Annotations"
                subtitle={documentName.name}
                count={feedbackCount}
                onClose={closeCompactSurface}
              >
                <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1">
                  {renderAnnotationPanel("embedded")}
                </div>
              </CompactPlanStage>
            )}

            {isCompact && compactSurface === "review" && (
              <CompactPlanStage
                id="pn-compact-plan-review"
                title="Review"
                subtitle={documentName.name}
                onClose={closeCompactSurface}
              >
                <CompactPlanReview
                  feedbackSummary={compactFeedbackSummary}
                  actions={compactReviewActions}
                  primaryActionId={compactPrimaryIdForDecision(decisionSpec.primary)}
                  onOpenAnnotations={() => setCompactSurface("annotations")}
                />
              </CompactPlanStage>
            )}

            <div
              data-print-region="content"
              className={`flex-1 flex ${isCompact ? "overflow-visible" : "overflow-hidden"} relative z-0 ${isResizing ? "select-none" : ""}`}
            >
              {showCollapsedSidebarTabs && (
                <SidebarTabs
                  activeTab={sidebar.activeTab}
                  onToggleTab={toggleSidebarTab}
                  hasDiff={planDiff.hasPreviousVersion}
                  showVersionsTab={showVersionsTab}
                  className="hidden lg:flex absolute left-0 top-0 z-20"
                />
              )}

              {!isCompact && sidebar.isOpen && (
                <div className="contents group/sidebar">
                  {renderSidebar("desktop")}
                  <ResizeHandle
                    {...tocResize.handleProps}
                    className="hidden lg:block z-[55]"
                    side="left"
                    hideHoverTrack
                    tooltip={RESIZE_HANDLE_TOOLTIP}
                    onCollapse={sidebar.close}
                  />
                </div>
              )}

              <OverlayScrollArea
                element="main"
                className={`flex-1 min-w-0 ${gridEnabled ? "bg-grid" : "bg-card"} ${showCollapsedSidebarTabs ? "lg:pl-[30px]" : ""}`}
                data-print-region="document"
                overflowX={isCompact ? "visible" : "hidden"}
                overflowY={isCompact ? "visible" : "auto"}
                onViewportReady={handleDocumentViewportReady}
              >
                <ConfirmDialog
                  isOpen={!!draft.offer}
                  onClose={draft.dismiss}
                  onConfirm={restoreDraft}
                  title="Draft Recovered"
                  message={
                    draft.offer
                      ? `Found ${countLabel(draft.offer.count, "annotation")} from ${draft.offer.timeAgo}. Would you like to restore them?`
                      : ""
                  }
                  confirmText="Restore"
                  cancelText="Dismiss"
                  showCancel
                />
                <div
                  ref={planAreaRef}
                  className="min-h-full flex flex-col items-center px-2 py-3 md:px-10 md:py-8 xl:px-16 relative z-10"
                >
                  {!isCompact && !isPlanDiffActive && uiPrefs.stickyActionsEnabled && (
                    <StickyHeaderLane
                      inputMethod={inputMethod}
                      onInputMethodChange={handleInputMethodChange}
                      mode={editorMode}
                      onModeChange={handleEditorModeChange}
                      planDiffStats={planDiff.diffStats}
                      isPlanDiffActive={isPlanDiffActive}
                      hasPreviousVersion={planDiff.hasPreviousVersion}
                      onPlanDiffToggle={() => setIsPlanDiffActive((v) => !v)}
                      maxWidth={planMaxWidth}
                      remountToken="plan"
                    />
                  )}

                  {toolstripVisible && (
                    <div
                      data-print-hide
                      className="w-full mb-3 md:mb-4 flex items-center justify-start"
                      style={{ maxWidth: planMaxWidth }}
                    >
                      {isCompact ? (
                        <CompactAnnotationControls
                          inputMethod={inputMethod}
                          onInputMethodChange={handleInputMethodChange}
                        />
                      ) : (
                        <AnnotationToolstrip
                          inputMethod={inputMethod}
                          onInputMethodChange={handleInputMethodChange}
                          mode={editorMode}
                          onModeChange={handleEditorModeChange}
                          showHelpLink
                        />
                      )}
                    </div>
                  )}

                  {planDiff.diffBlocks && planDiff.diffStats && (
                    <div
                      className={`w-full flex justify-center${gridEnabled ? " flex-1 print:flex-none" : ""}`}
                      data-grid-paper-column={gridEnabled ? "" : undefined}
                      style={{ display: isPlanDiffActive ? undefined : "none" }}
                    >
                      <PlanDiffViewer
                        diffBlocks={planDiff.diffBlocks}
                        diffStats={planDiff.diffStats}
                        diffMode={planDiffMode}
                        onDiffModeChange={setPlanDiffMode}
                        onPlanDiffToggle={() => setIsPlanDiffActive(false)}
                        baseVersionLabel={
                          planDiff.diffBaseVersion != null ? `v${planDiff.diffBaseVersion}` : undefined
                        }
                        baseVersion={planDiff.diffBaseVersion ?? undefined}
                        maxWidth={planMaxWidth}
                        annotations={diffAnnotations}
                        onAddAnnotation={ann.add}
                        onSelectAnnotation={handleSelectAnnotation}
                        selectedAnnotationId={ann.selectedId}
                        mode={effectiveEditorMode}
                        fillHeight={gridEnabled}
                      />
                    </div>
                  )}

                  <div
                    className={`w-full relative flex justify-center${gridEnabled ? " flex-1 print:flex-none" : ""}`}
                    data-grid-paper-column={gridEnabled ? "" : undefined}
                    style={{ display: isPlanDiffActive && planDiff.diffBlocks ? "none" : undefined }}
                  >
                    <Viewer
                      ref={viewerRef}
                      imageLightboxStepping
                      imageRegionComments
                      onDeleteAnnotation={ann.remove}
                      onEditAnnotation={ann.edit}
                      onRestoreReport={handleRestoreReport}
                      blocks={blocks}
                      markdown={markdown}
                      frontmatter={frontmatter}
                      annotations={viewerAnnotations}
                      onAddAnnotation={ann.add}
                      onSelectAnnotation={handleSelectAnnotation}
                      selectedAnnotationId={ann.selectedId}
                      mode={effectiveEditorMode}
                      inputMethod={inputMethod}
                      vimModeEnabled={vimModeEnabled}
                      vimHudEnabled={vimModeEnabled && vimHudEnabled}
                      vimHudKeyPanelEnabled={vimHudKeyPanelEnabled}
                      gridEnabled={gridEnabled}
                      fillHeight={gridEnabled}
                      globalAttachments={globalAttachments}
                      onAddGlobalAttachment={(image) =>
                        ann.setGlobalAttachments((prev) => [...prev, image])
                      }
                      onRemoveGlobalAttachment={(path) =>
                        ann.setGlobalAttachments((prev) => prev.filter((g) => g.path !== path))
                      }
                      stickyActions={uiPrefs.stickyActionsEnabled && !isCompact}
                      planDiffStats={planDiff.diffStats}
                      isPlanDiffActive={isPlanDiffActive}
                      onPlanDiffToggle={() => setIsPlanDiffActive((v) => !v)}
                      hasPreviousVersion={planDiff.hasPreviousVersion}
                      maxWidth={planMaxWidth}
                      copyLabel={annotateMode ? "Copy document" : undefined}
                      onToggleCheckbox={ann.checkbox.toggle}
                      checkboxOverrides={ann.checkbox.overrides}
                      onAnswerQuestion={ann.answerQuestion}
                      actionsLabelMode={actionsLabelMode}
                      readOnly={decided}
                    />
                  </div>
                  {isCompact && compactSurface === "artifact" && !isPlanDiffActive && (
                    <CompactPlanCompletion
                      feedbackSummary={compactFeedbackSummary}
                      maxWidth={planMaxWidth}
                      onOpenReview={() => setCompactSurface("review")}
                    />
                  )}
                </div>
              </OverlayScrollArea>

              <div className="contents group/sidebar">
                {isPanelOpen && !isCompact && (
                  <ResizeHandle
                    {...panelResize.handleProps}
                    className="hidden md:block z-[55]"
                    side="right"
                    hideHoverTrack
                    tooltip={RESIZE_HANDLE_TOOLTIP}
                    onCollapse={() => setIsPanelOpen(false)}
                  />
                )}
                {renderAnnotationPanel("panel", isPanelOpen && !isCompact)}
              </div>
            </div>
          </ScrollViewportProvider>

          <ExportModal
            isOpen={showExport}
            onClose={() => setShowExport(false)}
            annotationsOutput={showExport ? getFeedback() : ""}
            annotationCount={feedbackCount}
            wrapCopiedAnnotations={wrapForAgent}
          />

          {compactComposerItem?.composer && (
            <DecisionNoteDialog
              isOpen
              onClose={() => setCompactDecisionComposer(null)}
              composer={compactComposerItem.composer}
              subtitle={compactComposerItem.subtitle}
              disabled={busy}
              onSubmit={(note) => {
                setCompactDecisionComposer(null);
                decision.act(compactComposerItem.id, note);
              }}
            />
          )}
          {compactConfirmItem?.confirm && (
            <ConfirmDialog
              isOpen
              onClose={() => setCompactDecisionConfirm(null)}
              onConfirm={() => {
                setCompactDecisionConfirm(null);
                decision.act(compactConfirmItem.id);
              }}
              title={compactConfirmItem.confirm.title}
              message={compactConfirmItem.confirm.message}
              confirmText={compactConfirmItem.confirm.confirmText}
              cancelText="Cancel"
              variant="warning"
              showCancel
            />
          )}

          <Toaster
            position="top-right"
            offset={64}
            toastOptions={{
              className: "select-none",
              style: {
                "--normal-bg": "var(--card)",
                "--normal-border": "var(--border)",
                "--normal-text": "var(--foreground)",
                "--success-bg": "oklch(from var(--success) l c h / 0.15)",
                "--success-border": "oklch(from var(--success) l c h / 0.3)",
                "--success-text": "var(--success)",
                "--error-bg": "oklch(from var(--destructive) l c h / 0.15)",
                "--error-border": "oklch(from var(--destructive) l c h / 0.3)",
                "--error-text": "var(--destructive)",
              } as React.CSSProperties,
            }}
          />

          <CompletionOverlay
            submitted={submitted}
            title={completionTitle(submitted, annotateMode)}
            subtitle={completionSubtitle(submitted, annotateMode, agentName)}
            agentLabel={agentName}
            footer={
              revisionReady ? (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Review the revised plan
                </button>
              ) : undefined
            }
          />

          <ImageAnnotator
            isOpen={!!pendingPasteImage}
            imageSrc={pendingPasteImage?.blobUrl ?? ""}
            initialName={pendingPasteImage?.initialName}
            onAccept={acceptPastedImage}
            onClose={closePastedImage}
          />

          <PermissionModeSetup
            isOpen={showPermissionModeSetup}
            onComplete={(next) => {
              setPermissionMode(next);
              setShowPermissionModeSetup(false);
            }}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
};

function completionTitle(submitted: string | null, annotateMode: boolean): string {
  switch (submitted) {
    case "approved":
      return annotateMode ? "Approved" : "Plan Approved";
    case "done":
      return "Done";
    case "exited":
      return "Session Closed";
    default:
      return "Feedback Sent";
  }
}

function completionSubtitle(
  submitted: string | null,
  annotateMode: boolean,
  agentName: string,
): string {
  switch (submitted) {
    case "approved":
      return annotateMode
        ? `${agentName} will proceed.`
        : `${agentName} will proceed with the implementation.`;
    case "done":
      return `Nothing was sent to ${agentName}.`;
    case "exited":
      return "The session was closed without feedback.";
    default:
      return annotateMode
        ? `${agentName} will address your feedback on the document.`
        : `${agentName} will revise the plan based on your feedback.`;
  }
}

export default App;
