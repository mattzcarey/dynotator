import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { annotateOutcome, sessionApiUrl } from "./commands.ts";
import {
  clearState,
  hookOutput,
  parseHookEvent,
  planDeniedMessage,
  readState,
  resolvePlan,
  writeState,
} from "./hook.ts";

const dir = mkdtempSync(join(tmpdir(), "dynotator-hook-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const event = {
  hook_event_name: "PermissionRequest",
  tool_name: "ExitPlanMode",
  session_id: "abc",
  permission_mode: "plan",
  tool_input: { plan: "# Plan\n\nDo it.", planFilePath: "/nonexistent/plan.md" },
};

describe("parseHookEvent", () => {
  test("parses an ExitPlanMode PermissionRequest", () => {
    expect(parseHookEvent(JSON.stringify(event))).toEqual(event);
  });
  test("empty stdin is no event", () => {
    expect(parseHookEvent("  \n")).toBeNull();
  });
  test("invalid JSON throws a readable error", () => {
    expect(() => parseHookEvent("{nope")).toThrow("Failed to parse hook event from stdin");
    expect(() => parseHookEvent("[1]")).toThrow("not a JSON object");
  });
});

describe("resolvePlan", () => {
  test("falls back to the inline plan when the file is missing", () => {
    expect(resolvePlan(event.tool_input)).toBe("# Plan\n\nDo it.");
  });
  test("prefers the plan file when it is an absolute .md file", () => {
    const path = join(dir, "plan.md");
    writeFileSync(path, "# From file");
    expect(resolvePlan({ plan: "# Stale", planFilePath: path })).toBe("# From file");
  });
  test("ignores relative and non-markdown paths", () => {
    const path = join(dir, "plan.txt");
    writeFileSync(path, "text");
    expect(resolvePlan({ plan: "inline", planFilePath: path })).toBe("inline");
    expect(resolvePlan({ plan: "inline", planFilePath: "plan.md" })).toBe("inline");
  });
  test("no plan at all is empty", () => {
    expect(resolvePlan(undefined)).toBe("");
  });
});

describe("hookOutput", () => {
  test("approve echoes tool_input with the reviewed plan", () => {
    expect(JSON.parse(hookOutput(event, "# Reviewed", { approved: true }))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedInput: { plan: "# Reviewed", planFilePath: "/nonexistent/plan.md" },
        },
      },
    });
  });

  test("approve with a permission mode sets it for the session", () => {
    const out = JSON.parse(
      hookOutput(event, "# P", { approved: true, permissionMode: "acceptEdits", extra: 1 }),
    );
    expect(out.hookSpecificOutput.decision.updatedPermissions).toEqual([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
  });

  test("deny carries the feedback in upstream's denied prompt", () => {
    const out = JSON.parse(hookOutput(event, "# P", { approved: false, feedback: "Add tests." }));
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message:
            "YOUR PLAN WAS NOT APPROVED.\n\nYou MUST revise the plan to address ALL of the feedback below before calling ExitPlanMode again.\n\nRules:\n- Do not resubmit the same plan unchanged.\n- Do NOT change the plan title (first # heading) unless the user explicitly asks you to.\n\nAdd tests.",
        },
      },
    });
  });

  test("deny without feedback and answers-only deny", () => {
    expect(planDeniedMessage({ approved: false })).toEndWith("\n\nPlan changes requested");
    expect(
      planDeniedMessage({ approved: false, answersOnly: true, feedback: "A: yes" }),
    ).toStartWith("The user answered the questions in your plan");
  });
});

describe("annotateOutcome", () => {
  test("matches upstream's plaintext output", () => {
    expect(annotateOutcome({ approved: true }, "/a.md")).toBe("The user approved.");
    expect(annotateOutcome({ approved: false, feedback: "# Markdown Annotations" }, "/a.md")).toBe(
      "# Markdown Annotations",
    );
    expect(annotateOutcome({ approved: false }, undefined)).toBeNull();
    expect(annotateOutcome({ approved: false, exit: true, feedback: "x" }, undefined)).toBeNull();
    expect(annotateOutcome({ approved: true, feedback: "nit $&" }, "/a.md")).toContain(
      "File: /a.md\n\nnit $&\n\n",
    );
  });
});

describe("sessionApiUrl", () => {
  test("accepts session and api URLs and bare ids", () => {
    expect(sessionApiUrl("https://x.dev/s/abc_1", undefined)).toBe("https://x.dev/s/abc_1/api");
    expect(sessionApiUrl("https://x.dev/s/abc/api/wait", undefined)).toBe(
      "https://x.dev/s/abc/api",
    );
    expect(sessionApiUrl("abc", "https://x.dev")).toBe("https://x.dev/s/abc/api");
    expect(() => sessionApiUrl("abc", undefined)).toThrow("DYNOTATOR_URL");
    expect(() => sessionApiUrl("https://x.dev/other", undefined)).toThrow("not a session URL");
  });
});

describe("session state", () => {
  test("round-trips and clears", () => {
    const state = { id: "s1", url: "u", apiUrl: "a", baseUrl: "b" };
    expect(readState(dir, "claude-1")).toBeUndefined();
    writeState(dir, "claude-1", state);
    expect(readState(dir, "claude-1")).toEqual(state);
    clearState(dir, "claude-1");
    expect(readState(dir, "claude-1")).toBeUndefined();
  });
});
