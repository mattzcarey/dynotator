import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type Context } from "./commands.ts";
import { createSession, waitForDecision, type Decision, type Fetch } from "./http.ts";

// A fake host + session server implementing the contract in AGENTS.md. A session answers
// `pending` until the test queues a decision; `pendingPolls` makes it answer pending that
// many more times first.
interface FakeSession {
  body: Record<string, unknown>;
  revisions: string[];
  decisions: Decision[];
  decision?: Decision;
  pendingPolls: number;
}
const sessions = new Map<string, FakeSession>();
const requests: { method: string; path: string; auth: string | null }[] = [];
let nextId = 0;
let failNextWait = 0;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    requests.push({
      method: req.method,
      path: url.pathname + url.search,
      auth: req.headers.get("authorization"),
    });
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      if (req.headers.get("authorization") === "Bearer wrong")
        return new Response("no", { status: 401 });
      const id = `sess${++nextId}`;
      const body = (await req.json()) as Record<string, unknown>;
      sessions.set(id, { body, revisions: [], decisions: [], pendingPolls: 0 });
      const origin = url.origin;
      return Response.json(
        { id, url: `${origin}/s/${id}`, apiUrl: `${origin}/s/${id}/api` },
        { status: 201 },
      );
    }
    const match = /^\/s\/([^/]+)\/api\/(wait|revise)$/.exec(url.pathname);
    const session = match && sessions.get(match[1]);
    if (!match || !session) return new Response("not found", { status: 404 });
    if (match[2] === "revise") {
      session.revisions.push(((await req.json()) as { markdown: string }).markdown);
      session.decision = undefined;
      return Response.json({ ok: true });
    }
    if (failNextWait > 0) {
      failNextWait--;
      return new Response("upstream down", { status: 503 });
    }
    if (session.pendingPolls > 0 || (!session.decision && session.decisions.length === 0)) {
      session.pendingPolls = Math.max(0, session.pendingPolls - 1);
      return Response.json({ status: "pending" });
    }
    session.decision ??= session.decisions.shift();
    return Response.json({ status: "decided", decision: session.decision, extra: true });
  },
});
const base = `http://localhost:${server.port}`;
const stateDir = mkdtempSync(join(tmpdir(), "dynotator-cli-test-"));
afterAll(() => {
  server.stop(true);
  rmSync(stateDir, { recursive: true, force: true });
});
beforeEach(() => {
  requests.length = 0;
  failNextWait = 0;
});

const noSleep = async () => {};

function context(stdin: string, env: Record<string, string> = {}) {
  const out = { stdout: "", stderr: "", opened: [] as string[] };
  const ctx: Context = {
    env: { DYNOTATOR_URL: base, ...env },
    cwd: stateDir,
    stateDir,
    version: "test",
    stdinIsTTY: false,
    readStdin: async () => stdin,
    stdout: (text) => (out.stdout += text),
    stderr: (text) => (out.stderr += text),
    openBrowser: (url) => out.opened.push(url),
    sleep: noSleep,
  };
  return { ctx, out };
}

function queueDecision(decision: Decision, pendingPolls = 0) {
  const session = sessions.get(`sess${nextId}`)!;
  session.decisions.push(decision);
  session.pendingPolls = pendingPolls;
}

// Queue the decision for the session the command is about to create or revise.
function decideNext(id: string, decision: Decision) {
  const timer = setInterval(() => {
    const session = sessions.get(id);
    if (!session) return;
    clearInterval(timer);
    session.decisions.push(decision);
  }, 1);
}

describe("waitForDecision", () => {
  test("polls through pending until decided", async () => {
    const session = await createSession(base, undefined, { mode: "plan", markdown: "# P" });
    queueDecision({ approved: true, permissionMode: "acceptEdits" }, 2);
    const decision = await waitForDecision(session.apiUrl, { sleep: noSleep });
    expect(decision).toEqual({ approved: true, permissionMode: "acceptEdits" });
    expect(requests.filter((r) => r.path.endsWith("/wait?timeout=25"))).toHaveLength(3);
  });

  test("retries transient network errors and 5xx", async () => {
    const session = await createSession(base, undefined, { mode: "plan", markdown: "# P" });
    queueDecision({ approved: false, feedback: "no" });
    failNextWait = 1;
    let thrown = 0;
    const flaky: Fetch = async (input, init) => {
      if (thrown++ === 0) throw new TypeError("fetch failed");
      return fetch(input, init);
    };
    const retries: number[] = [];
    const decision = await waitForDecision(session.apiUrl, {
      fetch: flaky,
      sleep: noSleep,
      onRetry: (_error, attempt) => retries.push(attempt),
    });
    expect(decision).toEqual({ approved: false, feedback: "no" });
    expect(retries).toEqual([1, 2]);
  });

  test("gives up on a missing session and after too many failures", async () => {
    await expect(waitForDecision(`${base}/s/nope/api`, { sleep: noSleep })).rejects.toThrow(
      "HTTP 404",
    );
    await expect(
      waitForDecision(`${base}/s/x/api`, { fetch: down, sleep: noSleep, maxFailures: 3 }),
    ).rejects.toThrow("fetch failed");
  });
});

