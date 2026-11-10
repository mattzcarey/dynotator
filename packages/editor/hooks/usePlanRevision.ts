import { useEffect, useRef } from "react";
import { toast } from "sonner";

const POLL_MS = 2000;

/**
 * The agent revises a plan into the same session (`POST /api/revise`), which
 * bumps `planRevision`. After a denial the page loads the revision at once;
 * mid-review it offers it, since loading drops an open comment composer
 * (saved annotations come back through the draft).
 */
export function usePlanRevision({
  revision,
  denied,
  active,
}: {
  revision: number | null;
  denied: boolean;
  active: boolean;
}) {
  const deniedRef = useRef(denied);
  deniedRef.current = denied;
  const offeredRef = useRef<number | null>(null);
  useEffect(() => {
    if (revision === null || !active) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch("/api/plan/revision");
        if (!res.ok) return;
        const data = (await res.json()) as { revision?: unknown };
        const next = data.revision;
        if (stopped || typeof next !== "number" || next <= revision) return;
        if (deniedRef.current) {
          window.location.reload();
          return;
        }
        if (offeredRef.current === next) return;
        offeredRef.current = next;
        toast("The agent revised the plan", {
          description: "Load the new version. Your saved comments come back with it.",
          duration: Infinity,
          action: { label: "Load", onClick: () => window.location.reload() },
        });
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
