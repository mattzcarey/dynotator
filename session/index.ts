import { DurableObject } from "cloudflare:workers";
import {
  type Decision,
  type Revision,
  Waiters,
  clampWaitSeconds,
  getDecision,
  revise,
} from "./decision";
import { initSession, parseMarkdown, type SessionInit } from "./plan";
import { handleRequest } from "./router";

/**
 * The per-session server. Runs inside a Dynamic Worker as a Durable Object Facet of the host's
 * `SessionSupervisor`, with no bindings, no network and only its own SQLite storage.
 */
export class SessionServer extends DurableObject {
  private readonly waiters = new Waiters();

  // The RPC methods are reachable only through the supervisor, never over HTTP.

  /** Seeds the session. Called once. */
  init(input: SessionInit): void {
    initSession(this.ctx.storage.kv, input);
  }

  /** The reviewer's decision, or `null` while the review is open. */
  decision(): Decision | null {
    return getDecision(this.ctx.storage.kv) ?? null;
  }

  /** Resolves with the decision, or `null` if none arrives within `seconds` (capped). */
  async wait(seconds?: number): Promise<Decision | null> {
    return this.decision() ?? (await this.waiters.wait(clampWaitSeconds(seconds))) ?? null;
  }

  /** Puts a new version up for review and reopens the decision. */
  revise(markdown: string): Revision {
    return revise(this.ctx.storage.kv, parseMarkdown(markdown));
  }

  fetch(request: Request): Promise<Response> {
    return handleRequest(request, { store: this.ctx.storage.kv, waiters: this.waiters });
  }
}
