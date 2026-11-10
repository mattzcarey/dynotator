/**
 * SidebarContainer — Shared sidebar shell
 *
 * Houses the Table of Contents and the Version Browser.
 * Tab bar at top switches between them.
 */

import React from "react";
import type { SidebarTab } from "../../hooks/useSidebar";
import type { Block, Annotation } from "../../types";
import type { VersionInfo, VersionEntry } from "../../hooks/usePlanDiff";
import { TableOfContents } from "../TableOfContents";
import { VersionBrowser } from "./VersionBrowser";
import { OverlayScrollArea } from "../OverlayScrollArea";

interface SidebarContainerProps {
  /** Desktop preserves the incumbent sticky rail. Compact Plan uses the same
   * content as a safe, visible-viewport-bounded foreground surface. */
  presentation?: "desktop" | "overlay";
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onClose: () => void;
  width: number | string;
  // TOC props
  showContentsTab?: boolean;
  blocks: Block[];
  annotations: Annotation[];
  activeSection: string | null;
  onTocNavigate: (blockId: string) => void;
  // Version Browser props
  showVersionsTab?: boolean;
  versionInfo: VersionInfo | null;
  versions: VersionEntry[];
  selectedBaseVersion: number | null;
  onSelectBaseVersion: (version: number) => void;
  isPlanDiffActive: boolean;
  hasPreviousVersion: boolean;
  onActivatePlanDiff: () => void;
  isLoadingVersions: boolean;
  isSelectingVersion: boolean;
  fetchingVersion: number | null;
  onFetchVersions: () => void;
}

export const SidebarContainer: React.FC<SidebarContainerProps> = ({
  presentation = "desktop",
  activeTab,
  onTabChange,
  onClose,
  width,
  showContentsTab = true,
  blocks,
  annotations,
  activeSection,
  onTocNavigate,
  showVersionsTab,
  versionInfo,
  versions,
  selectedBaseVersion,
  onSelectBaseVersion,
  isPlanDiffActive,
  hasPreviousVersion,
  onActivatePlanDiff,
  isLoadingVersions,
  isSelectingVersion,
  fetchingVersion,
  onFetchVersions,
}) => {
  const compact = presentation === "overlay";
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (compact) closeButtonRef.current?.focus({ preventScroll: true });
  }, [compact]);

  const handleCompactKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!compact) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <aside
      id={compact ? "pn-compact-plan-navigator" : undefined}
      data-pn-plan-navigator={compact ? "true" : undefined}
      // The compact navigator (Contents / Versions) is the same kind
      // of full-viewport transient surface as CompactPlanStage, so it must not
      // print over the document either. Desktop rail printing is unchanged.
      data-print-hide={compact ? true : undefined}
      role={compact ? "dialog" : undefined}
      aria-modal={compact ? true : undefined}
      aria-label={compact ? "Plan navigator" : undefined}
      onKeyDown={compact ? handleCompactKeyDown : undefined}
      className={
        compact
          ? "pn-visible-viewport-stage z-[90] flex flex-col overflow-hidden bg-card text-foreground"
          : "hidden lg:flex flex-col sticky top-12 h-[calc(100vh-3rem)] flex-shrink-0 bg-sidebar border-r border-border"
      }
      style={{ width: compact ? undefined : width }}
    >
      {compact && (
        <div className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-border/50 px-3">
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-tight">Navigate</p>
            <p className="truncate text-[11px] text-muted-foreground" aria-live="polite">
              Choose what to review
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            data-pn-touch-target="true"
            data-pn-touch-target-icon="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Close navigator"
            title="Close navigator"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div
        className={
          compact
            ? "flex min-h-11 items-center gap-3 overflow-x-auto border-b border-border px-3"
            : "flex h-10 items-center border-b border-border px-3 gap-3 flex-shrink-0 overflow-hidden min-w-0"
        }
      >
        {showContentsTab && (
          <TabButton
            active={activeTab === "toc"}
            onClick={() => onTabChange("toc")}
            icon={
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 10h16M4 14h10M4 18h10"
                />
              </svg>
            }
            label="Contents"
            touch={compact}
          />
        )}
        {showVersionsTab && (
          <TabButton
            active={activeTab === "versions"}
            onClick={() => onTabChange("versions")}
            icon={
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
            label="Versions"
            touch={compact}
          />
        )}
      </div>

      {/* Content area */}
      <OverlayScrollArea
        className={
          compact
            ? "flex-1 min-h-0 overscroll-contain [-webkit-overflow-scrolling:touch]"
            : "flex-1 min-h-0"
        }
      >
        {activeTab === "toc" && showContentsTab && (
          <TableOfContents
            blocks={blocks}
            annotations={annotations}
            activeId={activeSection}
            onNavigate={onTocNavigate}
            className=""
          />
        )}
        {activeTab === "versions" && (
          <VersionBrowser
            versionInfo={versionInfo}
            versions={versions}
            selectedBaseVersion={selectedBaseVersion}
            onSelectBaseVersion={onSelectBaseVersion}
            isPlanDiffActive={isPlanDiffActive}
            hasPreviousVersion={hasPreviousVersion}
            onActivatePlanDiff={onActivatePlanDiff}
            isLoading={isLoadingVersions}
            isSelectingVersion={isSelectingVersion}
            fetchingVersion={fetchingVersion}
            onFetchVersions={onFetchVersions}
          />
        )}
      </OverlayScrollArea>
    </aside>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: boolean;
  touch?: boolean;
}> = ({ active, onClick, icon, label, badge, touch = false }) => (
  <button
    type="button"
    onClick={onClick}
    data-pn-touch-target={touch ? "true" : undefined}
    className={`relative flex items-center gap-1.5 self-stretch font-mono text-[11px] tracking-[0.04em] transition-colors min-w-0 shrink-0 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 ${touch ? "min-h-11 " : ""}${
      active
        ? "text-foreground after:bg-primary"
        : "text-muted-foreground hover:text-foreground after:bg-transparent"
    }`}
  >
    {icon}
    {label}
    {badge && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
  </button>
);

