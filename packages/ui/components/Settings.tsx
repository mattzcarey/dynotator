import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { Origin } from "@dynotator/core/agents";
import { configStore, useConfigValue } from "../config";
import { DIAGRAM_SHADOW_OPTIONS } from "../utils/diagramShadow";
import { DEFAULT_DOCUMENT_TEXT_SIZE, DOCUMENT_TEXT_SIZE_OPTIONS } from "../utils/documentTextSize";
import { DOCUMENT_FONT_OPTIONS, documentFontStack } from "../utils/documentFont";
import { isFontInstalled } from "../utils/fontDetect";
import { MAX_FONT_FAMILY_LENGTH, normalizeFontFamilyName } from "../utils/cssFontFamily";
import {
  getIdentity,
  regenerateIdentity,
  setCustomIdentity,
  isIdentityEditable,
} from "../utils/identity";
import {
  getUIPreferences,
  saveUIPreferences,
  PLAN_WIDTH_OPTIONS,
  type UIPreferences,
  type PlanWidth,
} from "../utils/uiPreferences";
import {
  getPermissionModeSettings,
  savePermissionModeSettings,
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../utils/permissionMode";
import {
  getAutoCloseDelay,
  setAutoCloseDelay,
  AUTO_CLOSE_OPTIONS,
  type AutoCloseDelay,
} from "../utils/storage";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { modKeyWord } from "../utils/platform";
import { QuickLabelsTab } from "./settings/QuickLabelsTab";
import { OverlayScrollArea } from "./OverlayScrollArea";
import { requestVimDocumentFocus } from "../hooks/useVimDocumentFocus";

type SettingsTab = "general" | "display" | "labels" | "vim" | "shortcuts";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "display", label: "Display" },
  { id: "labels", label: "Labels" },
  { id: "vim", label: "Vim" },
  { id: "shortcuts", label: "Shortcuts" },
];

