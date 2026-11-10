import type { Store } from "./store";

export type SessionMode = "plan" | "annotate";

/** What a review starts with. Validated by the RPC entrypoint before it gets here. */
export interface SessionInit {
  mode: SessionMode;
  markdown: string;
  title?: string;
}

export type SessionMeta = Omit<SessionInit, "markdown">;

interface StoredVersion {
  markdown: string;
  timestamp: string;
}

const META = "meta";
const HEAD = "head";
const VERSION_PREFIX = "version:";
const versionKey = (v: number) => `${VERSION_PREFIX}${String(v).padStart(6, "0")}`;

export function initSession(store: Store, { markdown, ...meta }: SessionInit): void {
  if (store.get(META)) throw new Error("Session already initialised");
  store.put<SessionMeta>(META, meta);
  store.put<StoredVersion>(versionKey(1), { markdown, timestamp: new Date().toISOString() });
  store.put(HEAD, 1);
}

export function getMeta(store: Store): SessionMeta | undefined {
  return store.get<SessionMeta>(META);
}

/** The latest version number, starting at 1. The browser also echoes it as `planRevision`. */
export function currentVersion(store: Store): number {
  return store.get<number>(HEAD) ?? 0;
}

export function getVersion(store: Store, v: number): string | undefined {
  return store.get<StoredVersion>(versionKey(v))?.markdown;
}

export function listVersions(store: Store): Array<{ version: number; timestamp: string }> {
  return Array.from(store.list<StoredVersion>({ prefix: VERSION_PREFIX }), ([key, value]) => ({
    version: Number(key.slice(VERSION_PREFIX.length)),
    timestamp: value.timestamp,
  }));
}

/** Adds `markdown` as the next version unless it equals the current one. */
export function addVersion(
  store: Store,
  markdown: string,
): { version: number; unchanged: boolean } {
  const head = currentVersion(store);
  if (getVersion(store, head) === markdown) return { version: head, unchanged: true };
  const next = head + 1;
  store.put<StoredVersion>(versionKey(next), { markdown, timestamp: new Date().toISOString() });
  store.put(HEAD, next);
  return { version: next, unchanged: false };
}
