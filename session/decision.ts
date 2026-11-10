import { HttpError } from "./http";
import type { ReviewMode } from "./files";
import { currentVersion } from "./review";
import type { Store } from "./store";

/**
 * The reviewer's decision, as `getDecision` and `waitForDecision` return it.
 *
 * - Plan review: `approved` is true on approval, with the reviewer's notes in `feedback` if
 *   they left any; on a request for changes it is false, with the requested changes in
 *   `feedback` and `answersOnly` set when the reviewer only answered the plan's questions.
 * - Annotate review: `approved` is always false. Sent feedback carries `feedback` (the
 *   annotations rendered as markdown) and the raw `annotations`; closing the review without
 *   sending anything sets `exit`.
 */
export interface Decision {
  approved: boolean;
  feedback?: string;
  answersOnly?: boolean;
  /** As the browser sent them; each carries the `path` of the file it annotates. */
  annotations?: unknown[];
  exit?: boolean;
  /** The version the reviewer decided on (1 for the files the review started with). */
  version: number;
  /** ISO 8601. */
  decidedAt: string;
}

/** What `revise` returns: the version now under review, and whether the snapshot was the same. */
export interface Revision {
  version: number;
  unchanged: boolean;
}

export type DecisionKind = "approve" | "deny" | "feedback" | "exit";

/** The decisions the browser can post in each mode. */
export const DECISION_KINDS: Record<ReviewMode, DecisionKind[]> = {
  plan: ["approve", "deny"],
  annotate: ["feedback", "exit"],
};

const DECISION = "decision";

export function getDecision(store: Store): Decision | undefined {
  return store.get<Decision>(DECISION);
}

/**
 * Records the decision a browser request body describes. Refused (409) if a decision already
 * stands, or if the reviewer decided on a version the agent has since replaced.
 */
export function settle(store: Store, kind: DecisionKind, body: Record<string, unknown>): Decision {
  if (getDecision(store)) {
    throw new HttpError(409, "This review has already been decided.", { code: "already_decided" });
  }
  const version = currentVersion(store);
  if (typeof body.revision === "number" && body.revision !== version) {
    throw new HttpError(
      409,
      "The files were revised while you were reviewing them. Review the new version, then decide again.",
      { code: "revised", revision: version },
    );
  }
  const decision: Decision = {
    ...describe(kind, body),
    version,
    decidedAt: new Date().toISOString(),
  };
  store.put(DECISION, decision);
  return decision;
}

function describe(
  kind: DecisionKind,
  body: Record<string, unknown>,
): Omit<Decision, "version" | "decidedAt"> {
  if (kind === "exit") return { approved: false, exit: true };
  if (body.feedback !== undefined && typeof body.feedback !== "string") {
    throw new HttpError(400, "feedback must be a string");
  }
  const feedback = body.feedback ? { feedback: body.feedback } : {};
  if (kind === "approve") return { approved: true, ...feedback };
  if (kind === "deny") {
    return {
      approved: false,
      ...feedback,
      ...(body.answersOnly === true && { answersOnly: true }),
    };
  }
  const annotations = body.annotations ?? [];
  if (!Array.isArray(annotations)) throw new HttpError(400, "annotations must be an array");
  return { approved: false, ...feedback, annotations };
}

/**
 * Whether the review can take a new version. Refused once a review is over. The decision is
 * cleared only by an actual new version: an unchanged snapshot leaves it standing, since the open
 * page would have nothing new to load and the reviewer no way to tell the review had reopened.
 */
export function assertRevisable(store: Store): void {
  const decision = getDecision(store);
  if (decision && (decision.approved || decision.exit)) {
    throw new Error("This review has finished and cannot be revised.");
  }
}

export function clearDecision(store: Store): void {
  store.delete(DECISION);
}
