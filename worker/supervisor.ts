import { DurableObject } from "cloudflare:workers";
import bundle from "virtual:session-server";
import type { ReviewEvent, Revision } from "../session/events";
import type { Files, ReviewInit } from "../session/files";
import type { SessionServer } from "../session/index";

interface SupervisorMeta {
  expiresAt: number;
}

const FACET = "server";

/**
 * One per session id. Owns the session's lifetime and runs the session server, loaded from the
 * bundled source into a Dynamic Worker with no network, as a facet with its own SQLite database.
 */
export class SessionSupervisor extends DurableObject<Env> {
  async create(init: ReviewInit, ttlSeconds: number): Promise<void> {
    if (this.ctx.storage.kv.get("meta")) throw new Error("Session id collision");
    const meta: SupervisorMeta = { expiresAt: Date.now() + ttlSeconds * 1000 };
    this.ctx.storage.kv.put("meta", meta);
    await this.ctx.storage.setAlarm(meta.expiresAt);
    try {
      await this.server().init(init);
    } catch (err) {
      // A review whose content was refused (a patch that does not apply, say) never existed.
      await this.remove();
      throw err;
    }
  }

  exists(): boolean {
    return this.live();
  }

  // Pass-throughs for the RPC entrypoint: a facet stub cannot be returned out of this object.

  revise(files: Files): Promise<Revision> {
    return this.session().revise(files);
  }

  events(after?: number, wait?: number): Promise<ReviewEvent[]> {
    return this.session().events(after, wait);
  }

  close(): Promise<void> {
    return this.session().close();
  }

  /** The browser's API, with the `/s/:id` prefix already stripped by the host. */
  async fetch(request: Request): Promise<Response> {
    if (!this.live()) return Response.json({ error: "Session not found" }, { status: 404 });
    return this.server().fetch(request);
  }

  async alarm(): Promise<void> {
    const meta = this.ctx.storage.kv.get<SupervisorMeta>("meta");
    if (meta && meta.expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(meta.expiresAt);
      return;
    }
    await this.remove();
  }

  private async remove() {
    this.ctx.facets.delete(FACET);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private live(): boolean {
    const meta = this.ctx.storage.kv.get<SupervisorMeta>("meta");
    return meta !== undefined && meta.expiresAt > Date.now();
  }

  private session() {
    if (!this.live()) throw new Error("This review does not exist or has expired");
    return this.server();
  }

  private server() {
    return this.ctx.facets.get<SessionServer>(FACET, () => {
      const worker = this.env.LOADER.get(bundle.id, () => ({
        compatibilityDate: "2026-11-01",
        // @cloudflare/computer's Workspace uses node:crypto, node:events and node:fs.
        compatibilityFlags: ["nodejs_compat"],
        mainModule: "session-server.js",
        modules: { "session-server.js": bundle.code },
        globalOutbound: null,
      }));
      return { class: worker.getDurableObjectClass<SessionServer>("SessionServer") };
    });
  }
}
