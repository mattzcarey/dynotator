import { useCallback, useEffect, useMemo, useState } from "react";
import { formatHash, parseHash, type Location } from "./paths";

/**
 * The location in the hash (`#/path:L1-2`, `#/path#anchor`), or the review's first file. The
 * scroll target is a new object on every hash change, a repeated one included.
 */
export function useHashLocation(fallback: string, has: (path: string) => boolean) {
  const [hash, setHash] = useState(() => ({ value: location.hash, seq: 0 }));
  useEffect(() => {
    const onChange = () => setHash(({ seq }) => ({ value: location.hash, seq: seq + 1 }));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  // A new object per hash change: the views scroll when it changes.
  const parsed = useMemo(() => parseHash(hash.value), [hash]);
  const known = parsed && has(parsed.path) ? parsed : null;
  const at: Location = known ?? { path: fallback };
  const target = known && (known.lines || known.anchor) ? known : null;
  const navigate = useCallback((next: Location) => {
    const value = formatHash(next);
    if (location.hash === value) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = value;
  }, []);
  return { at, target, navigate };
}