const down: Fetch = async () => {
  throw new TypeError("fetch failed");
};

const event = (plan: string) =>
  JSON.stringify({
    hook_event_name: "PermissionRequest",
    tool_name: "ExitPlanMode",
    session_id: "claude-session-1",
    permission_mode: "plan",
    cwd: stateDir,
    tool_input: { plan },
  });

describe("plan hook", () => {
  test("deny, then the revised plan goes to the same session and approval clears it", async () => {
    const first = context(event("# V1"), { DYNOTATOR_TOKEN: "secret" });
    decideNext(`sess${nextId + 1}`, { approved: false, feedback: "Split step 2." });
    expect(await run([], first.ctx)).toBe(0);
    const id = `sess${nextId}`;
    expect(sessions.get(id)!.body).toEqual({
      mode: "plan",
      markdown: "# V1",
      origin: "claude-code",
      permissionMode: "plan",
      project: expect.any(String),
    });
    expect(requests[0].auth).toBe("Bearer secret");
    expect(requests.slice(1).every((r) => r.auth === null)).toBe(true);
    const denied = JSON.parse(first.out.stdout);
    expect(denied.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(denied.hookSpecificOutput.decision.message).toEndWith("\n\nSplit step 2.");
    expect(first.out.stderr).toContain(`${base}/s/${id}`);
    expect(first.out.opened).toEqual([`${base}/s/${id}`]);

    const second = context(event("# V2"));
    decideNext(id, { approved: true, permissionMode: "acceptEdits" });
    expect(await run(["plan"], second.ctx)).toBe(0);
    expect(`sess${nextId}`).toBe(id);
    expect(sessions.get(id)!.revisions).toEqual(["# V2"]);
    expect(JSON.parse(second.out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedInput: { plan: "# V2" },
          updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
        },
      },
    });

    const third = context(event("# Next plan"), { DYNOTATOR_NO_BROWSER: "1" });
    decideNext(`sess${nextId + 1}`, { approved: true });
    expect(await run([], third.ctx)).toBe(0);
    expect(`sess${nextId}`).not.toBe(id);
    expect(third.out.opened).toEqual([]);
  });

  test("failures exit 1 with nothing on stdout", async () => {
    const noUrl = context(event("# P"));
    noUrl.ctx.env = {};
    expect(await run([], noUrl.ctx)).toBe(1);
    expect(noUrl.out.stdout).toBe("");
    expect(noUrl.out.stderr).toContain("DYNOTATOR_URL");

    const badToken = context(
      JSON.stringify({ tool_name: "ExitPlanMode", tool_input: { plan: "#" } }),
      {
        DYNOTATOR_TOKEN: "wrong",
      },
    );
    expect(await run([], badToken.ctx)).toBe(1);
    expect(badToken.out.stdout).toBe("");
    expect(badToken.out.stderr).toContain("HTTP 401");

    const garbage = context("{");
    expect(await run([], garbage.ctx)).toBe(1);
    expect(garbage.out.stdout).toBe("");

    const empty = context("");
    expect(await run([], empty.ctx)).toBe(0);
    expect(empty.out.stdout).toBe("");
  });
});

describe("annotate", () => {
  test("prints the reviewer's feedback", async () => {
    const file = join(stateDir, "notes.md");
    writeFileSync(file, "# Notes");
    const { ctx, out } = context("", { DYNOTATOR_NO_BROWSER: "1" });
    decideNext(`sess${nextId + 1}`, {
      approved: false,
      feedback: "# Markdown Annotations\n\nFix.",
    });
    expect(await run(["annotate", "notes.md"], ctx)).toBe(0);
    expect(sessions.get(`sess${nextId}`)!.body).toMatchObject({
      mode: "annotate",
      markdown: "# Notes",
      filePath: file,
      title: "notes.md",
    });
    expect(out.stdout).toBe("# Markdown Annotations\n\nFix.\n");
  });

  test("revise resubmits into a session given by URL", async () => {
    const { ctx, out } = context("# Revised", { DYNOTATOR_NO_BROWSER: "1" });
    const id = `sess${nextId}`;
    decideNext(id, { approved: true });
    expect(await run(["revise", `${base}/s/${id}`, "-"], ctx)).toBe(0);
    expect(sessions.get(id)!.revisions.at(-1)).toBe("# Revised");
    expect(out.stdout).toBe("The user approved.\n");
  });

  test("usage errors", async () => {
    const { ctx, out } = context("");
    expect(await run(["annotate"], ctx)).toBe(2);
    expect(await run(["bogus"], ctx)).toBe(2);
    expect(await run(["--frobnicate"], ctx)).toBe(2);
    expect(out.stdout).toBe("");
  });
});
