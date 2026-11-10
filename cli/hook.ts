import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Decision, Session } from "./http.ts";

export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  session_id?: string;
  permission_mode?: string;
  cwd?: string;
  tool_input?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseHookEvent(text: string): HookEvent | null {
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse hook event from stdin: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Failed to parse hook event from stdin: not a JSON object");
  }
  return parsed as HookEvent;
}

const MAX_PLAN_FILE_BYTES = 2 * 1024 * 1024;

// Older Claude Code versions fill the inline `plan` before an edit to the plan file in the
// same message lands; the file named by `planFilePath` is current when the hook runs.
export function resolvePlan(toolInput: Record<string, unknown> | undefined): string {
  const inline = typeof toolInput?.plan === "string" ? toolInput.plan : "";
  const path = toolInput?.planFilePath;
  if (typeof path !== "string" || !isAbsolute(path) || !/\.md$/i.test(path)) return inline;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_PLAN_FILE_BYTES) return inline;
    return readFileSync(path, "utf8") || inline;
  } catch {
    return inline;
  }
}

const PLAN_DENIED_PROMPT =
  "YOUR PLAN WAS NOT APPROVED.\n\nYou MUST revise the plan to address ALL of the feedback below before calling {{toolName}} again.\n\nRules:\n{{planFileRule}}- Do not resubmit the same plan unchanged.\n- Do NOT change the plan title (first # heading) unless the user explicitly asks you to.\n\n{{feedback}}";

const PLAN_ANSWERED_PROMPT =
  'The user answered the questions in your plan and asked for no other changes. Their answers are below.\n\nRevise the plan so each answered question becomes a decision, then call {{toolName}} again.\n\nRules:\n{{planFileRule}}- For each answered question, either remove its `:::question` block and write the decision into the plan, or keep the block and mark the chosen choice `- [x]` (a checked choice reads as settled).\n- Keep every question listed under "Unanswered" as it is.\n- Treat a note on an answer as guidance from the user.\n- Do NOT change the plan title (first # heading) unless the user explicitly asks you to.\n\n{{feedback}}';

export function planDeniedMessage(decision: Decision): string {
  const vars: Record<string, string> = {
    toolName: "ExitPlanMode",
    planFileRule: "",
    feedback: decision.feedback || "Plan changes requested",
  };
  const template = decision.answersOnly === true ? PLAN_ANSWERED_PROMPT : PLAN_DENIED_PROMPT;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function hookOutput(event: HookEvent, plan: string, decision: Decision): string {
  if (!decision.approved) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: planDeniedMessage(decision) },
      },
    });
  }
  const mode = typeof decision.permissionMode === "string" ? decision.permissionMode : "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow",
        // Claude Code drops an ExitPlanMode allow that has no updatedInput.
        updatedInput: { ...event.tool_input, plan },
        ...(mode && {
          updatedPermissions: [{ type: "setMode", mode, destination: "session" }],
        }),
      },
    },
  });
}

// The session a Claude Code session's last denied plan went to, so the next ExitPlanMode
// is submitted as a revision and the reviewer sees the version diff.
export interface SessionState extends Session {
  baseUrl: string;
}

const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultStateDir(env: Record<string, string | undefined>, home: string): string {
  const base =
    process.platform === "win32"
      ? env.LOCALAPPDATA || join(home, "AppData", "Local")
      : process.platform === "darwin"
        ? join(home, "Library", "Caches")
        : env.XDG_CACHE_HOME || join(home, ".cache");
  return join(base, "dynotator", "sessions");
}

function statePath(dir: string, claudeSessionId: string): string {
  return join(
    dir,
    `${createHash("sha256").update(claudeSessionId).digest("hex").slice(0, 32)}.json`,
  );
}

export function readState(dir: string, claudeSessionId: string): SessionState | undefined {
  try {
    const path = statePath(dir, claudeSessionId);
    if (Date.now() - statSync(path).mtimeMs > STATE_MAX_AGE_MS) return undefined;
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionState>;
    if (
      typeof data.baseUrl !== "string" ||
      typeof data.url !== "string" ||
      typeof data.apiUrl !== "string"
    ) {
      return undefined;
    }
    return { id: String(data.id ?? ""), url: data.url, apiUrl: data.apiUrl, baseUrl: data.baseUrl };
  } catch {
    return undefined;
  }
}

export function writeState(dir: string, claudeSessionId: string, state: SessionState): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(statePath(dir, claudeSessionId), JSON.stringify(state), { mode: 0o600 });
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (Date.now() - statSync(path).mtimeMs > STATE_MAX_AGE_MS) rmSync(path, { force: true });
    }
  } catch {
    // Without state the next revision opens a new session; nothing else depends on it.
  }
}

export function clearState(dir: string, claudeSessionId: string): void {
  try {
    rmSync(statePath(dir, claudeSessionId), { force: true });
  } catch {
    // See writeState.
  }
}
