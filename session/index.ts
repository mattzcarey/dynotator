import { DurableObject } from "cloudflare:workers";
import { Waiters } from "./decision";
import { initSession, type SessionInit } from "./plan";
import { handleRequest } from "./router";

/**
 * The per-session server. Runs inside a Dynamic Worker as a Durable Object Facet of the host's
 * `SessionSupervisor`, with no bindings, no network and only its own SQLite storage.
 */
export class SessionServer extends DurableObject {
  private readonly waiters = new Waiters();

  /** Seeds the session. Called once by the supervisor over RPC; not reachable over HTTP. */
  init(input: SessionInit): void {
    initSession(this.ctx.storage.kv, input);
  }

  fetch(request: Request): Promise<Response> {
    return handleRequest(request, { store: this.ctx.storage.kv, waiters: this.waiters });
  }
}
