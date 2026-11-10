/**
 * DocBadges: the plan-diff badge, drawn at the top-left of the plan card
 * (`column`), in the sticky header lane (`row`) or in Viewer's in-flow header.
 */

import React from "react";
import { PlanDiffBadge } from "./plan-diff/PlanDiffBadge";
import type { PlanDiffStats } from "../utils/planDiffEngine";

export interface DocBadgesProps {
  layout: "column" | "row" | "header";
  planDiffStats?: PlanDiffStats | null;
  isPlanDiffActive?: boolean;
  hasPreviousVersion?: boolean;
  onPlanDiffToggle?: () => void;
  planDiffBaselineLabel?: string;
  planDiffBaselineTooltip?: string;
}

export const DocBadges: React.FC<DocBadgesProps> = ({
  layout,
  planDiffStats,
  isPlanDiffActive,
  hasPreviousVersion,
  onPlanDiffToggle,
  planDiffBaselineLabel,
  planDiffBaselineTooltip,
}) => {
  const isHorizontal = layout !== "column";
  if (!hasPreviousVersion || (layout === "row" && !planDiffStats)) return null;

  // Row layout: single horizontal line. Column layout: stacked rows.
  const outerClass = isHorizontal
    ? `flex flex-row items-center gap-1.5 text-[9px] text-muted-foreground/70 font-mono ${layout === "header" ? "flex-wrap" : ""}`
    : "flex flex-col items-start gap-1 text-[9px] text-muted-foreground/50 font-mono";

  return (
    <div className={outerClass}>
      {onPlanDiffToggle && (
        <PlanDiffBadge
          stats={planDiffStats ?? null}
          isActive={isPlanDiffActive ?? false}
          onToggle={onPlanDiffToggle}
          hasPreviousVersion={hasPreviousVersion ?? false}
          baselineLabel={planDiffBaselineLabel}
          baselineTooltip={planDiffBaselineTooltip}
        />
      )}
    </div>
  );
};
