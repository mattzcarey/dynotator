import { HttpError, MAX_MARKDOWN_BYTES, byteLength } from "./http";
import type { Store } from "./store";

export type SessionMode = "plan" | "annotate";

/** What the supervisor seeds a session with (the `POST /api/sessions` body, validated). */
export interface SessionInit {
  mode: SessionMode;
  markdown: string;
  title?: string;
  origin?: string;
  permissionMode?: string;
  filePath?: string;
  project?: string;
}

export interface SessionMeta extends Omit<SessionInit, "markdown"> {
  createdAt: string;
}

interface StoredVersion {
  markdown: string;
  timestamp: string;
}

const META = "meta";
const HEAD = "head";
const versionKey = (v: number) => `version:${String(v).padStart(6, "0")}`;

const OPTIONAL_STRINGS = ["title", "origin", "permissionMode", "filePath", "project"] as const;

/** Validates untrusted session-creation input. Throws `HttpError(400|413)`. */
export function parseSessionInit(body: unknown): SessionInit {
  if (!body || typeof body !== "object") throw new HttpError(400, "Expected a JSON object");
  const b = body as Record<string, unknown>;
  if (b.mode !== "plan" && b.mode !== "annotate") {
    throw new HttpError(400, 'mode must be "plan" or "annotate"');
  }
  const init: SessionInit = { mode: b.mode, markdown: parseMarkdown(b.markdown) };
  for (const field of OPTIONAL_STRINGS) {
    const value = b[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > 4096) {
      throw new HttpError(400, `${field} must be a string of at most 4096 characters`);
    }
    init[field] = value;
  }
  return init;
}

export function parseMarkdown(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "markdown must be a string");
  if (byteLength(value) > MAX_MARKDOWN_BYTES) {
    throw new HttpError(413, `markdown exceeds ${MAX_MARKDOWN_BYTES} bytes`);
  }
  return value;
}

export function initSession(store: Store, init: SessionInit, now = new Date()): void {
  if (store.get(META)) throw new Error("Session already initialised");
  const { markdown, ...rest } = init;
  store.put<SessionMeta>(META, { ...rest, createdAt: now.toISOString() });
  store.put<StoredVersion>(versionKey(1), { markdown, timestamp: now.toISOString() });
  store.put(HEAD, 1);
}

export function getMeta(store: Store): SessionMeta | undefined {
  return store.get<SessionMeta>(META);
}

export function currentVersion(store: Store): number {
  return store.get<number>(HEAD) ?? 0;
}

/** The plan revision the UI echoes in decisions: 0 for the plan the session started with. */
export function currentRevision(store: Store): number {
  return Math.max(0, currentVersion(store) - 1);
}

export function getVersion(store: Store, v: number): string | undefined {
  return store.get<StoredVersion>(versionKey(v))?.markdown;
}

export function listVersions(store: Store): Array<{ version: number; timestamp: string }> {
  const out: Array<{ version: number; timestamp: string }> = [];
  for (const [key, value] of store.list<StoredVersion>({ prefix: "version:" })) {
    out.push({ version: Number(key.slice("version:".length)), timestamp: value.timestamp });
  }
  return out;
}

/** Adds `markdown` as the next version unless it equals the current one. */
export function addVersion(
  store: Store,
  markdown: string,
  now = new Date(),
): { version: number; unchanged: boolean } {
  const head = currentVersion(store);
  if (getVersion(store, head) === markdown) return { version: head, unchanged: true };
  const next = head + 1;
  store.put<StoredVersion>(versionKey(next), { markdown, timestamp: now.toISOString() });
  store.put(HEAD, next);
  return { version: next, unchanged: false };
}

/**
 * The `/api/plan` payload. Plan review names no `mode` (the UI reads its absence as plan review,
 * as upstream's plan server does). Everything the hosted app cannot offer is simply absent:
 * no sharing, no repo info, no local paths, no integrations, no update adverts.
 */
export function planPayload(
  store: Store,
  meta: SessionMeta,
  serverConfig: Record<string, unknown>,
): Record<string, unknown> {
  const version = currentVersion(store);
  const common = {
    plan: getVersion(store, version) ?? "",
    origin: meta.origin ?? "claude-code",
    ...(meta.title ? { title: meta.title } : {}),
    previousPlan: version > 1 ? (getVersion(store, version - 1) ?? null) : null,
    versionInfo: { version, totalVersions: version, project: meta.project ?? "" },
    sharingEnabled: false,
    serverConfig,
  };
  if (meta.mode === "annotate") {
    return {
      ...common,
      mode: "annotate",
      ...(meta.filePath ? { filePath: meta.filePath } : {}),
      gate: false,
      renderAs: "markdown",
      sourceConverted: false,
      convertHtml: false,
    };
  }
  return {
    ...common,
    ...(meta.permissionMode ? { permissionMode: meta.permissionMode } : {}),
    planRevision: currentRevision(store),
  };
}
