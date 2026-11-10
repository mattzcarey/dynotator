import { useEffect, useEffectEvent, useRef } from "react";
import { api } from "../api";
import type { Notify } from "./Notices";

const POLL_MS = 2000;

/**
 * The agent can put a new version up for review in the same session, which bumps the revision.
 * After a denial the page loads it at once; mid-review it offers it, since loading drops an open
 * comment composer (saved annotations come back through the draft).
 */
export function useRevision({
  revision,
  denied,
  active,
  notify,
}: {
  revision: number;
  denied: boolean;
  active: boolean;
  notify: Notify;
}) {
  const offeredRef = useRef<number | null>(null);
  const onRevised = useEffectEvent((next: number) => {
    if (denied) {
      window.location.reload();
      return;
    }
    if (offeredRef.current === next) return;
    offeredRef.current = next;
    notify("revision", {
      text: "The agent put up a new version. Load it; your saved comments come with it.",
      actions: [{ label: "Load", onClick: () => window.location.reload() }],
    });
  });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(api("/api/revision"));
        if (!res.ok) return;
        const { revision: next } = (await res.json()) as { revision: number };
        if (!stopped && next > revision) onRevised(next);
      } catch {
        // The next poll retries.
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, revision]);
}
