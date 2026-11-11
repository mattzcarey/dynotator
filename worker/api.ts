import { WorkerEntrypoint } from "cloudflare:workers";
import type { Annotation, ReviewEvent, Revision } from "../session/events";
import { type Files, type ReviewInit, parseFiles, parseInit } from "../session/files";
import { isSessionId, newSessionId, ttlSeconds } from "./routes";

export type { Annotation, Files, ReviewEvent, ReviewInit, Revision };

export interface Review {
  id: string;
  /** Where a human reviews it. Send this to the reviewer. */
  url: string;
}

/**
 * Set by whoever creates the binding, never by the caller of a method: a Worker that embeds
 * Dynotator passes the origin its reviewers reach it at when it calls its own entrypoint
 * (`ctx.exports.Dynotator({ props: { origin } })`). Without it, review URLs start with
 * `PUBLIC_URL`.
 */
export interface DynotatorProps {
  origin?: string;
}

/**
 * The API other Workers and agents call through a service binding to this entrypoint. Nothing
 * here is reachable over HTTP: the binding is the authorisation.
 */
export class Dynotator extends WorkerEntrypoint<Env, DynotatorProps> {
  /**
   * Opens a review of `files` and returns the URL to hand to a human. With `patch`, the diff
   * that produced `files`, the review is of that change; a patch that does not apply in reverse
   * fails the call and leaves no review behind.
   */
  async createReview(init: ReviewInit): Promise<Review> {
    const review = parseInit(init);
    const id = newSessionId();
    await this.supervisor(id).create(review, ttlSeconds(this.env.SESSION_TTL_SECONDS));
    const origin = (this.ctx.props?.origin ?? this.env.PUBLIC_URL).replace(/\/+$/, "");
    return { id, url: `${origin}/s/${id}` };
  }

  /**
   * Puts `files`, a full snapshot, up as the next version at the same URL and appends `revised`;
   * files absent from it are deleted in that version. Allowed until the review is closed. An
   * identical snapshot is `unchanged` and appends nothing.
   */
  async revise(id: string, files: Files): Promise<Revision> {
    return this.session(id).revise(parseFiles(files));
  }

  /**
   * Events with `seq > after`, in order. With `wait` (seconds, at most 55) and none yet, holds
   * the call until there is one; `[]` means the time ran out. Keep a cursor: call, process, set it
   * to the last `seq`. A very long log may arrive over several calls.
   */
  async getEvents(id: string, after = 0, wait = 0): Promise<ReviewEvent[]> {
    return this.session(id).events(after, wait);
  }

  /** Ends the review: `closed` is appended once, and nothing more is accepted. Reads still work. */
  async close(id: string): Promise<void> {
    await this.session(id).close();
  }

  private supervisor(id: string) {
    return this.ctx.exports.SessionSupervisor.getByName(id);
  }

  private session(id: string) {
    if (!isSessionId(id)) throw new Error("This review does not exist or has expired");
    return this.supervisor(id);
  }
}
