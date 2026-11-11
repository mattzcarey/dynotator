import { deleteDraft, loadDraft, parseGeneration, saveDraft } from "./drafts";
import {
  type ReviewEvent,
  SUBMISSIONS,
  assertOpen,
  eventsAfter,
  isClosed,
  lastSeq,
  submit,
} from "./events";
import { changes, isValidPath } from "./files";
import { HttpError, REVIEWER_HEADER, error, json, readJsonObject } from "./http";
import { imageType } from "./image";
import {
  type Fs,
  type ReviewMeta,
  currentVersion,
  getManifest,
  getMeta,
  hasBase,
  listVersions,
  openPath,
  readBytes,
  readText,
} from "./review";
import type { Store } from "./store";

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
  const versionParam = (name: string) => parseVersion(query.get(name), version);
  const manifestOf = (v: number) => {
    const manifest = getManifest(store, v);
    if (!manifest) throw new HttpError(404, "Version not found", { version: v });
    return manifest;
  };
  const filePath = () => {
    const p = query.get("path");
    if (!isValidPath(p)) throw new HttpError(400, "Invalid path");
    return p;
  };

  if (method === "GET" && path === "/api/review") {
    return json({
      mode: meta.mode,
      ...(meta.title && { title: meta.title }),
      open: openPath(meta, manifestOf(version)),
      version,
      versions: listVersions(store),
      closed: isClosed(store),
      base: hasBase(store),
    });
  }
  if (method === "GET" && path === "/api/revision") {
    return json({ revision: version, seq: lastSeq(store) });
  }
  if (method === "GET" && path === "/api/events") {
    return json({ events: eventsAfter(store, parseCursor(query.get("after"))) });
  }
  if (method === "GET" && path === "/api/files") {
    const files = Array.from(manifestOf(versionParam("v")), ([p, { size, binary }]) => ({
      path: p,
      size,
      ...(binary && { binary: true }),
    }));
    return json({ files });
  }
  if (method === "GET" && path === "/api/file") {
    const v = versionParam("v");
    const p = filePath();
    manifestOf(v);
    const file = await readText(store, fs, v, p);
    if (!file) return error(404, "File not found", { path: p });
    if ("binary" in file) return error(415, "Binary file", { path: p });
    return json({ path: p, content: file.text });
  }
  if (method === "GET" && path === "/api/raw") {
    const v = versionParam("v");
    const p = filePath();
    manifestOf(v);
    const bytes = await readBytes(store, fs, v, p);
    if (!bytes) return error(404, "File not found", { path: p });
    const type = imageType(bytes);
    if (!type) return error(415, "Not an image", { path: p });
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (method === "GET" && path === "/api/changes") {
    const to = versionParam("to");
    const from = parseVersion(query.get("from"), to - 1);
    return json({ files: changes(manifestOf(from), manifestOf(to)) });
  }

  const type = SUBMISSIONS[meta.mode][path];
  if (method === "POST" && type) {
    // Exit is a bare POST; its draft generation and revision ride the query string.
    const body =
      type === "dismissed"
        ? { revision: query.get("revision") ?? undefined }
        : await readJsonObject(req);
    const by = req.headers.get(REVIEWER_HEADER) ?? undefined;
    const event = submit(store, type, version, body, by);
    deleteDraft(
      store,
      version,
      parseGeneration(
        type === "dismissed" ? query.get("draftGeneration") : body.draftGeneration,
      ),
    );
    onEvent(event);
    return json({ ok: true, seq: event.seq });
  }
  if (path === "/api/draft") {
    if (method === "GET") return json(loadDraft(store, version));
    if (method === "POST") {
      assertOpen(store);
      saveDraft(store, version, await readJsonObject(req));
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const generation = parseGeneration(query.get("generation"));
      if (generation === undefined) return error(400, "generation must be an integer >= 0");
      deleteDraft(store, version, generation);
      return json({ ok: true });
    }
  }
  return undefined;
}

/** A `?v=`-style version: absent means `fallback`; anything but an integer >= 0 is a 400. */
function parseVersion(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const v = Number(raw);
  if (raw === "" || !Number.isInteger(v) || v < 0) throw new HttpError(400, "Invalid version");
  return v;
}

function parseCursor(raw: string | null): number {
  const n = raw === null ? 0 : Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "after must be an integer >= 0");
  }
  return n;
}
