import { Workspace } from "@cloudflare/computer";
import { DurableObject } from "cloudflare:workers";
import type { ReviewEvent, Revision } from "./events";
import type { Files, ReviewInit } from "./files";
import { Session } from "./session";

/**
 * The per-review server. Runs inside a Dynamic Worker as a Durable Object Facet of the host's
 * `SessionSupervisor`, with no bindings, no network and only its own SQLite storage, which holds
 * the review's state, its event log and its `@cloudflare/computer` Workspace (one tree per version
 * under `/v/<n>/`, version 0 being the state before the review's patch). The RPC methods are
 * reachable only through the supervisor; `fetch` serves the browser.
 */
export class SessionServer extends DurableObject {
  private session?: Session;

  init(input: ReviewInit): Promise<void> {
    return this.open().init(input);
  }

  revise(files: Files): Promise<Revision> {
    return this.open().revise(files);
  }

  close(): Promise<void> {
    return this.open().close();
  }

  events(after?: number, wait?: number): Promise<ReviewEvent[]> {
    return this.open().events(after, wait);
  }

  fetch(request: Request): Promise<Response> {
    return this.open().fetch(request);
  }

  private open(): Session {
    this.session ??= new Session(
      this.ctx.storage.kv,
      new Workspace({ storage: this.ctx.storage }).fs,
    );
    return this.session;
  }
}
