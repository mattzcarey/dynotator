import { WorkerEntrypoint } from "cloudflare:workers";
import type { Annotation, ReviewEvent, ReviewEventType, Revision } from "../session/events";
import type { Files } from "../session/files";
import {
  type Content,
  type FileSource,
  type ReviewInit,
  parseContent,
  parseInit,
  upload,
  uploadBase,
} from "./content";
import { isSessionId, newSessionId, ttlSeconds } from "./routes";

export type {
  Annotation,
  Content,
  FileSource,
  Files,
  ReviewEvent,
  ReviewEventType,
  ReviewInit,
  Revision,
};

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
   * Opens a review and returns the URL to hand to a human. Content is pushed (`files`) or pulled
   * (`source`, read during this call only); `base` or `patch` makes it a review of a change. If
   * anything fails, no review is left behind.
   */
  async createReview(init: ReviewInit): Promise<Review> {
    const { meta, content, base } = parseInit(init);
    const id = newSessionId();
    const review = this.supervisor(id);
    await review.create(ttlSeconds(this.env.SESSION_TTL_SECONDS));
    try {
      const baseInput = await uploadBase(review, base);
      await review.init(meta, await upload(review, content), baseInput);
    } catch (err) {
      await review.destroy();
      throw err;
    }
    const origin = (this.ctx.props?.origin ?? this.env.PUBLIC_URL).replace(/\/+$/, "");
    return { id, url: `${origin}/s/${id}` };
  }

  /**
   * Puts a full snapshot up as the next version at the same URL and appends `revised`; files
   * absent from it are deleted in that version. Allowed until the review is closed, approved or
   * not. An identical snapshot is `unchanged` and appends nothing.
   */
  async revise(id: string, content: Content): Promise<Revision> {
    const review = this.session(id);
    return review.revise(await upload(review, parseContent(content)));
  }

  /** Events with `seq > after` (default 0), in order; a long log may come in several calls. */
  async getEvents(id: string, after = 0): Promise<ReviewEvent[]> {
    return this.session(id).events(after);
  }

  /**
   * Like `getEvents`, but waits up to `seconds` (default 25, at most 55) for at least one event;
   * `[]` means none yet. Keep a cursor: call, process, set it to the last `seq`.
   */
  async waitForEvents(id: string, after: number, seconds?: number): Promise<ReviewEvent[]> {
    return this.session(id).wait(after, seconds);
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
