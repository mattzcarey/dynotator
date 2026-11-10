import { useEffect, useState } from "react";
import { api } from "../api";

/** `GET /api/plan`. */
interface PlanResponse {
  plan: string;
  mode: "plan" | "annotate";
  title?: string;
  previousPlan: string | null;
  versionInfo: { version: number; totalVersions: number };
  /** Plan mode: the version on screen, echoed on decisions so a stale one is refused. */
  planRevision?: number;
}

export interface Session {
  mode: "plan" | "annotate";
  markdown: string;
  title: string | null;
  previousPlan: string | null;
  version: number;
  totalVersions: number;
  planRevision: number | null;
}

type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "error"; message: string };

async function loadSession(): Promise<Session> {
  const res = await fetch(api("/api/plan"));
  if (res.status === 404) throw new Error("This review session does not exist or expired.");
  if (!res.ok) throw new Error(`Could not load the review (${res.status}).`);
  const data = (await res.json()) as PlanResponse;
  return {
    mode: data.mode,
    // Versions and anchors compare text line by line: one line ending.
    markdown: data.plan.replace(/\r\n?/g, "\n"),
    title: data.title || null,
    previousPlan: data.previousPlan,
    version: data.versionInfo.version,
    totalVersions: data.versionInfo.totalVersions,
    planRevision: data.planRevision ?? null,
  };
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadSession().then(
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
