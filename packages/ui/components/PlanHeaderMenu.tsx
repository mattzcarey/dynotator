import React from "react";
import {
  ActionMenu,
  ActionMenuDivider,
  ActionMenuItem,
  ActionMenuSectionLabel,
} from "./ActionMenu";
import { useTheme } from "./ThemeProvider";
import { THEME_MODES } from "./themeModes";

interface PlanHeaderMenuProps {
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onDownloadAnnotations: () => void;
  onPrint: () => void;
  compactTouchLayout?: boolean;
  compactSessionActions?: CompactPlanAction[];
}

export interface CompactPlanAction {
  id: "exit" | "feedback" | "approve" | "annotations" | "review" | "note" | "discard-finish";
  label: string;
  subtitle?: string;
  onSelect: () => void;
  disabled?: boolean;
}

export const PlanHeaderMenu: React.FC<PlanHeaderMenuProps> = ({
  onOpenSettings,
  onOpenExport,
  onDownloadAnnotations,
  onPrint,
  compactTouchLayout = false,
  compactSessionActions = [],
}) => {
  const { mode, setMode } = useTheme();

  return (
    <ActionMenu
      panelWidth="wide"
      panelClassName={
        compactTouchLayout
          ? "absolute top-full right-0 mt-1 w-[min(18rem,calc(100vw-1rem))] max-h-[calc(var(--pn-viewport-height,100vh)-4.5rem-var(--pn-safe-top)-var(--pn-safe-bottom))] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl z-[70]"
          : undefined
      }
      renderTrigger={({ isOpen, toggleMenu }) => (
        <button
          id={compactTouchLayout ? "pn-compact-plan-options-trigger" : undefined}
          data-pn-touch-target={compactTouchLayout || undefined}
          data-pn-touch-target-icon={compactTouchLayout || undefined}
          onClick={toggleMenu}
          className={`relative flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors ${compactTouchLayout ? "h-11 w-11 p-0" : "p-1.5 md:px-2.5 md:py-1"} ${
            isOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title="Options"
          aria-label="Options"
          aria-expanded={isOpen}
        >
          {isOpen ? <CloseIcon /> : <MenuIcon />}
          <span className="hidden md:inline">Options</span>
        </button>
      )}
    >
      {({ closeMenu }) => (
        <>
          {compactTouchLayout && compactSessionActions.length > 0 && (
            <>
              <CompactActionSection
                label="Review"
                actions={compactSessionActions}
                closeMenu={closeMenu}
              />
              <ActionMenuDivider />
            </>
          )}

          <div className="px-3 py-2 space-y-1.5">
            <ActionMenuSectionLabel>Theme</ActionMenuSectionLabel>
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
              {THEME_MODES.map(({ id, label, Icon }) => (
                <button
                  data-pn-touch-target={compactTouchLayout || undefined}
                  key={id}
                  onClick={() => {
                    closeMenu();
                    setMode(id);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    mode === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenSettings();
            }}
            icon={<SettingsIcon />}
            label="Settings"
          />
          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onOpenExport();
            }}
            icon={<ExportIcon />}
            label="Export"
          />

          <ActionMenuDivider />

          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onDownloadAnnotations();
            }}
            icon={<DownloadIcon />}
            label="Download Annotations"
          />
          <ActionMenuItem
            onClick={() => {
              closeMenu();
              onPrint();
            }}
            icon={<PrintIcon />}
            label="Print / Save as PDF"
            subtitle="Choose 'Save as PDF' in the print dialog"
          />
        </>
      )}
    </ActionMenu>
  );
};

const CompactActionSection = ({
  label,
  actions,
  closeMenu,
}: {
  label: string;
  actions: CompactPlanAction[];
  closeMenu: () => void;
}) => (
  <div className="py-1">
    <div className="px-3 py-1">
      <ActionMenuSectionLabel>{label}</ActionMenuSectionLabel>
    </div>
    {actions.map((action) => (
      <ActionMenuItem
        key={action.id}
        onClick={() => {
          closeMenu();
          action.onSelect();
        }}
        disabled={action.disabled}
        icon={<CompactPlanActionIcon kind={action.id} />}
        label={action.label}
        subtitle={action.subtitle}
      />
    ))}
  </div>
);

const CompactPlanActionIcon = ({ kind }: { kind: CompactPlanAction["id"] }) => {
  if (kind === "review") {
    return (
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 11l2 2 4-4m6 3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  }
  if (kind === "annotations") {
    return (
      <svg
        className="w-3.5 h-3.5"
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
    );
  }
  if (kind === "approve") {
    return (
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (kind === "feedback") {
    return (
      <svg
        className="w-3.5 h-3.5"
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
    );
  }
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
};

const MenuIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ExportIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
    />
  </svg>
);

const DownloadIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    />
  </svg>
);

const PrintIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
    />
  </svg>
);



