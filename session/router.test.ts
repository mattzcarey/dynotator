import { describe, expect, test } from "bun:test";
import { Waiters } from "./decision";
import { initSession, type SessionInit } from "./plan";
import { BASE_URL_HEADER, handleRequest } from "./router";
import { MemoryStore } from "./store";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function session(init: Partial<SessionInit> = {}) {
  const store = new MemoryStore();
  const waiters = new Waiters();
  initSession(store, { mode: "plan", markdown: "# v1", permissionMode: "default", ...init });
  const ctx = { store, waiters };
  const call = async (method: string, path: string, body?: unknown, headers?: HeadersInit) => {
    const res = await handleRequest(
      new Request(`https://host.test${path}`, {
        method,
        headers,
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      }),
      ctx,
    );
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { store, waiters, call };
}

describe("plan payload", () => {
  test("plan mode names no mode, advertises the revision and nothing hosted cannot do", async () => {
    const { call } = session({ project: "demo" });
    const { status, json } = await call("GET", "/api/plan");
    expect(status).toBe(200);
    expect(json).toEqual({
      plan: "# v1",
      origin: "claude-code",
      previousPlan: null,
      versionInfo: { version: 1, totalVersions: 1, project: "demo" },
      sharingEnabled: false,
      serverConfig: {},
      permissionMode: "default",
      planRevision: 0,
    });
  });

  test("annotate mode names itself and is never a gate", async () => {
    const { call } = session({ mode: "annotate", filePath: "docs/a.md", title: "A" });
    const { json } = await call("GET", "/api/plan");
    expect(json.mode).toBe("annotate");
    expect(json.gate).toBe(false);
    expect(json.filePath).toBe("docs/a.md");
    expect(json.title).toBe("A");
    expect(json.planRevision).toBeUndefined();
  });

  test("unknown api paths are JSON 404s, and mode-specific routes do not leak across modes", async () => {
    const plan = session();
    expect((await plan.call("GET", "/api/nope")).json).toEqual({
      error: "Not found",
      path: "/api/nope",
    });
    expect((await plan.call("POST", "/api/feedback", {})).status).toBe(404);
    expect((await plan.call("POST", "/api/exit")).status).toBe(404);
    const annotate = session({ mode: "annotate" });
    expect((await annotate.call("POST", "/api/deny", {})).status).toBe(404);
    expect((await annotate.call("GET", "/api/plan/revision")).status).toBe(404);
  });

  test("an uninitialised facet answers 404 for everything", async () => {
    const res = await handleRequest(new Request("https://h/api/plan"), {
      store: new MemoryStore(),
      waiters: new Waiters(),
    });
    expect(res.status).toBe(404);
  });
});

describe("decisions and waiting", () => {
  test("a pending waiter resolves with the deny decision, and later waits repeat it", async () => {
    const { call, waiters } = session();
    const waiting = call("GET", "/api/wait?timeout=30");
    await Bun.sleep(5);
    expect(waiters.size).toBe(1);
    const deny = await call("POST", "/api/deny", {
      feedback: "Add tests",
      answersOnly: true,
      planRevision: 0,
      draftGeneration: 2,
    });
    expect(deny.json).toEqual({ ok: true });
    const first = (await waiting).json;
    expect(first.status).toBe("decided");
    expect(first.decision).toMatchObject({
      approved: false,
      feedback: "Add tests",
      answersOnly: true,
      version: 1,
    });
    expect(waiters.size).toBe(0);
    expect((await call("GET", "/api/wait")).json).toEqual(first);
  });

  test("wait times out as pending", async () => {
    const { call, waiters } = session();
    expect((await call("GET", "/api/wait?timeout=0.01")).json).toEqual({ status: "pending" });
    expect(waiters.size).toBe(0);
  });

  test("deny without feedback uses upstream's default text", async () => {
    const { call } = session();
    await call("POST", "/api/deny");
    expect((await call("GET", "/api/wait")).json.decision.feedback).toBe("Plan rejected by user");
  });

  test("approve carries the UI's permission mode over the session's, and notes", async () => {
    const { call } = session();
    await call("POST", "/api/approve", { permissionMode: "acceptEdits", feedback: "nit" });
    expect((await call("GET", "/api/wait")).json.decision).toMatchObject({
      approved: true,
      permissionMode: "acceptEdits",
      feedback: "nit",
    });
  });

  test("approve falls back to the session's permission mode", async () => {
    const { call } = session({ permissionMode: "plan" });
    await call("POST", "/api/approve", {});
    expect((await call("GET", "/api/wait")).json.decision.permissionMode).toBe("plan");
  });

  test("a second decision is refused with already_decided", async () => {
    const { call } = session();
    await call("POST", "/api/approve", {});
    const again = await call("POST", "/api/deny", { feedback: "late" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_decided");
    expect((await call("GET", "/api/wait")).json.decision.approved).toBe(true);
  });

  test("annotate feedback passes the formatted text and annotations through", async () => {
    const { call } = session({ mode: "annotate" });
    await call("POST", "/api/feedback", {
      feedback: "# File Feedback\n\nfix it",
      annotations: [{ id: "a" }],
      codeAnnotations: [],
      nothingToSend: true,
    });
    const d = (await call("GET", "/api/wait")).json.decision;
    expect(d).toMatchObject({
      approved: false,
      feedback: "# File Feedback\n\nfix it",
      annotations: [{ id: "a" }],
    });
    expect(d.nothingToSend).toBeUndefined();
    expect(d.codeAnnotations).toBeUndefined();
  });

  test("annotate exit resolves as exit with no feedback", async () => {
    const { call } = session({ mode: "annotate" });
    expect((await call("POST", "/api/exit?draftGeneration=1")).json).toEqual({ ok: true });
    expect((await call("GET", "/api/wait")).json.decision).toMatchObject({
      approved: false,
      exit: true,
      feedback: "",
      annotations: [],
    });
  });

  test("malformed decision bodies are 400s and record nothing", async () => {
    const { call } = session({ mode: "annotate" });
    expect((await call("POST", "/api/feedback", { annotations: "nope" })).status).toBe(400);
    expect((await call("POST", "/api/feedback", "[1]")).status).toBe(400);
    expect((await call("GET", "/api/wait?timeout=0")).json.status).toBe("pending");
  });
});

describe("revisions and versions", () => {
  test("revise after a denial clears the decision, adds a version and bumps the revision", async () => {
    const { call } = session();
    await call("POST", "/api/deny", { feedback: "no" });
    const revised = await call("POST", "/api/revise", { markdown: "# v2" });
    expect(revised.json).toEqual({ ok: true, version: 2, revision: 1, unchanged: false });
    expect((await call("GET", "/api/wait?timeout=0")).json).toEqual({ status: "pending" });
    const plan = (await call("GET", "/api/plan")).json;
    expect(plan).toMatchObject({
      plan: "# v2",
      previousPlan: "# v1",
      planRevision: 1,
      versionInfo: { version: 2, totalVersions: 2 },
    });
    expect((await call("GET", "/api/plan/revision")).json).toEqual({ revision: 1, decided: false });
    const versions = (await call("GET", "/api/plan/versions")).json.versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await call("GET", "/api/plan/version?v=1")).json).toEqual({ plan: "# v1", version: 1 });
    expect((await call("GET", "/api/plan/version?v=9")).status).toBe(404);
    expect((await call("GET", "/api/plan/version?v=x")).status).toBe(400);
  });

  test("the same session can be revised repeatedly", async () => {
    const { call } = session();
    for (let i = 2; i <= 4; i++) {
      await call("POST", "/api/deny", { feedback: `round ${i}`, planRevision: i - 2 });
      expect((await call("POST", "/api/revise", { markdown: `# v${i}` })).json.version).toBe(i);
    }
    expect((await call("POST", "/api/approve", { planRevision: 3 })).status).toBe(200);
    expect((await call("GET", "/api/wait?timeout=0")).json.decision).toMatchObject({
      approved: true,
      version: 4,
    });
  });

  test("an unchanged revision clears the decision without adding a version", async () => {
    const { call } = session();
    await call("POST", "/api/deny", {});
    expect((await call("POST", "/api/revise", { markdown: "# v1" })).json).toMatchObject({
      version: 1,
      unchanged: true,
    });
    expect((await call("GET", "/api/wait?timeout=0")).json.status).toBe("pending");
  });

  test("a decision made on a stale revision is refused with plan_revised", async () => {
    const { call } = session();
    await call("POST", "/api/revise", { markdown: "# v2" });
    const stale = await call("POST", "/api/approve", { planRevision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "plan_revised", planRevision: 1 });
    expect((await call("GET", "/api/wait?timeout=0")).json.status).toBe("pending");
  });

  test("revise after approval is refused and keeps the approval", async () => {
    const { call } = session();
    await call("POST", "/api/approve", {});
    expect((await call("POST", "/api/revise", { markdown: "# v2" })).status).toBe(409);
    expect((await call("GET", "/api/wait")).json.decision.approved).toBe(true);
  });

  test("revise validates markdown", async () => {
    const { call } = session();
    expect((await call("POST", "/api/revise", {})).status).toBe(400);
    expect((await call("POST", "/api/revise", { markdown: "a".repeat(1_000_001) })).status).toBe(
      413,
    );
  });
});

describe("drafts", () => {
  test("round trip, stale-generation refusal, delete tombstone", async () => {
    const { call } = session();
    expect((await call("GET", "/api/draft")).status).toBe(404);
    expect(
      (await call("POST", "/api/draft", { annotations: [1], draftGeneration: 5 })).status,
    ).toBe(200);
    expect((await call("GET", "/api/draft")).json).toEqual({
      annotations: [1],
      draftGeneration: 5,
    });
    const stale = await call("POST", "/api/draft", { annotations: [], draftGeneration: 4 });
    expect(stale.status).toBe(409);
    expect(stale.json.draftGeneration).toBe(5);
    await call("DELETE", "/api/draft?generation=5");
    expect((await call("GET", "/api/draft")).json).toEqual({ found: false, draftGeneration: 5 });
    expect((await call("POST", "/api/draft", { draftGeneration: 5 })).status).toBe(409);
    expect((await call("POST", "/api/draft", { draftGeneration: 6 })).status).toBe(200);
  });

  test("a decision deletes the draft and refuses later saves as decided", async () => {
    const { call } = session();
    await call("POST", "/api/draft", { annotations: [1], draftGeneration: 1 });
    await call("POST", "/api/deny", { draftGeneration: 1 });
    expect((await call("GET", "/api/draft")).status).toBe(404);
    const late = await call("POST", "/api/draft", { draftGeneration: 2 });
    expect(late.status).toBe(409);
    expect(late.json.decided).toBe(true);
  });

  test("drafts are per version", async () => {
    const { call } = session();
    await call("POST", "/api/draft", { annotations: ["on v1"] });
    await call("POST", "/api/revise", { markdown: "# v2" });
    expect((await call("GET", "/api/draft")).status).toBe(404);
  });
});

function form(bytes: Uint8Array<ArrayBuffer>, name: string): FormData {
  const f = new FormData();
  f.append("file", new File([bytes], name));
  return f;
}

describe("uploads", () => {
  test("stores an image and serves the same bytes with its real type", async () => {
    const { call } = session();
    const up = await call("POST", "/api/upload", form(PNG, "shot.png"), {
      [BASE_URL_HEADER]: "https://host.test/s/abc",
    });
    expect(up.status).toBe(200);
    expect(up.json.originalName).toBe("shot.png");
    expect(up.json.path).toStartWith("https://host.test/s/abc/api/image?path=");
    const id = new URL(up.json.path).searchParams.get("path");
    const img = await call("GET", `/api/image?path=${id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-security-policy")).toStartWith("sandbox");
  });

  test("refuses non-images whatever their name says", async () => {
    const { call } = session();
    const res = await call(
      "POST",
      "/api/upload",
      form(new TextEncoder().encode("<html>"), "x.png"),
    );
    expect(res.status).toBe(400);
  });

  test("large images round trip across chunks", async () => {
    const { call, store } = session();
    const big = new Uint8Array(2_500_000);
    big.set(PNG);
    for (let i = PNG.length; i < big.length; i++) big[i] = i % 251;
    const up = await call("POST", "/api/upload", form(big, "big.png"));
    const res = await handleRequest(new Request(`https://h/api/image?path=${up.json.path}`), {
      store,
      waiters: new Waiters(),
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(big);
    expect([...store.data.keys()].filter((k) => k.startsWith("upload-chunk:")).length).toBe(3);
  });

  test("unknown or malformed image ids are 404", async () => {
    const { call } = session();
    expect((await call("GET", "/api/image?path=../../etc/passwd")).status).toBe(404);
    expect((await call("GET", `/api/image?path=${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe("config", () => {
  test("posts merge into the session config and come back as serverConfig", async () => {
    const { call } = session();
    await call("POST", "/api/config", { displayName: "R" });
    await call("POST", "/api/config", { theme: { mode: "dark" } });
    expect((await call("GET", "/api/config")).json).toEqual({
      displayName: "R",
      theme: { mode: "dark" },
    });
    expect((await call("GET", "/api/plan")).json.serverConfig.displayName).toBe("R");
  });
});
