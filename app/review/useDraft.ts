import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { api } from "../api";
import { fromWire, toWire, type Annotation } from "./annotations";

const DEBOUNCE_MS = 500;

/**
 * Keeps the unsent annotations in `/api/draft` so a reload or another device picks them up: read
 * once on load (`onRestore`; what is already in the log is the caller's to drop), written a
 * moment after each change, last write wins. Not a source of truth: the log says what was sent.
 */
export function useDraft({
  annotations,
  enabled,
  onRestore,
}: {
  annotations: Annotation[];
  enabled: boolean;
  onRestore: (annotations: Annotation[]) => void;
}) {
  const loadedRef = useRef(false);
  /** What the server holds, as JSON, so an unchanged list is not written again. */
  const savedRef = useRef("[]");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restore = useEffectEvent(onRestore);
  const latestRef = useRef({ annotations, enabled });
  useEffect(() => {
    latestRef.current = { annotations, enabled };
  });

  useEffect(() => {
    fetch(api("/api/draft"))
      .then(async (res) => {
        if (!res.ok) return;
        const { annotations: stored } = (await res.json()) as { annotations?: unknown[] };
        const list = (Array.isArray(stored) ? stored : []).flatMap((a) => fromWire(a) ?? []);
        savedRef.current = JSON.stringify(list.map(toWire));
        if (list.length > 0) restore(list);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  const save = useCallback((list: Annotation[], keepalive = false, force = false) => {
    const body = JSON.stringify(list.map(toWire));
    if (body === savedRef.current && !force) return;
    savedRef.current = body;
    void fetch(api("/api/draft"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"annotations":${body}}`,
      keepalive,
    }).catch(() => {});
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /**
   * Write now: the page is about to hide, or (`carry`) to load a new version, whose draft starts
   * empty: writing again puts the unsent annotations there.
   */
  const flush = useCallback(
    (carry = false) => {
      cancel();
      const { annotations: list, enabled: on } = latestRef.current;
      if (on && loadedRef.current && (!carry || list.length > 0)) save(list, true, carry);
    },
    [cancel, save],
  );

  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save(annotations);
    }, DEBOUNCE_MS);
  }, [annotations, cancel, enabled, save]);

  useEffect(() => {
    const onHide = () => timerRef.current !== null && flush();
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      cancel();
    };
  }, [cancel, flush]);

  return { flush };
}
