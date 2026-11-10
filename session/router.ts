import { DECISION_KINDS, type Decision, type DecisionKind, getDecision, settle } from "./decision";
import { deleteDraft, loadDraft, parseGeneration, saveDraft } from "./drafts";
import { HttpError, error, json, readJsonObject } from "./http";
import { changes, isValidPath } from "./files";
import {
  type Fs,
  type ReviewMeta,
  currentVersion,
  getManifest,
  getMeta,
  listVersions,
  openPath,
  readVersionFile,
} from "./review";
import type { Store } from "./store";

const DECISION_ROUTES: Record<string, DecisionKind> = {
  "/api/approve": "approve",
  "/api/deny": "deny",
  "/api/feedback": "feedback",
  "/api/exit": "exit",
};

/** The browser's API. `onDecision` hears every decision recorded here. */
export async function handleRequest(
  req: Request,
  store: Store,
  fs: Fs,
  onDecision: (decision: Decision) => void,
): Promise<Response> {
  const url = new URL(req.url);
  const meta = getMeta(store);
  if (!meta) return error(404, "Session not found");
  try {
    return (
      (await route(req, url, meta, store, fs, onDecision)) ??
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
  onDecision: (decision: Decision) => void,
): Promise<Response | undefined> {
  const { method } = req;
  const path = url.pathname;
  const version = currentVersion(store);
  const versionParam = (name: string) => parseVersion(url.searchParams.get(name), version);
  const manifestOf = (v: number) => {
    const manifest = getManifest(store, v);
    if (!manifest) throw new HttpError(404, "Version not found", { version: v });
    return manifest;
  };

  if (method === "GET" && path === "/api/review") {
    return json({
      mode: meta.mode,
      ...(meta.title && { title: meta.title }),
      open: openPath(meta, manifestOf(version)),
      version,
      versions: listVersions(store),
    });
  }
  if (method === "GET" && path === "/api/revision") {
    return json({ revision: version });
  }
  if (method === "GET" && path === "/api/files") {
    const files = Array.from(manifestOf(versionParam("v")), ([p, { size }]) => ({ path: p, size }));
    return json({ files });
  }
  if (method === "GET" && path === "/api/file") {
    const v = versionParam("v");
    const filePath = url.searchParams.get("path");
    if (!isValidPath(filePath)) return error(400, "Invalid path");
    manifestOf(v);
    const content = await readVersionFile(store, fs, v, filePath);
    if (content === undefined) return error(404, "File not found", { path: filePath });
    return json({ path: filePath, content });
  }
  if (method === "GET" && path === "/api/changes") {
    const to = versionParam("to");
    const from = parseVersion(url.searchParams.get("from"), to - 1);
    return json({ files: changes(manifestOf(from), manifestOf(to)) });
  }

  const kind = DECISION_ROUTES[path];
  if (method === "POST" && kind && DECISION_KINDS[meta.mode].includes(kind)) {
    // Exit is a bare POST; its draft generation rides the query string.
    const body = kind === "exit" ? {} : await readJsonObject(req);
    const decision = settle(store, kind, body);
    deleteDraft(
      store,
      version,
      parseGeneration(body.draftGeneration ?? url.searchParams.get("draftGeneration")),
    );
    onDecision(decision);
    return json({ ok: true });
  }

  if (path === "/api/draft") {
    if (method === "GET") return json(loadDraft(store, version));
    if (method === "POST") {
      if (getDecision(store)) {
        return error(409, "This review has already been decided.", { decided: true });
      }
      saveDraft(store, version, await readJsonObject(req));
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const generation = parseGeneration(url.searchParams.get("generation"));
      if (generation === undefined) return error(400, "generation must be an integer >= 0");
      deleteDraft(store, version, generation);
      return json({ ok: true });
    }
  }

  return undefined;
}

/** A `?v=`-style version: absent means `fallback`; anything but a positive integer is a 400. */
function parseVersion(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const v = Number(raw);
  if (raw === "" || !Number.isInteger(v) || v < 1) throw new HttpError(400, "Invalid version");
  return v;
}
