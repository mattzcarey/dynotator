import {
  Waiters,
  allowsDecision,
  clearDecision,
  getDecision,
  parseWaitSeconds,
  settle,
  type DecisionKind,
} from "./decision";
import { deleteDraft, loadDraft, parseGeneration, saveDraft } from "./drafts";
import { HttpError, error, json, readJsonObject } from "./http";
import {
  addVersion,
  currentRevision,
  currentVersion,
  getMeta,
  getVersion,
  listVersions,
  parseMarkdown,
  planPayload,
  type SessionMeta,
} from "./plan";
import type { Store } from "./store";
import { MAX_IMAGE_BYTES, imageHeaders, loadUpload, saveUpload } from "./uploads";

/** Set by the supervisor on every forwarded request: `<origin>/s/<id>`. */
export const BASE_URL_HEADER = "x-dynotator-base";

const MAX_CONFIG_BYTES = 64 * 1024;

export interface SessionContext {
  store: Store;
  waiters: Waiters;
  now?: () => Date;
}

const DECISION_ROUTES: Record<string, DecisionKind> = {
  "/api/approve": "approve",
  "/api/deny": "deny",
  "/api/feedback": "feedback",
  "/api/exit": "exit",
};

export async function handleRequest(req: Request, ctx: SessionContext): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return error(404, "Not found", { path: url.pathname });
  const meta = getMeta(ctx.store);
  if (!meta) return error(404, "Session not found");
  try {
    return (await route(req, url, meta, ctx)) ?? error(404, "Not found", { path: url.pathname });
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message);
    throw err;
  }
}

async function route(
  req: Request,
  url: URL,
  meta: SessionMeta,
  ctx: SessionContext,
): Promise<Response | undefined> {
  const { store } = ctx;
  const now = ctx.now?.() ?? new Date();
  const method = req.method;
  const path = url.pathname;

  if (path === "/api/plan" && method === "GET") {
    return json(planPayload(store, meta, readConfig(store)));
  }
  if (path === "/api/plan/revision" && method === "GET" && meta.mode === "plan") {
    return json({ revision: currentRevision(store), decided: getDecision(store) !== undefined });
  }
  if (path === "/api/plan/versions" && method === "GET") {
    return json({ project: meta.project ?? "", slug: "", versions: listVersions(store) });
  }
  if (path === "/api/plan/version" && method === "GET") {
    const v = Number(url.searchParams.get("v"));
    if (!Number.isInteger(v) || v < 1) return error(400, "Invalid version number");
    const plan = getVersion(store, v);
    return plan === undefined ? error(404, "Version not found") : json({ plan, version: v });
  }

  const kind = DECISION_ROUTES[path];
  if (kind && method === "POST" && allowsDecision(meta.mode, kind)) {
    // Exit posts carry no body; the draft generation rides the query string.
    const body = kind === "exit" ? {} : await readJsonObject(req);
    const result = settle(store, meta, kind, body, now);
    if (!result.ok) return json(result.body, result.status);
    const generation =
      typeof body.draftGeneration === "number"
        ? parseGeneration(String(body.draftGeneration))
        : parseGeneration(url.searchParams.get("draftGeneration"));
    deleteDraft(store, result.decision.version, generation);
    ctx.waiters.resolveAll(result.decision);
    return json({ ok: true });
  }

  if (path === "/api/wait" && method === "GET") {
    const existing = getDecision(store);
    if (existing) return json({ status: "decided", decision: existing });
    const decision = await ctx.waiters.wait(parseWaitSeconds(url.searchParams.get("timeout")));
    return json(decision ? { status: "decided", decision } : { status: "pending" });
  }

  if (path === "/api/revise" && method === "POST") {
    const markdown = parseMarkdown((await readJsonObject(req)).markdown);
    const decision = getDecision(store);
    if (decision && (decision.approved || decision.exit)) {
      return error(409, "This review session has finished.", { code: "already_decided" });
    }
    const { version, unchanged } = addVersion(store, markdown, now);
    clearDecision(store);
    return json({ ok: true, version, revision: currentRevision(store), unchanged });
  }

  if (path === "/api/draft") {
    const version = currentVersion(store);
    if (method === "GET") return result(loadDraft(store, version));
    if (method === "POST") {
      const body = await readJsonObject(req);
      return result(saveDraft(store, version, body, getDecision(store) !== undefined));
    }
    if (method === "DELETE") {
      deleteDraft(store, version, parseGeneration(url.searchParams.get("generation")));
      return json({ ok: true });
    }
  }

  if (path === "/api/upload" && method === "POST") {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES + 64 * 1024) {
      return error(413, `Images are limited to ${MAX_IMAGE_BYTES} bytes`);
    }
    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      return error(400, "Expected multipart form data");
    }
    if (!file || typeof file === "string") return error(400, "No file provided");
    const id = saveUpload(store, new Uint8Array(await file.arrayBuffer()), file.name);
    const base = req.headers.get(BASE_URL_HEADER);
    const ref = base ? `${base}/api/image?path=${id}` : id;
    return json({ path: ref, originalName: file.name });
  }

  if (path === "/api/image" && method === "GET") {
    const image = loadUpload(store, url.searchParams.get("path") ?? "");
    if (!image) {
      return new Response("Image not found", { status: 404, headers: imageHeaders("text/plain") });
    }
    return new Response(image.bytes, { headers: imageHeaders(image.type) });
  }

  if (path === "/api/config") {
    if (method === "GET") return json(readConfig(store));
    if (method === "POST") {
      const merged = { ...readConfig(store), ...(await readJsonObject(req, MAX_CONFIG_BYTES)) };
      if (JSON.stringify(merged).length > MAX_CONFIG_BYTES) return error(413, "Config too large");
      store.put("config", merged);
      return json({ ok: true });
    }
  }

  return undefined;
}

function readConfig(store: Store): Record<string, unknown> {
  return store.get<Record<string, unknown>>("config") ?? {};
}

function result(r: { status: number; body: unknown }): Response {
  return json(r.body, r.status);
}
