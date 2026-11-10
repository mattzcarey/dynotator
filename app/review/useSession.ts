import { useEffect, useState } from "react";
import { api } from "../api";
import type { FileEntry } from "../files/tree";

export interface VersionEntry {
  version: number;
  timestamp: string;
}

/** `GET /api/review`. */
interface ReviewResponse {
  mode: "plan" | "annotate";
  title?: string;
  open: string;
  version: number;
  versions: VersionEntry[];
}

export interface Session {
  mode: "plan" | "annotate";
  title: string | null;
  /** The file to show first. */
  open: string;
  /** The version on screen, echoed on decisions so a stale one is refused. */
  version: number;
  versions: VersionEntry[];
  /** The files of this version, sorted by path. */
  files: FileEntry[];
}

type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "error"; message: string };

async function getJson<T>(path: `/api/${string}`): Promise<T> {
  const res = await fetch(api(path));
  if (res.status === 404) throw new Error("This review session does not exist or expired.");
  if (!res.ok) throw new Error(`Could not load the review (${res.status}).`);
  return (await res.json()) as T;
}

async function loadSession(): Promise<Session> {
  const review = await getJson<ReviewResponse>("/api/review");
  // The list of the version just read, not of one a revision put up in between.
  const { files } = await getJson<{ files: FileEntry[] }>(`/api/files?v=${review.version}`);
  const open = files.some((f) => f.path === review.open) ? review.open : (files[0]?.path ?? "");
  return {
    mode: review.mode,
    title: review.title || null,
    open,
    version: review.version,
    versions: review.versions,
    files,
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
