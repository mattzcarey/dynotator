import { createContext } from "react";

/**
 * Maps a link's destination to an in-app `#/path` hash when it points at a file of the review,
 * or null to leave it an ordinary link. Absent outside a review file.
 */
export const LinkResolver = createContext<((href: string) => string | null) | null>(null);

/** Follow an in-app link even when the hash already says so (a second click on one anchor). */
export function followInternal(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
