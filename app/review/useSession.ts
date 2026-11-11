import { useEffect, useState } from "react";
import { api } from "../api";
import type { FileEntry } from "../files/tree";
import { parseEvents, type ReviewEvent } from "./events";

export interface VersionEntry {
  version: number;
  timestamp: string;
}

/** `GET /api/review`. */
interface ReviewResponse {
  title?: string;
  open: string;
  version: number;
  versions: VersionEntry[];
  base: boolean;
}

export interface Session {
  title: string | null;
  /** The file to show first. */
  open: string;
  /** The version on screen, echoed on submissions so a stale one is refused. */
  version: number;
  versions: VersionEntry[];
  /** Version 0 holds the state before the change: the page opens on the changes. */
  base: boolean;
  /** The files of this version, sorted by path. */
  files: FileEntry[];
  /** The log as of loading. */
  events: ReviewEvent[];
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
  const [review, events] = await Promise.all([
    getJson<ReviewResponse>("/api/review"),
    getJson<unknown>("/api/events?after=0").then(parseEvents),
  ]);
  // The list of the version just read, not of one a revision put up in between.
  const { files } = await getJson<{ files: FileEntry[] }>(`/api/files?v=${review.version}`);
  const open = files.some((f) => f.path === review.open) ? review.open : (files[0]?.path ?? "");
  return {
    title: review.title || null,
    open,
    version: review.version,
    versions: review.versions,
    base: review.base,
    files,
    events,
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
