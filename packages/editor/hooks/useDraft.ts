import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation } from "@dynotator/ui/types";

const DEBOUNCE_MS = 500;

export interface Draft {
  annotations: Annotation[];
}

interface StoredDraft extends Draft {
  draftGeneration?: number;
  ts?: number;
}

const generationOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

function timeAgo(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Saves unsent annotations to `/api/draft` so a reload or another device can
 * pick them up. Every save carries a growing `draftGeneration`; decisions send
 * the next one, so the server can refuse a save that lands after the decision
 * deleted the draft.
 */
export function useDraft({ draft, enabled }: { draft: Draft; enabled: boolean }) {
  const [offer, setOffer] = useState<{ count: number; timeAgo: string } | null>(null);
  const offeredRef = useRef<Draft | null>(null);
  const generationRef = useRef(0);
  const loadedRef = useRef(false);
  /** A draft exists on the server (loaded or saved), so emptying it deletes it. */
  const storedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(draft);
  latestRef.current = draft;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    fetch("/api/draft")
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as StoredDraft | null;
        const generation = generationOf(data?.draftGeneration);
        if (generation !== null) generationRef.current = Math.max(generationRef.current, generation);
        if (!res.ok || !data || !Array.isArray(data.annotations)) return;
        const restored: Draft = { annotations: data.annotations };
        const count = restored.annotations.length;
        if (count === 0) return;
        offeredRef.current = restored;
        storedRef.current = true;
        setOffer({ count, timeAgo: timeAgo(data.ts ?? 0) });
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  const persist = useCallback((keepalive: boolean, retried = false): void => {
    if (!enabledRef.current) return;
    const { annotations } = latestRef.current;
    const generation = ++generationRef.current;
    if (annotations.length === 0) {
      if (!storedRef.current) return;
      storedRef.current = false;
      void fetch(`/api/draft?generation=${generation}`, { method: "DELETE", keepalive }).catch(
        () => {},
      );
      return;
    }
    storedRef.current = true;
    const body: StoredDraft = {
      annotations,
      draftGeneration: generation,
      ts: Date.now(),
    };
    void fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    })
      .then(async (res) => {
        if (res.status !== 409 || retried) return;
        // Another tab saved ahead of this one: adopt its generation and save again.
        const data = (await res.json().catch(() => null)) as StoredDraft & { decided?: boolean };
        const stale = generationOf(data?.draftGeneration);
        if (data?.decided || stale === null || generationRef.current !== generation) return;
        generationRef.current = Math.max(generationRef.current, stale);
        persist(false, true);
      })
      .catch(() => {});
  }, []);

  const flush = useCallback(
    (keepalive: boolean) => {
      if (timerRef.current === null) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      persist(keepalive);
    },
    [persist],
  );

  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      persist(false);
    }, DEBOUNCE_MS);
  }, [draft.annotations, enabled, persist]);

  useEffect(() => {
    const onHide = () => flush(true);
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flush]);

  const restore = useCallback((): Draft | null => {
    const restored = offeredRef.current;
    offeredRef.current = null;
    setOffer(null);
    return restored;
  }, []);

  const dismiss = useCallback(() => {
    offeredRef.current = null;
    setOffer(null);
    const generation = ++generationRef.current;
    void fetch(`/api/draft?generation=${generation}`, { method: "DELETE" }).catch(() => {});
  }, []);

  /** Stop pending saves; the decision about to be sent deletes the draft. */
  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const getDraftGeneration = useCallback(() => generationRef.current + 1, []);

  return { offer, restore, dismiss, cancelPending, getDraftGeneration };
}
