import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
}

type Changes =
  | { status: "loading" }
  | { status: "ready"; files: ChangedFile[] }
  | { status: "error"; message: string };

/**
 * The version on screen against a chosen earlier one: whether the changes are shown, and which
 * files changed (`/api/changes`), fetched when first shown. A change review compares against
 * version 0, the state before the change, and opens on it; otherwise the previous version.
 */
export function useVersions(
  version: number,
  versions: readonly { version: number }[],
  hasBase: boolean,
) {
  const [base, setBase] = useState<number | null>(() =>
    hasBase ? 0 : versions.some((v) => v.version === version - 1) ? version - 1 : null,
  );
  const [active, setActive] = useState(hasBase);
  const [loaded, setLoaded] = useState<ReadonlyMap<number, Changes>>(new Map());
  const requested = useRef(new Set<number>());

  useEffect(() => {
    if (!active || base === null || requested.current.has(base)) return;
    requested.current.add(base);
    const settle = (changes: Changes) => setLoaded((prev) => new Map(prev).set(base, changes));
    fetch(api(`/api/changes?from=${base}&to=${version}`))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load the changes (${res.status}).`);
        const { files } = (await res.json()) as { files: ChangedFile[] };
        settle({ status: "ready", files });
      })
      .catch((error: unknown) => {
        // Asked again the next time the changes are shown.
        requested.current.delete(base);
        settle({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the changes.",
        });
      });
  }, [active, base, version]);

  const changes: Changes = (base !== null && loaded.get(base)) || { status: "loading" };
  return {
    base,
    active: active && base !== null,
    changes,
    selectBase: setBase,
    show: setActive,
  };
}
