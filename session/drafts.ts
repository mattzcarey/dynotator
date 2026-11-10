import type { Store } from "./store";

/**
 * Upstream's draft protocol: the client stamps each save with an increasing `draftGeneration`;
 * a delete records the generation it cleared, so a late save from before the delete cannot
 * resurrect sent comments. Drafts are kept per plan version, as upstream keys them by the plan's
 * content hash.
 */
export type DraftResult = { status: number; body: unknown };

const draftKey = (version: number) => `draft:${version}`;
const deletedKey = (version: number) => `draft-deleted:${version}`;

function generationOf(value: unknown): number | null {
  const g = (value as { draftGeneration?: unknown } | null | undefined)?.draftGeneration;
  return typeof g === "number" && Number.isInteger(g) && g >= 0 ? g : null;
}

function knownGeneration(store: Store, version: number): number | null {
  const known = [
    generationOf(store.get(draftKey(version))),
    store.get<number>(deletedKey(version)) ?? null,
  ].filter((g): g is number => g !== null);
  return known.length ? Math.max(...known) : null;
}

export function loadDraft(store: Store, version: number): DraftResult {
  const draft = store.get(draftKey(version));
  const deleted = store.get<number>(deletedKey(version));
  const generation = generationOf(draft);
  if (draft && !(generation !== null && deleted !== undefined && generation <= deleted)) {
    return { status: 200, body: draft };
  }
  const known = knownGeneration(store, version);
  return {
    status: 404,
    body: { found: false, ...(known !== null ? { draftGeneration: known } : {}) },
  };
}

export function saveDraft(
  store: Store,
  version: number,
  body: Record<string, unknown>,
  decided: boolean,
): DraftResult {
  if (decided) {
    return {
      status: 409,
      body: { error: "This review session has already been decided.", decided: true },
    };
  }
  const generation = generationOf(body);
  const deleted = store.get<number>(deletedKey(version));
  const stored = generationOf(store.get(draftKey(version)));
  if (
    generation !== null &&
    ((deleted !== undefined && generation <= deleted) || (stored !== null && generation < stored))
  ) {
    return {
      status: 409,
      body: { error: "Stale draft", draftGeneration: knownGeneration(store, version) },
    };
  }
  store.put(draftKey(version), body);
  if (generation === null) store.delete(deletedKey(version));
  return { status: 200, body: { ok: true } };
}

export function deleteDraft(store: Store, version: number, generation: number | null): void {
  if (generation !== null) {
    const known = knownGeneration(store, version);
    if (known !== null && generation < known) return;
    store.put(deletedKey(version), generation);
  } else {
    store.delete(deletedKey(version));
  }
  store.delete(draftKey(version));
}

export function parseGeneration(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
