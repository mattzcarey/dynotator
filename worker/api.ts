import { WorkerEntrypoint } from "cloudflare:workers";
import type { Decision, Revision } from "../session/decision";
import { type Files, type ReviewInit, parseFiles, parseInit } from "../session/files";
import { isSessionId, newSessionId, ttlSeconds } from "./routes";

export type { Decision, Files, Revision, ReviewInit };

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
   * Opens a review of `files` and returns the URL to hand to a human. `mode` is `"plan"`
   * (approve or request changes) or `"annotate"` (send feedback or close).
   */
  async createReview(init: ReviewInit): Promise<Review> {
    const review = parseInit(init);
    const id = newSessionId();
    await this.supervisor(id).create(review, ttlSeconds(this.env.SESSION_TTL_SECONDS));
    const origin = (this.ctx.props?.origin ?? this.env.PUBLIC_URL).replace(/\/+$/, "");
    return { id, url: `${origin}/s/${id}` };
  }

  /** The decision, or `null` while the review is open. Throws if the review has expired. */
  async getDecision(id: string): Promise<Decision | null> {
    return this.session(id).decision();
  }

  /**
   * Waits up to `seconds` (default 25, at most 55) for the decision; `null` means still open.
   * Call it again to keep waiting, or poll `getDecision` from an alarm instead.
   */
  async waitForDecision(id: string, seconds?: number): Promise<Decision | null> {
    return this.session(id).wait(seconds);
  }

  /**
   * Puts `files`, a full snapshot, up as the next version at the same URL, so the reviewer sees
   * what changed, and reopens the decision. Files absent from the snapshot are deleted in that
   * version. An identical snapshot is `unchanged` and leaves the decision standing. Throws once
   * the review has been approved or closed.
   */
  async revise(id: string, files: Files): Promise<Revision> {
    return this.session(id).revise(parseFiles(files));
  }

  private supervisor(id: string) {
    return this.ctx.exports.SessionSupervisor.getByName(id);
  }

  private session(id: string) {
    if (!isSessionId(id)) throw new Error("This review does not exist or has expired");
    return this.supervisor(id);
  }
}
