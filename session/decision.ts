import { HttpError } from "./http";
import { currentRevision, currentVersion, type SessionMeta } from "./plan";
import type { Store } from "./store";

/**
 * What the agent receives from `/api/wait`. Field names follow upstream's `waitForDecision()`
 * results (plan: approved/feedback/permissionMode/answersOnly; annotate: feedback/annotations/
 * exit/approved/...), so the CLI can turn them into hook output the same way.
 */
export interface Decision {
  approved: boolean;
  feedback?: string;
  permissionMode?: string;
  answersOnly?: boolean;
  annotations?: unknown[];
  codeAnnotations?: unknown[];
  selectedMessageId?: string;
  feedbackScope?: "message" | "messages";
  nothingToSend?: boolean;
  exit?: boolean;
  /** The plan version the reviewer decided on. */
  version: number;
  decidedAt: string;
}

export type DecisionKind = "approve" | "deny" | "feedback" | "exit";

const DECISION = "decision";

export function getDecision(store: Store): Decision | undefined {
  return store.get<Decision>(DECISION);
}

export function clearDecision(store: Store): void {
  store.delete(DECISION);
}

const optionalString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const optionalArray = (v: unknown, field: string): unknown[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new HttpError(400, `${field} must be an array`);
  return v;
};

/** Builds the decision a UI request body describes. Pure: no storage access. */
export function buildDecision(
  kind: DecisionKind,
  mode: SessionMeta["mode"],
  body: Record<string, unknown>,
  ctx: { meta: SessionMeta; version: number; now: Date },
): Decision {
  if (body.feedback !== undefined && typeof body.feedback !== "string") {
    throw new HttpError(400, "feedback must be a string");
  }
  const base = { version: ctx.version, decidedAt: ctx.now.toISOString() };
  const feedback = optionalString(body.feedback);

  if (mode === "plan") {
    if (kind === "approve") {
      const permissionMode = optionalString(body.permissionMode) ?? ctx.meta.permissionMode;
      return {
        approved: true,
        ...(feedback ? { feedback } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...base,
      };
    }
    return {
      approved: false,
      feedback: feedback ?? "Plan rejected by user",
      ...(body.answersOnly === true ? { answersOnly: true } : {}),
      ...base,
    };
  }

  if (kind === "exit")
    return { approved: false, exit: true, feedback: "", annotations: [], ...base };
  const annotations = optionalArray(body.annotations, "annotations") ?? [];
  const codeAnnotations = optionalArray(body.codeAnnotations, "codeAnnotations");
  const selectedMessageId = optionalString(body.selectedMessageId);
  const scope = body.feedbackScope;
  const nothingToSend =
    kind === "feedback" &&
    body.nothingToSend === true &&
    annotations.length === 0 &&
    (codeAnnotations?.length ?? 0) === 0;
  return {
    approved: kind === "approve",
    feedback: feedback ?? "",
    annotations,
    ...(codeAnnotations?.length ? { codeAnnotations } : {}),
    ...(selectedMessageId ? { selectedMessageId } : {}),
    ...(scope === "message" || scope === "messages" ? { feedbackScope: scope } : {}),
    ...(nothingToSend ? { nothingToSend: true } : {}),
    ...base,
  };
}

const ALLOWED: Record<SessionMeta["mode"], DecisionKind[]> = {
  plan: ["approve", "deny"],
  annotate: ["approve", "feedback", "exit"],
};

export function allowsDecision(mode: SessionMeta["mode"], kind: DecisionKind): boolean {
  return ALLOWED[mode].includes(kind);
}

export type SettleResult =
  | { ok: true; decision: Decision }
  | { ok: false; status: 409; body: Record<string, unknown> };

/** Records a decision unless one already stands or the reviewer saw a stale revision. */
export function settle(
  store: Store,
  meta: SessionMeta,
  kind: DecisionKind,
  body: Record<string, unknown>,
  now = new Date(),
): SettleResult {
  if (getDecision(store)) {
    return {
      ok: false,
      status: 409,
      body: { error: "This review session has already been decided.", code: "already_decided" },
    };
  }
  const revision = currentRevision(store);
  if (typeof body.planRevision === "number" && body.planRevision !== revision) {
    return {
      ok: false,
      status: 409,
      body: {
        error:
          "The plan was revised while you were reviewing it. Review the new version, then decide again.",
        code: "plan_revised",
        planRevision: revision,
      },
    };
  }
  const decision = buildDecision(kind, meta.mode, body, {
    meta,
    version: currentVersion(store),
    now,
  });
  store.put(DECISION, decision);
  return { ok: true, decision };
}

export const DEFAULT_WAIT_SECONDS = 25;
export const MAX_WAIT_SECONDS = 55;

export function parseWaitSeconds(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_WAIT_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WAIT_SECONDS;
  return Math.min(n, MAX_WAIT_SECONDS);
}

/** In-memory long-poll waiters. They live as long as the facet instance does. */
export class Waiters {
  private readonly pending = new Set<(d: Decision) => void>();

  get size(): number {
    return this.pending.size;
  }

  /** Resolves with the decision, or `undefined` after `seconds`. */
  wait(seconds: number): Promise<Decision | undefined> {
    return new Promise((resolve) => {
      const done = (d: Decision | undefined) => {
        clearTimeout(timer);
        this.pending.delete(done);
        resolve(d);
      };
      const timer = setTimeout(() => done(undefined), seconds * 1000);
      this.pending.add(done);
    });
  }

  resolveAll(decision: Decision): void {
    for (const done of this.pending) done(decision);
  }
}
