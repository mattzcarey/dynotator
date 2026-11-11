import { clearDraft, loadDraft, saveDraft } from "./drafts";
import {
  type ReviewEvent,
  type SubmissionType,
  eventsAfter,
  isClosed,
  lastSeq,
  submit,
} from "./events";
import { changes, isValidPath } from "./files";
import { HttpError, REVIEWER_HEADER, error, json, readJsonObject } from "./http";
import {
  type Fs,
  type ReviewMeta,
  currentVersion,
  getManifest,
  getMeta,
  hasBase,
  listVersions,
  openPath,
  readVersionFile,
} from "./review";
import type { Store } from "./store";

const SUBMISSIONS: Record<string, SubmissionType> = {
  "/api/feedback": "feedback",
  "/api/approve": "approved",
};

/** The browser's API. `onEvent` hears every event appended here. */
export async function handleRequest(
  req: Request,
  store: Store,
  fs: Fs,
  onEvent: (event: ReviewEvent) => void,
): Promise<Response> {
  const url = new URL(req.url);
  const meta = getMeta(store);
  if (!meta) return error(404, "Session not found");
  try {
    return (
      (await route(req, url, meta, store, fs, onEvent)) ??
      error(404, "Not found", { path: url.pathname })
    );
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message, err.extra);
    throw err;
  }
}

async function route(
  req: Request,
  url: URL,
  meta: ReviewMeta,
  store: Store,
  fs: Fs,
  onEvent: (event: ReviewEvent) => void,
): Promise<Response | undefined> {
  const { method } = req;
  const path = url.pathname;
  const query = url.searchParams;
  const version = currentVersion(store);
  const versionParam = (name: string) => parseCount(query.get(name), version, "Invalid version");
  const manifestOf = (v: number) => {
    const manifest = getManifest(store, v);
    if (!manifest) throw new HttpError(404, "Version not found", { version: v });
    return manifest;
  };

  if (method === "GET" && path === "/api/review") {
    return json({
      ...(meta.title && { title: meta.title }),
      open: openPath(meta, manifestOf(version)),
      version,
      versions: listVersions(store),
      base: hasBase(store),
      closed: isClosed(store),
    });
  }
  if (method === "GET" && path === "/api/revision") {
    return json({ revision: version, seq: lastSeq(store) });
  }
  if (method === "GET" && path === "/api/events") {
    const after = parseCount(query.get("after"), 0, "after must be an integer >= 0");
    return json({ events: eventsAfter(store, after) });
  }
  if (method === "GET" && path === "/api/files") {
    const files = Array.from(manifestOf(versionParam("v")), ([p, { size }]) => ({ path: p, size }));
    return json({ files });
  }
  if (method === "GET" && path === "/api/file") {
    const v = versionParam("v");
    const filePath = query.get("path");
    if (!isValidPath(filePath)) return error(400, "Invalid path");
    manifestOf(v);
    const content = await readVersionFile(store, fs, v, filePath);
    if (content === undefined) return error(404, "File not found", { path: filePath });
    return json({ path: filePath, content });
  }
  if (method === "GET" && path === "/api/changes") {
    const to = versionParam("to");
    const from = parseCount(query.get("from"), to - 1, "Invalid version");
    return json({ files: changes(manifestOf(from), manifestOf(to)) });
  }
  const type = SUBMISSIONS[path];
  if (method === "POST" && type) {
    const body = await readJsonObject(req);
    const by = req.headers.get(REVIEWER_HEADER) ?? undefined;
    const { seq, event } = submit(store, type, version, body, by);
    clearDraft(store, version);
    if (event) onEvent(event);
    return json({ ok: true, seq });
  }
  if (path === "/api/draft") {
    if (method === "GET") return json(loadDraft(store, version));
    if (method === "POST") {
      saveDraft(store, version, await readJsonObject(req));
      return json({ ok: true });
    }
  }
  return undefined;
}

/** A non-negative integer query parameter: absent means `fallback`, anything else is a 400. */
function parseCount(raw: string | null, fallback: number, message: string): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 0) throw new HttpError(400, message);
  return n;
}
