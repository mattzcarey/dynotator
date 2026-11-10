import { WorkerEntrypoint } from "cloudflare:workers";
import type { Decision, Revision } from "../session/decision";
import type { SessionInit } from "../session/plan";
import { isSessionId, newSessionId, ttlSeconds } from "./routes";

export type { Decision, Revision, SessionInit };

export interface Review {
  id: string;
  /** Where a human reviews it. Send this to the reviewer. */
  url: string;
}

const MAX_MARKDOWN_BYTES = 1_000_000;
const MAX_TITLE_LENGTH = 4096;

/**
 * The API other Workers and agents call through a service binding to this entrypoint. Nothing
 * here is reachable over HTTP: the binding is the authorisation.
 */
export class Dynotator extends WorkerEntrypoint<Env> {
  /**
   * Opens a review of `markdown` and returns the URL to hand to a human. `mode` is `"plan"`
   * (approve or request changes) or `"annotate"` (send feedback or close).
   */
  async createReview(init: SessionInit): Promise<Review> {
    const session = parseInit(init);
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

  /**
   * Puts a revised document up for review at the same URL, so the reviewer sees the diff, and
   * reopens the decision. Throws once the review has been approved or closed.
   */
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

function parseInit(init: SessionInit): SessionInit {
  if (!init || typeof init !== "object") throw new TypeError("Expected { mode, markdown, title? }");
  const { mode, markdown, title } = init;
  if (mode !== "plan" && mode !== "annotate") {
    throw new TypeError('mode must be "plan" or "annotate"');
  }
  if (title !== undefined && (typeof title !== "string" || title.length > MAX_TITLE_LENGTH)) {
    throw new TypeError(`title must be a string of at most ${MAX_TITLE_LENGTH} characters`);
  }
  return { mode, markdown: parseMarkdown(markdown), ...(title && { title }) };
}

function parseMarkdown(markdown: unknown): string {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw new RangeError(`markdown exceeds ${MAX_MARKDOWN_BYTES} bytes`);
  }
  return markdown;
}
