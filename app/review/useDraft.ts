import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { api } from "../api";
import type { Annotation } from "./annotations";
import type { Notify } from "./Notices";

const DEBOUNCE_MS = 500;

/** `GET /api/draft`: the draft, or only the latest generation (`{}` before any save). */
interface StoredDraft {
  annotations?: Annotation[];
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
 * Saves unsent annotations to `/api/draft` so a reload or another device can pick them up, and
 * offers a saved draft on load. Every save carries a growing `draftGeneration`; decisions send
 * the next one, so the server can refuse a save that lands after the decision deleted the draft.
 */
export function useDraft({
  annotations,
  enabled,
  notify,
  onRestore,
}: {
  annotations: Annotation[];
  enabled: boolean;
  notify: Notify;
  onRestore: (annotations: Annotation[]) => void;
}) {
  const generationRef = useRef(0);
  const loadedRef = useRef(false);
  /** A draft exists on the server (loaded or saved), so emptying it deletes it. */
  const storedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const discard = () => {
    storedRef.current = false;
    const generation = ++generationRef.current;
    void fetch(api(`/api/draft?generation=${generation}`), { method: "DELETE" }).catch(() => {});
  };

  const offer = useEffectEvent((saved: Annotation[], ts: number) => {
    storedRef.current = true;
    notify("draft", {
      text: `${saved.length} unsent ${saved.length === 1 ? "annotation" : "annotations"} from ${timeAgo(ts)}.`,
      actions: [
        { label: "Discard", onClick: discard },
        { label: "Restore", onClick: () => onRestore(saved) },
      ],
    });
  });

  useEffect(() => {
    fetch(api("/api/draft"))
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as StoredDraft;
        const generation = generationOf(data.draftGeneration);
        if (generation !== null)
          generationRef.current = Math.max(generationRef.current, generation);
        if (data.annotations?.length) offer(data.annotations, data.ts ?? 0);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  const persist = useCallback((list: Annotation[], keepalive: boolean): void => {
    const save = (retried: boolean) => {
      const generation = ++generationRef.current;
      if (list.length === 0) {
        if (!storedRef.current) return;
        storedRef.current = false;
        void fetch(api(`/api/draft?generation=${generation}`), {
          method: "DELETE",
          keepalive,
        }).catch(() => {});
        return;
      }
      storedRef.current = true;
      const body = { annotations: list, draftGeneration: generation, ts: Date.now() };
      void fetch(api("/api/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive,
      })
        .then(async (res) => {
          if (res.status !== 409 || retried) return;
          // Another tab saved ahead of this one: adopt its generation and save again.
          const data = (await res.json().catch(() => null)) as {
            draftGeneration?: number;
            decided?: boolean;
          } | null;
          const stale = generationOf(data?.draftGeneration);
          if (data?.decided || stale === null || generationRef.current !== generation) return;
          generationRef.current = Math.max(generationRef.current, stale);
          save(true);
        })
        .catch(() => {});
    };
    save(false);
  }, []);
  const flush = useEffectEvent(() => enabled && persist(annotations, true));

  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      persist(annotations, false);
    }, DEBOUNCE_MS);
  }, [annotations, enabled, persist]);

  useEffect(() => {
    const onHide = () => {
      if (timerRef.current === null) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      flush();
    };
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** Stop pending saves; the decision about to be sent deletes the draft. */
  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const getDraftGeneration = useCallback(() => generationRef.current + 1, []);

  return { cancelPending, getDraftGeneration };
}
