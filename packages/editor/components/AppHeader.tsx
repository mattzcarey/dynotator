import React from "react";
import type { Origin } from "@dynotator/shared/agents";
import { ExitButton } from "@dynotator/ui/components/ToolbarButtons";
import {
  DecisionControl,
  type DecisionControlProps,
  type DecisionHandler,
} from "@dynotator/ui/components/DecisionControl";
import { QuestionProgressChip } from "@dynotator/ui/components/QuestionProgressChip";
import type { DecisionActionId, DecisionSpec } from "@dynotator/ui/utils/decisionSpec";
import { Settings } from "@dynotator/ui/components/Settings";
import { PlanHeaderMenu, type CompactPlanAction } from "@dynotator/ui/components/PlanHeaderMenu";
import type { UIPreferences } from "@dynotator/ui/utils/uiPreferences";
import type { PermissionMode } from "@dynotator/ui/utils/permissionMode";
import { Tooltip } from "@dynotator/ui/components/Tooltip";

interface AppHeaderProps {
  /** Phones scroll the header away with the page; desktop keeps it pinned. */
  sticky: boolean;
  compactTouchLayout: boolean;
  compactNavigatorAvailable: boolean;
  compactNavigatorOpen: boolean;
  onCompactNavigatorToggle: () => void;
  compactSessionActions: CompactPlanAction[];
  documentName: { name: string; title?: string };
  annotateMode: boolean;
  origin: Origin | null;
  isSubmitting: boolean;
  isPanelOpen: boolean;
  annotationCount: number;
  questionProgress?: { done: number; total: number; hasOpen: boolean; onJump: () => void };
  decision: {
    spec: DecisionSpec;
    handlers: Record<DecisionActionId, DecisionHandler>;
    menuFooter?: DecisionControlProps["menuFooter"];
  };
  onClose: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenExport: () => void;
  onDownloadAnnotations: () => void;
  onPrint: () => void;
  onAnnotationPanelToggle: () => void;
  onIdentityChange: (oldId: string, newId: string) => void;
  onUIPreferencesChange: (prefs: UIPreferences) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

export const AppHeader = React.memo<AppHeaderProps>(
  ({
    sticky,
    compactTouchLayout,
    compactNavigatorAvailable,
    compactNavigatorOpen,
    onCompactNavigatorToggle,
    compactSessionActions,
    documentName,
    annotateMode,
    origin,
    isSubmitting,
    isPanelOpen,
    annotationCount,
    questionProgress,
    decision,
    onClose,
    settingsOpen,
    onOpenSettings,
    onCloseSettings,
    onOpenExport,
    onDownloadAnnotations,
    onPrint,
    onAnnotationPanelToggle,
    onIdentityChange,
    onUIPreferencesChange,
    onPermissionModeChange,
  }) => (
    <header
      data-app-header="true"
      className={`${compactTouchLayout ? "h-[52px] grid grid-cols-[44px_minmax(0,1fr)_44px] items-center px-1" : "h-12 flex items-center justify-between px-2 md:px-4"} border-b border-border/50 bg-card/50 backdrop-blur-xl z-[50] ${sticky ? "sticky top-0" : "relative"}`}
    >
      <div
        className={
          compactTouchLayout ? "flex items-center justify-start" : "flex min-w-0 items-center gap-2"
        }
      >
        {compactTouchLayout ? (
          compactNavigatorAvailable ? (
            <CompactPlanNavigatorTrigger
              open={compactNavigatorOpen}
              onToggle={onCompactNavigatorToggle}
            />
          ) : (
            <span className="block h-11 w-11" aria-hidden="true" />
          )
        ) : (
          <>
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <img src="/favicon.svg" alt="" className="size-5" />
              Dynotator
            </span>
            <HeaderDocumentName {...documentName} />
          </>
        )}
      </div>

      {compactTouchLayout && (
        <div
          data-pn-compact-document-title="true"
          className="min-w-0 px-2 text-center text-sm font-medium tracking-tight text-foreground"
          title={documentName.title ?? documentName.name}
        >
          <span className="block truncate">{documentName.name}</span>
        </div>
      )}

      <div
        className={`flex items-center gap-1 md:gap-2 ${compactTouchLayout ? "justify-end" : "shrink-0"}`}
      >
        {!compactTouchLayout && (
          <>
            {questionProgress && questionProgress.total > 0 && (
              <QuestionProgressChip {...questionProgress} />
            )}
            {annotateMode && (
              <ExitButton
                appearance="ghost"
                onClick={onClose}
                disabled={isSubmitting}
                title="Close the session without sending feedback"
              />
            )}
            <DecisionControl
              spec={decision.spec}
              handlers={decision.handlers}
              busy={isSubmitting}
              isLoading={isSubmitting}
              menuFooter={decision.menuFooter}
            />
            <div className="w-px h-5 bg-border/50 mx-1 hidden md:block" />
            <button
              onClick={onAnnotationPanelToggle}
              className={`relative p-1.5 rounded-md text-xs font-medium transition-all ${
                isPanelOpen
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title={isPanelOpen ? "Hide annotations" : "Show annotations"}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>
              {annotationCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground px-0.5">
                  {annotationCount > 99 ? "99+" : annotationCount}
                </span>
              )}
            </button>
          </>
        )}

        <div className="hidden">
          <Settings
            onIdentityChange={onIdentityChange}
            origin={origin}
            mode={annotateMode ? "annotate" : "plan"}
            onUIPreferencesChange={onUIPreferencesChange}
            onPermissionModeChange={onPermissionModeChange}
            externalOpen={settingsOpen}
            onExternalClose={onCloseSettings}
          />
        </div>

        <PlanHeaderMenu
          onOpenSettings={onOpenSettings}
          onOpenExport={onOpenExport}
          onDownloadAnnotations={onDownloadAnnotations}
          onPrint={onPrint}
          compactTouchLayout={compactTouchLayout}
          compactSessionActions={compactSessionActions}
        />
      </div>
    </header>
  ),
);

const CompactPlanNavigatorTrigger = ({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) => (
  <button
    id="pn-compact-plan-navigator-trigger"
    type="button"
    onClick={onToggle}
    data-pn-touch-target="true"
    data-pn-touch-target-icon="true"
    data-pn-compact-navigator-trigger="true"
    className={`flex h-11 w-11 items-center justify-center rounded-lg text-sm font-semibold tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 ${
      open ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted"
    }`}
    aria-label={open ? "Close plan navigator" : "Open plan navigator"}
    aria-expanded={open}
    aria-controls="pn-compact-plan-navigator"
    title={open ? "Close navigator" : "Navigate plan"}
  >
    <svg
      className="h-[18px] w-[18px] flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 6h14M5 12h14M5 18h9" />
    </svg>
  </button>
);

/** "/ notes.md" after the name, the full path in a tooltip. */
const HeaderDocumentName: React.FC<{ name: string; title?: string }> = ({ name, title }) => {
  const label = (
    <span
      data-header-document-name="true"
      className="min-w-0 truncate text-sm text-foreground/90"
      tabIndex={title ? 0 : undefined}
    >
      {name}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 md:gap-2.5 pl-0.5">
      <span className="shrink-0 text-sm text-muted-foreground/60" aria-hidden="true">
        /
      </span>
      {title ? (
        <Tooltip content={title} side="bottom" align="start" delayDuration={400}>
          {label}
        </Tooltip>
      ) : (
        label
      )}
    </div>
  );
};
