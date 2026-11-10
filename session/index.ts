import { DurableObject } from "cloudflare:workers";
import { type Decision, type Revision, getDecision, revise } from "./decision";
import { type SessionInit, initSession } from "./plan";
import { handleRequest } from "./router";

const DEFAULT_WAIT_SECONDS = 25;
const MAX_WAIT_SECONDS = 55;

/**
 * The per-review server. Runs inside a Dynamic Worker as a Durable Object Facet of the host's
 * `SessionSupervisor`, with no bindings, no network and only its own SQLite storage. The RPC
 * methods are reachable only through the supervisor; `fetch` serves the browser.
 */
export class SessionServer extends DurableObject {
  /** Pending `wait` calls, in memory: they last only as long as this instance does. */
  private readonly waiting = new Set<(decision: Decision | null) => void>();

  init(input: SessionInit): void {
    initSession(this.ctx.storage.kv, input);
  }

  decision(): Decision | null {
    return getDecision(this.ctx.storage.kv) ?? null;
  }

  /** The decision, or `null` if none arrives within `seconds` (default 25, at most 55). */
  wait(seconds?: number): Promise<Decision | null> {
    const existing = this.decision();
    if (existing) return Promise.resolve(existing);
    const s =
      seconds !== undefined && seconds >= 0
        ? Math.min(seconds, MAX_WAIT_SECONDS)
        : DEFAULT_WAIT_SECONDS;
    return new Promise((resolve) => {
      const done = (decision: Decision | null) => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve(decision);
      };
      const timer = setTimeout(() => done(null), s * 1000);
      this.waiting.add(done);
    });
  }

  revise(markdown: string): Revision {
    return revise(this.ctx.storage.kv, markdown);
  }

  fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.ctx.storage.kv, (decision) => {
      for (const done of this.waiting) done(decision);
    });
  }
}
