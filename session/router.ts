import { DECISION_KINDS, type Decision, type DecisionKind, getDecision, settle } from "./decision";
import { deleteDraft, loadDraft, parseGeneration, saveDraft } from "./drafts";
import { HttpError, error, json, readJsonObject } from "./http";
import { currentVersion, getMeta, getVersion, listVersions, type SessionMeta } from "./plan";
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
  onDecision: (decision: Decision) => void,
): Promise<Response> {
  const url = new URL(req.url);
  const meta = getMeta(store);
  if (!meta) return error(404, "Session not found");
  try {
    return (
      (await route(req, url, meta, store, onDecision)) ??
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
  meta: SessionMeta,
  store: Store,
  onDecision: (decision: Decision) => void,
): Promise<Response | undefined> {
  const { method } = req;
  const path = url.pathname;
  const version = currentVersion(store);

  if (method === "GET" && path === "/api/plan") {
    return json({
      plan: getVersion(store, version),
      mode: meta.mode,
      ...(meta.title && { title: meta.title }),
      previousPlan: getVersion(store, version - 1) ?? null,
      versionInfo: { version, totalVersions: version },
      ...(meta.mode === "plan" && { planRevision: version }),
    });
  }
  if (method === "GET" && path === "/api/plan/revision" && meta.mode === "plan") {
    return json({ revision: version });
  }
  if (method === "GET" && path === "/api/plan/versions") {
    return json({ versions: listVersions(store) });
  }
  if (method === "GET" && path === "/api/plan/version") {
    const v = Number(url.searchParams.get("v"));
    if (!Number.isInteger(v) || v < 1) return error(400, "Invalid version number");
    const plan = getVersion(store, v);
    return plan === undefined ? error(404, "Version not found") : json({ plan, version: v });
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
