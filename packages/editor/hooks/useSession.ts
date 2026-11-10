import { useEffect, useState } from "react";
import type { Origin } from "@dynotator/shared/agents";
import type { VersionInfo } from "@dynotator/ui/hooks/usePlanDiff";

/** What `GET /api/plan` tells the review app about its session. */
export interface Session {
  mode: "plan" | "annotate";
  markdown: string;
  origin: Origin | null;
  title: string | null;
  filePath: string | null;
  previousPlan: string | null;
  versionInfo: VersionInfo | null;
  /** The approval body carries the reviewer's notes to the agent. */
  approvalNotesSupported: boolean;
}

interface PlanResponse {
  plan?: unknown;
  mode?: unknown;
  origin?: unknown;
  title?: unknown;
  filePath?: unknown;
  previousPlan?: unknown;
  versionInfo?: unknown;
  approvalNotesSupported?: unknown;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

function parseVersionInfo(value: unknown): VersionInfo | null {
  const info = value as Partial<VersionInfo> | null;
  if (!info || typeof info.version !== "number" || typeof info.totalVersions !== "number") {
    return null;
  }
  return { version: info.version, totalVersions: info.totalVersions, project: info.project ?? "" };
}

export function parseSession(data: PlanResponse): Session {
  if (typeof data.plan !== "string") throw new Error("The session has no document.");
  return {
    mode: data.mode === "annotate" ? "annotate" : "plan",
    // The text is compared line by line (versions, anchors): one line ending.
    markdown: data.plan.replace(/\r\n?/g, "\n"),
    origin: (str(data.origin) as Origin | null) ?? null,
    title: str(data.title),
    filePath: str(data.filePath),
    previousPlan: str(data.previousPlan),
    versionInfo: parseVersionInfo(data.versionInfo),
    approvalNotesSupported: data.approvalNotesSupported === true,
  };
}

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "error"; message: string };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plan")
      .then(async (res) => {
        if (res.status === 404) throw new Error("This review session does not exist or expired.");
        if (!res.ok) throw new Error(`Could not load the review (${res.status}).`);
        return parseSession((await res.json()) as PlanResponse);
      })
      .then(
        (session) => !cancelled && setState({ status: "ready", session }),
        (error: unknown) =>
          !cancelled &&
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load the review.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
