import { useEffect, useState } from "react";

/** What `GET /api/plan` tells the review app about its session. */
export interface Session {
  mode: "plan" | "annotate";
  markdown: string;
  title: string | null;
  filePath: string | null;
  previousPlan: string | null;
  versionInfo: VersionInfo | null;
  /** Plan review: bumps when the agent revises the plan; echoed on decisions. */
  planRevision: number | null;
}

interface PlanResponse {
  plan?: unknown;
  mode?: unknown;
  title?: unknown;
  filePath?: unknown;
  previousPlan?: unknown;
  versionInfo?: unknown;
  planRevision?: unknown;
}

export interface VersionInfo {
  version: number;
  totalVersions: number;
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function parseVersionInfo(value: unknown): VersionInfo | null {
  const info = value as Partial<VersionInfo> | null;
  if (!info || typeof info.version !== "number" || typeof info.totalVersions !== "number") {
    return null;
  }
  return { version: info.version, totalVersions: info.totalVersions };
}

export function parseSession(data: PlanResponse): Session {
  if (typeof data.plan !== "string") throw new Error("The session has no document.");
  return {
    mode: data.mode === "annotate" ? "annotate" : "plan",
    // The text is compared line by line (versions, anchors): one line ending.
    markdown: data.plan.replace(/\r\n?/g, "\n"),
    title: str(data.title),
    filePath: str(data.filePath),
    previousPlan: str(data.previousPlan),
    versionInfo: parseVersionInfo(data.versionInfo),
    planRevision:
      data.mode !== "annotate" && typeof data.planRevision === "number" ? data.planRevision : null,
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
