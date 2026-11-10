import { WorkerEntrypoint } from "cloudflare:workers";
import type { Decision, Revision } from "../session/decision";
import { parseMarkdown, parseSessionInit, type SessionInit } from "../session/plan";
import { isSessionId, newSessionId, ttlSeconds } from "./routes";

export type { Decision, Revision, SessionInit };

export interface Review {
  id: string;
  /** Where a human reviews it. Send this to the reviewer. */
  url: string;
}

/**
 * The API other Workers and agents call through a service binding to this entrypoint. Nothing
 * here is reachable over HTTP: the binding is the authorisation.
 */
export class Dynotator extends WorkerEntrypoint<Env> {
  /** Opens a review of `markdown` and returns the URL to hand to a human. */
  async createReview(init: SessionInit): Promise<Review> {
    const session = parseSessionInit(init);
    const id = newSessionId();
    await this.supervisor(id).create(session, ttlSeconds(this.env.SESSION_TTL_SECONDS));
    return { id, url: `${this.env.PUBLIC_URL.replace(/\/+$/, "")}/s/${id}` };
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

  /** Puts a revised document up for review in the same session, so the reviewer sees the diff. */
  async revise(id: string, markdown: string): Promise<Revision> {
    return this.session(id).revise(parseMarkdown(markdown));
  }

  private supervisor(id: string) {
    return this.ctx.exports.SessionSupervisor.getByName(id);
  }

  private session(id: string) {
    if (!isSessionId(id)) throw new Error("This review does not exist or has expired");
    return this.supervisor(id);
  }
}
