import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "../api";
import { mergeEvents, parseEvents, type ReviewEvent } from "./events";
import type { Notify } from "./Notices";

const POLL_MS = 2000;

/**
 * The review's log, kept current: one `GET /api/revision` per poll says whether the log grew
 * (another tab's or reviewer's submission, a closure) and whether the agent put up a new
 * version, which is offered rather than loaded, since loading drops an open composer.
 */
export function useEvents({
  version,
  initial,
  notify,
  onLoad,
}: {
  version: number;
  initial: ReviewEvent[];
  notify: Notify;
  /** Loads the new version (the page reloads). */
  onLoad: () => void;
}) {
  const [log, setLog] = useState(() => mergeEvents([], initial));
  const cursorRef = useRef(log.cursor);
  const closed = log.events.some((e) => e.type === "closed");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api(`/api/events?after=${cursorRef.current}`));
      if (!res.ok) return;
      const incoming = parseEvents(await res.json());
      setLog((prev) => {
        const next = mergeEvents(prev.events, incoming);
        cursorRef.current = next.cursor;
        return next;
      });
    } catch {
      // The next poll retries.
    }
  }, []);

  const offeredRef = useRef<number | null>(null);
  const onRevised = useEffectEvent((next: number) => {
    if (offeredRef.current === next) return;
    offeredRef.current = next;
    notify("revision", {
      text: "The agent put up a new version. Load it; your unsent comments come with it.",
      actions: [{ label: "Load", onClick: onLoad }],
    });
  });

  useEffect(() => {
    if (closed) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(api("/api/revision"));
        if (!res.ok || stopped) return;
        const { revision, seq } = (await res.json()) as { revision: number; seq: number };
        if (seq > cursorRef.current) await refresh();
        if (!stopped && revision > version) onRevised(revision);
      } catch {
        // The next poll retries.
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [closed, refresh, version]);

  return { events: log.events, closed, refresh };
}