interface SettingsProps {
  onIdentityChange?: (oldIdentity: string, newIdentity: string) => void;
  origin?: Origin | null;
  mode?: "plan" | "annotate";
  onUIPreferencesChange?: (prefs: UIPreferences) => void;
  /** The host keeps its own copy: its Approve sends the mode. */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  externalOpen?: boolean;
  onExternalClose?: () => void;
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-11 w-11 shrink-0 items-center disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 top-2.5 h-6 rounded-full transition-colors ${
            checked ? "bg-primary" : "bg-muted"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute top-3.5 inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * The `plannotator` agent tool switch. The value is the one the NEXT session
 * uses (the tool list is part of the model's prompt, so a running session
 * never changes it). Writes go straight to POST /api/config and wait for the
 * answer, so a failed save is reported and the switch stays where it was.
 */
interface VimSettingsTabProps {
  readonly vimModeEnabled: boolean;
  readonly vimHudEnabled: boolean;
  readonly vimHudKeyPanelEnabled: boolean;
  readonly onVimModeChange: (enabled: boolean) => void;
  readonly onVimHudChange: (enabled: boolean) => void;
  readonly onVimHudKeyPanelChange: (enabled: boolean) => void;
}

/** First-class Vim configuration, separate from the shortcut reference. */
function VimSettingsTab({
  vimModeEnabled,
  vimHudEnabled,
  vimHudKeyPanelEnabled,
  onVimModeChange,
  onVimHudChange,
  onVimHudKeyPanelChange,
}: VimSettingsTabProps) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold">Vim mode</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Navigate, select, and annotate the rendered document without reaching for the mouse.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
        <ToggleSwitch
          checked={vimModeEnabled}
          onChange={onVimModeChange}
          label="Vim controls"
          description="Use Vim-style keys for document navigation and annotation. Off by default."
        />
        <div className="border-t border-border" />
        <ToggleSwitch
          checked={vimModeEnabled && vimHudEnabled}
          onChange={onVimHudChange}
          label="Vim HUD"
          description={
            vimModeEnabled
              ? "Show the four-corner target reticle and navigation context."
              : "Enable Vim controls first to use the target reticle."
          }
          disabled={!vimModeEnabled}
        />
        <div className="border-t border-border" />
        <ToggleSwitch
          checked={vimModeEnabled && vimHudEnabled && vimHudKeyPanelEnabled}
          onChange={onVimHudKeyPanelChange}
          label="Key panel"
          description={
            vimModeEnabled && vimHudEnabled
              ? "Show the bottom-right live keypress legend and command panel."
              : "Enable the Vim HUD first to use the live keypress legend."
          }
          disabled={!vimModeEnabled || !vimHudEnabled}
        />
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
            ?
          </span>
          <div>
            <div className="text-xs font-semibold">Learn while you navigate</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Vim takes focus automatically when the page is ready. From other app controls, press{" "}
              <span className="font-mono text-foreground">Esc</span> to return to the document, then
              use <span className="font-mono text-foreground">j</span> and{" "}
              <span className="font-mono text-foreground">k</span> to move by block. Press{" "}
              <span className="font-mono text-foreground">?</span> for the complete key map, even
              when the Key panel is hidden.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sentinel for the "Custom…" select option — never persisted as a font name. */
const CUSTOM_FONT_SENTINEL = "__custom__";

/** Inline style rendering a control in the chosen font (quoted and escaped: free text). */
function stackStyle(stack: string): React.CSSProperties | undefined {
  return stack ? { fontFamily: stack } : undefined;
}

/**
 * A font row (#851, shared by Code Font and Document font): a select of the
 * built-in choices plus "Custom…", which opens a field for the family name of
 * any font installed on this machine. The typed name is saved after a short
 * pause (configStore.set writes the cookie and may POST /api/config), flushed
 * on unmount, and dropped when a built-in is picked mid-pause.
 */
const FontFamilyField: React.FC<{
  label: string;
  description: string;
  value: string;
  onSave: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** The `font-family` the controls preview a value in. */
  previewStack: (value: string) => string;
  previewText: string;
  customAriaLabel: string;
  customPlaceholder: string;
  notFoundText: string;
  /** Load a built-in's web font for the preview, if it has one. */
  loadFont?: (value: string) => void;
  previewClassName?: string;
}> = ({
  label,
  description,
  value,
  onSave,
  options,
  previewStack,
  previewText,
  customAriaLabel,
  customPlaceholder,
  notFoundText,
  loadFont,
  previewClassName = "",
}) => {
  const isBuiltIn = (v: string) => options.some((opt) => opt.value === v);
  // Custom font: progressive disclosure. customFontMode keeps the input open
  // while the user picks "Custom…" or has a non-built-in font saved.
  const [customFontMode, setCustomFontMode] = useState(() => !!value && !isBuiltIn(value));
  const [customFontDraft, setCustomFontDraft] = useState(() =>
    value && !isBuiltIn(value) ? value : "",
  );
  const customFontSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Pending debounced value. Non-null means "typed but not yet saved" — it is
  // flushed (not discarded) on unmount, and cancelled when a built-in is
  // picked so a stale timer can't overwrite the new selection.
  const pendingFontSave = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const customActive = customFontMode || (!!value && !isBuiltIn(value));
  // Width-measurement check — deterministic per machine, no permissions.
  const customFontInstalled = useMemo(
    () => (normalizeFontFamilyName(customFontDraft) ? isFontInstalled(customFontDraft) : null),
    [customFontDraft],
  );

  // Load font for the preview swatch
  useEffect(() => {
    if (value) loadFont?.(value);
  }, [value, loadFont]);

  // Adopt external changes (late server hydration, edits from elsewhere) into
  // the draft — but never clobber typing that hasn't been saved yet.
  useEffect(() => {
    if (pendingFontSave.current !== null) return;
    if (value && !isBuiltIn(value) && value !== normalizeFontFamilyName(customFontDraft)) {
      setCustomFontDraft(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const cancelPendingFontSave = () => {
    clearTimeout(customFontSaveTimer.current);
    pendingFontSave.current = null;
  };

  // Flush a pending save on unmount so closing the panel mid-debounce
  // doesn't lose the typed font.
  useEffect(
    () => () => {
      clearTimeout(customFontSaveTimer.current);
      if (pendingFontSave.current !== null) {
        onSaveRef.current(pendingFontSave.current);
      }
    },
    [],
  );

  const handleCustomFontInput = (next: string) => {
    setCustomFontDraft(next);
    // Debounce the save — per-keystroke writes would spam the cookie and
    // /api/config.
    clearTimeout(customFontSaveTimer.current);
    pendingFontSave.current = normalizeFontFamilyName(next);
    customFontSaveTimer.current = setTimeout(() => {
      if (pendingFontSave.current !== null) {
        onSaveRef.current(pendingFontSave.current);
        pendingFontSave.current = null;
      }
    }, 400);
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <select
        value={customActive ? CUSTOM_FONT_SENTINEL : value}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === CUSTOM_FONT_SENTINEL) {
            setCustomFontMode(true);
          } else {
            // Cancel any in-flight debounced custom save so a stale timer
            // can't overwrite this selection.
            cancelPendingFontSave();
            setCustomFontMode(false);
            setCustomFontDraft("");
            onSave(e.target.value);
          }
        }}
        className="w-full px-3 py-1.5 text-sm rounded-md bg-muted/50 border border-border text-foreground"
        style={value && !customActive ? stackStyle(previewStack(value)) : undefined}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        <option value={CUSTOM_FONT_SENTINEL}>Custom…</option>
      </select>
      {customActive && (
        <div className="space-y-1">
          <input
            type="text"
            value={customFontDraft}
            onChange={(e) => handleCustomFontInput(e.target.value)}
            placeholder={customPlaceholder}
            aria-label={customAriaLabel}
            maxLength={MAX_FONT_FAMILY_LENGTH}
            autoFocus={!customFontDraft}
            spellCheck={false}
            className="w-full px-3 py-1.5 text-sm rounded-md bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            style={stackStyle(previewStack(customFontDraft))}
          />
          <div className="text-[11px]" aria-live="polite">
            {!normalizeFontFamilyName(customFontDraft) ? (
              <span className="text-muted-foreground">
                Any font installed on this machine works — type its family name.
              </span>
            ) : customFontInstalled === true ? (
              <span className="text-success">✓ Found on this machine</span>
            ) : customFontInstalled === false ? (
              <span className="text-warning">{notFoundText}</span>
            ) : null}
          </div>
        </div>
      )}
      {value && (
        <div
          className={`text-xs text-muted-foreground px-1 py-1 rounded bg-muted/30 ${previewClassName}`}
          style={stackStyle(previewStack(value))}
        >
          {previewText}
        </div>
      )}
    </div>
  );
};

/**
 * Experimental (the owner, 2026-10-27: "its own page on settings", the last
 * tab): each experimental setting, off by default. Today one, code review's
 * Edit Code to Suggest (`editSuggestions`, the
 * `plannotator-experimental-edit-suggestions` cookie, unchanged).
 */
export const Settings: React.FC<SettingsProps> = ({
  onIdentityChange,
  origin,
  mode = "plan",
  onUIPreferencesChange,
  onPermissionModeChange,
  externalOpen,
  onExternalClose,
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const settingsWasOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = settingsWasOpenRef.current;
    settingsWasOpenRef.current = showDialog;
    if (wasOpen && !showDialog && configStore.get("vimModeEnabled")) requestVimDocumentFocus();
  }, [showDialog]);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const gridEnabled = useConfigValue("gridEnabled");
  const diagramShadow = useConfigValue("diagramShadow");
  const documentTextSize = useConfigValue("documentTextSize");
  const documentFontFamily = useConfigValue("documentFontFamily");
  const vimModeEnabled = useConfigValue("vimModeEnabled");
  const enterSavesComment = useConfigValue("enterSavesComment");
  const vimHudEnabled = useConfigValue("vimHudEnabled");
  const vimHudKeyPanelEnabled = useConfigValue("vimHudKeyPanelEnabled");
  const [identity, setIdentity] = useState("");
  const [uiPrefs, setUiPrefs] = useState<UIPreferences>({
    tocEnabled: true,
    stickyActionsEnabled: true,
    planWidth: "compact",
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("bypassPermissions");
  const [autoCloseDelay, setAutoCloseDelayState] = useState<AutoCloseDelay>("off");

  useEffect(() => {
    if (externalOpen) {
      setShowDialog(true);
      onExternalClose?.();
    }
  }, [externalOpen, onExternalClose]);

  useEffect(() => {
    if (!showDialog) return;
    setIdentity(getIdentity());
    setUiPrefs(getUIPreferences());
    setPermissionMode(getPermissionModeSettings().mode);
    setAutoCloseDelayState(getAutoCloseDelay());
  }, [showDialog]);

  const handleUIPrefsChange = (updates: Partial<UIPreferences>) => {
    const newPrefs = { ...uiPrefs, ...updates };
    setUiPrefs(newPrefs);
    saveUIPreferences(newPrefs);
    onUIPreferencesChange?.(newPrefs);
  };

  const handlePermissionModeChange = (next: PermissionMode) => {
    setPermissionMode(next);
    savePermissionModeSettings(next);
    onPermissionModeChange?.(next);
  };

  const handleRegenerateIdentity = () => {
    const oldIdentity = identity;
    const newIdentity = regenerateIdentity();
    setIdentity(newIdentity);
    onIdentityChange?.(oldIdentity, newIdentity);
  };

  const handleIdentitySave = (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === identity) return;
    const oldIdentity = identity;
    const saved = setCustomIdentity(trimmed);
    setIdentity(saved);
    onIdentityChange?.(oldIdentity, saved);
  };

  const identityEditable = isIdentityEditable();

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Settings"
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {showDialog &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
            onClick={() => setShowDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="plannotator-settings-title"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented) return;
                event.preventDefault();
                event.stopPropagation();
                setShowDialog(false);
              }}
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 id="plannotator-settings-title" className="font-semibold text-sm">
                  Settings
                </h3>
                <button
                  type="button"
                  aria-label="Close settings"
                  onClick={() => setShowDialog(false)}
                  className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col md:flex-row md:min-h-[420px] flex-1 min-h-0 overflow-hidden">
                {/* Mobile: horizontal tab bar */}
                <nav className="md:hidden flex overflow-x-auto border-b border-border px-2 py-1.5 gap-1 flex-shrink-0">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                        activeTab === tab.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                {/* Desktop: sidebar */}
                <nav className="hidden md:block w-40 border-r border-border p-2 flex-shrink-0">
                  <div className="space-y-0.5">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
                          activeTab === tab.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </nav>

                {/* Content — scrollable */}
                <OverlayScrollArea className="flex-1 min-h-0">
                  <div className="p-4 space-y-4">
                    {activeTab === "general" && (
                      <>
                        {/* Identity */}
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Your Identity</div>
                          <div className="text-xs text-muted-foreground">
                            Used when sharing annotations with others
                          </div>
                          <div className="flex items-center gap-2">
                            {identityEditable ? (
                              <input
                                key={identity}
                                type="text"
                                defaultValue={identity}
                                onBlur={(e) => handleIdentitySave(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleIdentitySave((e.target as HTMLInputElement).value);
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="flex-1 px-3 py-2 bg-muted rounded-lg text-xs font-mono truncate border border-transparent focus:border-primary/50 focus:outline-none transition-colors"
                                placeholder="Enter your name..."
                              />
                            ) : (
                              <div className="flex-1 px-3 py-2 bg-muted rounded-lg text-xs font-mono truncate border border-transparent">
                                {identity}
                              </div>
                            )}
                            {identityEditable && (
                              <button
                                onClick={handleRegenerateIdentity}
                                onMouseDown={(e) => e.preventDefault()}
                                className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                title="Regenerate random identity"
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
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="border-t border-border" />
                        <div data-enter-saves-comment-setting="true">
                          <ToggleSwitch
                            checked={enterSavesComment}
                            onChange={(v) => configStore.set("enterSavesComment", v)}
                            label="Enter saves a comment"
                            description={`Shift+Enter adds a new line. ${modKeyWord}+Enter still saves.`}
                          />
                        </div>

                        {/* Permission Mode (Claude Code only) */}
                        {origin === "claude-code" && mode === "plan" && (
                          <>
                            <div className="border-t border-border" />
                            <div className="space-y-2">
                              <div>
                                <div className="text-sm font-medium">Permission Mode</div>
                                <div className="text-xs text-muted-foreground">
                                  Automation level after plan approval
                                </div>
                              </div>
                              <select
                                value={permissionMode}
                                onChange={(e) =>
                                  handlePermissionModeChange(e.target.value as PermissionMode)
                                }
                                className="w-full px-3 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                              >
                                {PERMISSION_MODE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <div className="text-[10px] text-muted-foreground/70">
                                {
                                  PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode)
                                    ?.description
                                }
                              </div>
                            </div>
                          </>
                        )}

                        {/* Auto-close Tab */}
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Auto-close Tab</div>
                          <select
                            value={autoCloseDelay}
                            onChange={(e) => {
                              const next = e.target.value as AutoCloseDelay;
                              setAutoCloseDelayState(next);
                              setAutoCloseDelay(next);
                            }}
                            className="w-full px-3 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                          >
                            {AUTO_CLOSE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div className="text-[10px] text-muted-foreground/70">
                            {
                              AUTO_CLOSE_OPTIONS.find((o) => o.value === autoCloseDelay)
                                ?.description
                            }
                          </div>
                        </div>
                      </>
                    )}

                    {activeTab === "display" && (
                      <>
                        {/* Text size (#2066): the document only, not the app around it */}
                        {
                          <>
                            <div className="space-y-3" data-document-text-size-setting>
                              <div>
                                <div className="text-sm font-medium" id="document-text-size-label">
                                  Text size
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {mode === "annotate"
                                    ? "Body text of the document"
                                    : "Body text of the plan"}
                                  , in px ({DEFAULT_DOCUMENT_TEXT_SIZE} is the default)
                                </div>
                              </div>
                              <div
                                className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5"
                                role="group"
                                aria-labelledby="document-text-size-label"
                              >
                                {DOCUMENT_TEXT_SIZE_OPTIONS.map((value) => (
                                  <button
                                    key={value}
                                    onClick={() => configStore.set("documentTextSize", value)}
                                    aria-pressed={documentTextSize === value}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors tabular-nums ${
                                      documentTextSize === value
                                        ? "bg-background text-foreground shadow-sm font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="border-t border-border" />
                          </>
                        }

                        {/* Document font (#1657): the document only; code keeps its font */}
                        {
                          <>
                            <div data-document-font-setting>
                              <FontFamilyField
                                label="Document font"
                                description={`${mode === "annotate" ? "Text of the document" : "Text of the plan"}; code keeps its monospace font`}
                                value={documentFontFamily}
                                onSave={(v) => configStore.set("documentFontFamily", v)}
                                options={DOCUMENT_FONT_OPTIONS}
                                previewStack={documentFontStack}
                                previewText="Preview: The quick brown fox jumps over the lazy dog."
                                customAriaLabel="Custom document font name"
                                customPlaceholder="Font name as installed, e.g. Iowan Old Style"
                                notFoundText="Not found — the document keeps the theme font"
                              />
                            </div>

                            <div className="border-t border-border" />
                          </>
                        }

                        {/* Auto-open Sidebar */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Auto-open Sidebar</div>
                            <div className="text-xs text-muted-foreground">
                              Open sidebar with Table of Contents on load
                            </div>
                          </div>
                          <button
                            role="switch"
                            aria-checked={uiPrefs.tocEnabled}
                            onClick={() => handleUIPrefsChange({ tocEnabled: !uiPrefs.tocEnabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              uiPrefs.tocEnabled ? "bg-primary" : "bg-muted"
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                uiPrefs.tocEnabled ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="border-t border-border" />

                        {/* Sticky Actions */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Sticky Actions</div>
                            <div className="text-xs text-muted-foreground">
                              Keep action buttons visible while scrolling
                            </div>
                          </div>
                          <button
                            role="switch"
                            aria-checked={uiPrefs.stickyActionsEnabled}
                            onClick={() =>
                              handleUIPrefsChange({
                                stickyActionsEnabled: !uiPrefs.stickyActionsEnabled,
                              })
                            }
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              uiPrefs.stickyActionsEnabled ? "bg-primary" : "bg-muted"
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                uiPrefs.stickyActionsEnabled ? "translate-x-6" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="border-t border-border" />

                        {/* Grid Background */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Grid Background</div>
                            <div className="text-xs text-muted-foreground">
                              Show the plan as a floating card on a grid
                            </div>
                          </div>
                          <button
                            role="switch"
                            aria-checked={gridEnabled}
                            aria-label="Grid Background"
                            onClick={() => {
                              configStore.set("gridEnabled", !gridEnabled);
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${gridEnabled ? "bg-primary" : "bg-muted"}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${gridEnabled ? "translate-x-6" : "translate-x-1"}`}
                            />
                          </button>
                        </div>

                        <div className="border-t border-border" />

                        {/* Diagram Shadow */}
                        <div className="space-y-3" data-diagram-shadow-setting>
                          <div>
                            <div className="text-sm font-medium">Diagram Shadow</div>
                            <div className="text-xs text-muted-foreground">
                              Drop shadow under diagram nodes (100 = Mermaid's own)
                            </div>
                          </div>
                          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                            {DIAGRAM_SHADOW_OPTIONS.map((value) => (
                              <button
                                key={value}
                                onClick={() => configStore.set("diagramShadow", value)}
                                aria-pressed={diagramShadow === value}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                                  diagramShadow === value
                                    ? "bg-background text-foreground shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {value === 0 ? "None" : String(value)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-border" />

                        {/* Plan Width */}
                        <div className="space-y-3">
                          <div>
                            <div className="text-sm font-medium flex items-center gap-2">
                              {mode === "annotate" ? "Document Width" : "Plan Width"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {mode === "annotate"
                                ? "Maximum width of the document card"
                                : "Maximum width of the plan card"}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                            {PLAN_WIDTH_OPTIONS.map((opt) => (
                              <button
                                key={opt.id}
                                onClick={() => handleUIPrefsChange({ planWidth: opt.id })}
                                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                                  uiPrefs.planWidth === opt.id
                                    ? "bg-background text-foreground shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          {/* Abstract layout preview — exaggerated proportions for visual clarity */}
                          {(() => {
                            const active =
                              PLAN_WIDTH_OPTIONS.find((o) => o.id === uiPrefs.planWidth) ??
                              PLAN_WIDTH_OPTIONS[0];
                            // Exaggerated proportions so the width difference is visually obvious in the small preview
                            const sidebarPct = 14;
                            const panelPct = 14;
                            const cardPctMap: Record<PlanWidth, number> = {
                              compact: 48,
                              default: 70,
                              wide: 94,
                            };
                            const cardPct = cardPctMap[active.id];
                            return (
                              <div className="space-y-2">
                                <div className="rounded-lg border border-border/40 bg-muted/20 px-2 py-3 overflow-hidden">
                                  {/* Simulated header bar */}
                                  <div className="flex items-center justify-between mb-2 px-1">
                                    <div className="h-0.5 w-8 rounded-full bg-foreground/15" />
                                    <div className="flex gap-1">
                                      <div className="h-1 w-1 rounded-full bg-foreground/15" />
                                      <div className="h-1 w-1 rounded-full bg-foreground/15" />
                                      <div className="h-1 w-1 rounded-full bg-foreground/15" />
                                    </div>
                                  </div>
                                  <div className="border-t border-foreground/5 mb-2" />
                                  {/* Three-column layout */}
                                  <div
                                    className="flex gap-1 items-stretch"
                                    style={{ minHeight: 64 }}
                                  >
                                    {/* Sidebar */}
                                    <div
                                      className="flex-shrink-0 space-y-1 pt-0.5 opacity-30"
                                      style={{ width: `${sidebarPct}%` }}
                                    >
                                      <div className="h-0.5 w-full rounded-full bg-foreground" />
                                      <div className="h-0.5 w-3/4 rounded-full bg-foreground" />
                                      <div className="h-0.5 w-1/2 rounded-full bg-foreground" />
                                      <div className="h-0.5 w-2/3 rounded-full bg-foreground" />
                                      <div className="h-0.5 w-1/2 rounded-full bg-foreground" />
                                    </div>
                                    {/* Plan card — width animates */}
                                    <div className="flex-1 flex justify-center min-w-0">
                                      <div
                                        className="rounded border border-border/60 bg-card/50 p-1.5 space-y-1 transition-all duration-300 ease-out"
                                        style={{ width: `${cardPct}%`, minWidth: 0 }}
                                      >
                                        {/* Heading */}
                                        <div className="h-1 w-2/5 rounded-full bg-foreground/25" />
                                        {/* Prose lines */}
                                        <div className="space-y-[2px]">
                                          <div className="h-[2px] w-full rounded-full bg-foreground/10" />
                                          <div className="h-[2px] w-11/12 rounded-full bg-foreground/10" />
                                          <div className="h-[2px] w-4/5 rounded-full bg-foreground/10" />
                                        </div>
                                        {/* Code block */}
                                        <div className="rounded bg-muted/60 p-1 space-y-[2px]">
                                          <div className="h-[2px] w-full rounded-full bg-primary/20" />
                                          <div className="h-[2px] w-3/4 rounded-full bg-primary/20" />
                                          <div className="h-[2px] w-5/6 rounded-full bg-primary/20" />
                                        </div>
                                        {/* More prose */}
                                        <div className="space-y-[2px]">
                                          <div className="h-[2px] w-full rounded-full bg-foreground/10" />
                                          <div className="h-[2px] w-3/4 rounded-full bg-foreground/10" />
                                        </div>
                                      </div>
                                    </div>
                                    {/* Annotation panel */}
                                    <div
                                      className="flex-shrink-0 space-y-1 pt-0.5 opacity-20"
                                      style={{ width: `${panelPct}%` }}
                                    >
                                      <div className="rounded border border-foreground/20 p-0.5 space-y-[2px]">
                                        <div className="h-[2px] w-full rounded-full bg-foreground" />
                                        <div className="h-[2px] w-2/3 rounded-full bg-foreground" />
                                      </div>
                                      <div className="rounded border border-foreground/20 p-0.5 space-y-[2px]">
                                        <div className="h-[2px] w-full rounded-full bg-foreground" />
                                        <div className="h-[2px] w-1/2 rounded-full bg-foreground" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-[10px] text-muted-foreground/70 leading-snug">
                                  {active.px}px — {active.hint}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </>
                    )}

                    {/* === LABELS TAB === */}
                    {activeTab === "labels" && <QuickLabelsTab />}

                    {/* === VIM TAB === */}
                    {activeTab === "vim" && (
                      <VimSettingsTab
                        vimModeEnabled={vimModeEnabled}
                        vimHudEnabled={vimHudEnabled}
                        vimHudKeyPanelEnabled={vimHudKeyPanelEnabled}
                        onVimModeChange={(enabled) => configStore.set("vimModeEnabled", enabled)}
                        onVimHudChange={(enabled) => configStore.set("vimHudEnabled", enabled)}
                        onVimHudKeyPanelChange={(enabled) =>
                          configStore.set("vimHudKeyPanelEnabled", enabled)
                        }
                      />
                    )}

                    {/* === SHORTCUTS TAB === */}
                    {activeTab === "shortcuts" && (
                      <KeyboardShortcuts mode={mode} vimModeEnabled={vimModeEnabled} />
                    )}
                  </div>
                </OverlayScrollArea>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
