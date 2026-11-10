import React from "react";
import { ActionMenuDivider } from "./ActionMenu";

/**
 * Claude Code: the permission mode Approve already sends, made visible. Read
 * only; "Change" opens Settings, where the mode is set.
 */
export const PermissionModeMenuLine: React.FC<{
  agentName: string;
  modeLabel: string;
  onChange: () => void;
}> = ({ agentName, modeLabel, onChange }) => (
  <>
    <ActionMenuDivider />
    <div
      data-permission-mode-line="true"
      className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10px] text-muted-foreground"
    >
      <span>
        After approval, {agentName} runs in{" "}
        <span className="font-medium text-foreground">{modeLabel}</span>
      </span>
      <button
        type="button"
        role="menuitem"
        onClick={onChange}
        data-permission-mode-change="true"
        aria-label={`Change the permission mode (${modeLabel}) in Settings`}
        className="rounded px-1 py-0.5 text-[10px] text-primary outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/60"
      >
        Change
      </button>
    </div>
  </>
);
