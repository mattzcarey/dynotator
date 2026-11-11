import { type Annotation, parseAnnotations } from "./events";
import { HttpError } from "./http";
import type { Store } from "./store";

/**
 * Unsent annotations, one blob per version, last write wins. A convenience, not a source of
 * truth: whether an annotation is sent is decided by the event log, so a draft that still holds
 * sent annotations is harmless.
 */
const draftKey = (version: number) => `draft:${version}`;

export function loadDraft(store: Store, version: number): { annotations: Annotation[] } {
  return { annotations: store.get<Annotation[]>(draftKey(version)) ?? [] };
}

export function saveDraft(store: Store, version: number, body: Record<string, unknown>): void {
  if (body.annotations === undefined) throw new HttpError(400, "annotations must be an array");
  store.put(draftKey(version), parseAnnotations(body.annotations));
}

export function clearDraft(store: Store, version: number): void {
  store.delete(draftKey(version));
}
