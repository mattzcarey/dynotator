import { useCallback, useMemo, useState } from "react";
import { diffPlans } from "../planDiff";

export interface VersionEntry {
  version: number;
  timestamp: string;
}

/**
 * The plan's version history (`/api/plan/versions`) and the diff of the plan
 * on screen against a chosen earlier version (the previous one by default).
 */
export function useVersions(current: string, version: number, previousPlan: string | null) {
  const [base, setBase] = useState<{ version: number; plan: string } | null>(
    previousPlan === null ? null : { version: version - 1, plan: previousPlan },
  );
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadVersions = useCallback(async () => {
    if (versions || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/plan/versions");
      if (res.ok) setVersions(((await res.json()) as { versions: VersionEntry[] }).versions);
    } finally {
      setLoading(false);
    }
  }, [loading, versions]);

  const selectBase = useCallback(async (v: number) => {
    const res = await fetch(`/api/plan/version?v=${v}`);
    if (!res.ok) return;
    const data = (await res.json()) as { plan: string; version: number };
    setBase({ version: data.version, plan: data.plan });
  }, []);

  const diff = useMemo(() => (base ? diffPlans(base.plan, current) : null), [base, current]);

  return { base: base?.version ?? null, diff, versions, loadVersions, selectBase };
}
