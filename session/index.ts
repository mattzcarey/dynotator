import { Workspace } from "@cloudflare/computer";
import { DurableObject } from "cloudflare:workers";
import type { Decision, Revision } from "./decision";
import type { Files, ReviewInit } from "./files";
import { Session } from "./session";

/**
 * The per-review server. Runs inside a Dynamic Worker as a Durable Object Facet of the host's
 * `SessionSupervisor`, with no bindings, no network and only its own SQLite storage, which holds
 * both the review's state and its `@cloudflare/computer` Workspace (one tree per version under
 * `/v/<n>/`). The RPC methods are reachable only through the supervisor; `fetch` serves the
 * browser.
 */
export class SessionServer extends DurableObject {
  private session?: Session;

  init(input: ReviewInit): Promise<void> {
    return this.open().init(input);
  }

  decision(): Decision | null {
    return this.open().decision();
  }

  wait(seconds?: number): Promise<Decision | null> {
    return this.open().wait(seconds);
  }

  revise(files: Files): Promise<Revision> {
    return this.open().revise(files);
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
