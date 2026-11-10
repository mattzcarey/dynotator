import { HttpError } from "./http";
import type { Store } from "./store";

/**
 * Unsent annotations, kept per version. The browser stamps every save and delete with a growing
 * `draftGeneration`, and a delete leaves a tombstone with its generation, so a save that was in
 * flight when the draft was deleted (by the reviewer or by a decision) cannot bring it back.
 */
interface Draft {
  annotations: unknown[];
  draftGeneration: number;
  ts?: number;
}

const draftKey = (version: number) => `draft:${version}`;
const deletedKey = (version: number) => `draft-deleted:${version}`;

/** The highest generation seen for this version, or `undefined` if none. */
function latestGeneration(store: Store, version: number): number | undefined {
  const saved = store.get<Draft>(draftKey(version))?.draftGeneration;
  const deleted = store.get<number>(deletedKey(version));
  return saved === undefined ? deleted : deleted === undefined ? saved : Math.max(saved, deleted);
}

/** The draft, or just the latest generation (so a fresh tab continues from it) when there is none. */
export function loadDraft(store: Store, version: number): Draft | { draftGeneration?: number } {
  const draft = store.get<Draft>(draftKey(version));
  if (draft) return draft;
  const deleted = store.get<number>(deletedKey(version));
  return deleted === undefined ? {} : { draftGeneration: deleted };
}

export function saveDraft(store: Store, version: number, body: Record<string, unknown>): void {
  const generation = parseGeneration(body.draftGeneration);
  if (generation === undefined) throw new HttpError(400, "draftGeneration must be an integer >= 0");
  if (!Array.isArray(body.annotations)) throw new HttpError(400, "annotations must be an array");
  if (body.ts !== undefined && typeof body.ts !== "number") {
    throw new HttpError(400, "ts must be a number");
  }
  const deleted = store.get<number>(deletedKey(version));
  const saved = store.get<Draft>(draftKey(version))?.draftGeneration;
  if (
    (deleted !== undefined && generation <= deleted) ||
    (saved !== undefined && generation < saved)
  ) {
    throw new HttpError(409, "Stale draft", { draftGeneration: latestGeneration(store, version) });
  }
  store.put<Draft>(draftKey(version), {
    annotations: body.annotations,
    draftGeneration: generation,
    ...(body.ts !== undefined && { ts: body.ts }),
  });
}

/**
 * Deletes the draft and records `generation` as its tombstone, unless a newer save has already
 * replaced what the caller meant to delete. Without a generation it just deletes the draft.
 */
export function deleteDraft(store: Store, version: number, generation?: number): void {
  if (generation === undefined) {
    store.delete(draftKey(version));
    return;
  }
  const latest = latestGeneration(store, version);
  if (latest !== undefined && generation < latest) return;
  store.put(deletedKey(version), generation);
  store.delete(draftKey(version));
}

export function parseGeneration(value: unknown): number | undefined {
  const n = typeof value === "string" && value !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}
