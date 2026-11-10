import { useEffect, useState } from "react";

const POLL_MS = 5000;

/**
 * After a denial the agent revises the plan into the same session. Watch for
 * a newer version so the done screen can offer it.
 */
export function useRevisionWatch({ active, version }: { active: boolean; version: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch("/api/plan");
        if (!res.ok) return;
        const data = (await res.json()) as { versionInfo?: { version?: unknown } };
        const next = data.versionInfo?.version;
        if (!stopped && typeof next === "number" && next > version) setReady(true);
      } catch {
        // The next poll retries.
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, version]);
  return ready;
}
