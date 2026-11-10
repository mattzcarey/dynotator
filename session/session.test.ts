import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Decision, Revision } from "./decision";
import type { SessionInit } from "./plan";
import { MemoryStore } from "./store";

/** `SessionServer`'s public surface. */
interface Server {
  init(input: SessionInit): void;
  decision(): Decision | null;
  wait(seconds?: number): Promise<Decision | null>;
  revise(markdown: string): Revision;
  fetch(request: Request): Promise<Response>;
}

// The real class, with its Durable Object base replaced by one that only holds `ctx`.
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown) {}
  },
  WorkerEntrypoint: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}));

// Imported by a computed path so that the tests' type check (no Workers types) does not follow it.
const INDEX = "./index";
let SessionServer: new (ctx: unknown) => Server;
beforeAll(async () => {
  ({ SessionServer } = await import(INDEX));
});

const newServer = () => new SessionServer({ storage: { kv: new MemoryStore() } });

function session(init: Partial<SessionInit> = {}) {
  const server = newServer();
  server.init({ mode: "plan", markdown: "# v1", ...init });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await server.fetch(
      new Request(`https://facet${path}`, {
        method,
        body:
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  };
  return { server, call };
}

describe("plan payload", () => {
  test("plan mode", async () => {
    const { call } = session({ title: "T" });
    expect(await call("GET", "/api/plan")).toEqual({
      status: 200,
      json: {
        plan: "# v1",
        mode: "plan",
        title: "T",
        previousPlan: null,
        versionInfo: { version: 1, totalVersions: 1 },
        planRevision: 1,
      },
    });
  });

  test("annotate mode has no plan revision", async () => {
    const { call } = session({ mode: "annotate" });
    expect((await call("GET", "/api/plan")).json).toEqual({
      plan: "# v1",
      mode: "annotate",
      previousPlan: null,
      versionInfo: { version: 1, totalVersions: 1 },
    });
    expect((await call("GET", "/api/plan/revision")).status).toBe(404);
  });

  test("unknown paths and the other mode's decisions are JSON 404s", async () => {
    const plan = session();
    expect(await plan.call("GET", "/api/nope")).toEqual({
      status: 404,
      json: { error: "Not found", path: "/api/nope" },
    });
    for (const path of ["/api/feedback", "/api/exit", "/api/upload", "/api/wait", "/api/revise"]) {
      expect((await plan.call("POST", path, {})).status).toBe(404);
    }
    expect((await plan.call("GET", "/api/config")).status).toBe(404);
    const annotate = session({ mode: "annotate" });
    for (const path of ["/api/approve", "/api/deny"]) {
      expect((await annotate.call("POST", path, {})).status).toBe(404);
    }
    expect(plan.server.decision()).toBeNull();
    expect(annotate.server.decision()).toBeNull();
  });

  test("an uninitialised facet answers 404", async () => {
    const server = newServer();
    expect((await server.fetch(new Request("https://facet/api/plan"))).status).toBe(404);
  });

  test("init refuses to run twice", () => {
    const { server } = session();
    expect(() => server.init({ mode: "plan", markdown: "again" })).toThrow();
  });
});

describe("decisions", () => {
  test("plan approve keeps notes; empty notes are omitted", async () => {
    const a = session();
    expect(await a.call("POST", "/api/approve", { feedback: "nit", planRevision: 1 })).toEqual({
      status: 200,
      json: { ok: true },
    });
    const d = a.server.decision();
    expect(d).toEqual({ approved: true, feedback: "nit", version: 1, decidedAt: d!.decidedAt });
    expect(Date.parse(d!.decidedAt)).not.toBeNaN();

    const b = session();
    await b.call("POST", "/api/approve", { feedback: "" });
    expect(Object.keys(b.server.decision()!).toSorted()).toEqual([
      "approved",
      "decidedAt",
      "version",
    ]);
  });

  test("plan deny carries feedback and answersOnly, and ignores unknown fields", async () => {
    const { call, server } = session();
    await call("POST", "/api/deny", {
      feedback: "Add tests",
      answersOnly: true,
      permissionMode: "acceptEdits",
      draftGeneration: 1,
    });
    expect(server.decision()).toMatchObject({
      approved: false,
      feedback: "Add tests",
      answersOnly: true,
    });
    expect(server.decision()).not.toHaveProperty("permissionMode");
  });

  test("annotate feedback passes the text and annotations through", async () => {
    const { call, server } = session({ mode: "annotate" });
    await call("POST", "/api/feedback", { feedback: "fix it", annotations: [{ id: "a" }] });
    expect(server.decision()).toMatchObject({
      approved: false,
      feedback: "fix it",
      annotations: [{ id: "a" }],
    });
  });

  test("annotate exit is a bare POST and records only exit", async () => {
    const { call, server } = session({ mode: "annotate" });
    expect((await call("POST", "/api/exit?draftGeneration=1")).json).toEqual({ ok: true });
    const d = server.decision()!;
    expect(d).toEqual({ approved: false, exit: true, version: 1, decidedAt: d.decidedAt });
  });

  test("malformed bodies are 400s and record nothing", async () => {
    const { call, server } = session({ mode: "annotate" });
    expect((await call("POST", "/api/feedback", { annotations: "nope" })).status).toBe(400);
    expect((await call("POST", "/api/feedback", { feedback: 5 })).status).toBe(400);
    expect((await call("POST", "/api/feedback", "[1]")).status).toBe(400);
    expect((await call("POST", "/api/feedback", "{")).status).toBe(400);
    expect(server.decision()).toBeNull();
  });

  test("a second decision is refused with already_decided and keeps the first", async () => {
    const { call, server } = session();
    await call("POST", "/api/approve", {});
    const again = await call("POST", "/api/deny", { feedback: "late" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_decided");
    expect(server.decision()!.approved).toBe(true);
  });

  test("a decision on a replaced version is refused with plan_revised", async () => {
    const { call, server } = session();
    server.revise("# v2");
    const stale = await call("POST", "/api/approve", { planRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "plan_revised", planRevision: 2 });
    expect(server.decision()).toBeNull();
    expect((await call("POST", "/api/approve", { planRevision: 2 })).status).toBe(200);
  });
});

describe("wait", () => {
  test("resolves every pending waiter with the decision", async () => {
    const { call, server } = session();
    const waits = [server.wait(30), server.wait(30)];
    await call("POST", "/api/deny", { feedback: "no" });
    const [a, b] = await Promise.all(waits);
    expect(a).toMatchObject({ approved: false, feedback: "no", version: 1 });
    expect(b).toEqual(a);
  });

  test("returns a standing decision at once", async () => {
    const { call, server } = session();
    await call("POST", "/api/approve", {});
    expect((await server.wait(30))!.approved).toBe(true);
  });

  test("times out with null", async () => {
    const { server } = session();
    const started = performance.now();
    expect(await server.wait(0.02)).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("a waiter that timed out is not resolved later", async () => {
    const { call, server } = session();
    expect(await server.wait(0)).toBeNull();
    await call("POST", "/api/approve", {});
    expect((await server.wait(0))!.approved).toBe(true);
  });
});

describe("revise and versions", () => {
  test("revise after a denial reopens the review on a new version", async () => {
    const { call, server } = session();
    await call("POST", "/api/deny", { feedback: "no" });
    expect(server.revise("# v2")).toEqual({ version: 2, unchanged: false });
    expect(server.decision()).toBeNull();
    expect((await call("GET", "/api/plan")).json).toMatchObject({
      plan: "# v2",
      previousPlan: "# v1",
      versionInfo: { version: 2, totalVersions: 2 },
      planRevision: 2,
    });
    expect((await call("GET", "/api/plan/revision")).json).toEqual({ revision: 2 });
    const versions = (await call("GET", "/api/plan/versions")).json.versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await call("GET", "/api/plan/version?v=1")).json).toEqual({ plan: "# v1", version: 1 });
    expect((await call("GET", "/api/plan/version?v=9")).status).toBe(404);
    expect((await call("GET", "/api/plan/version?v=x")).status).toBe(400);
  });

  test("the decision records the version it was made on", async () => {
    const { call, server } = session();
    for (let v = 2; v <= 4; v++) {
      await call("POST", "/api/deny", { feedback: `round ${v}`, planRevision: v - 1 });
      server.revise(`# v${v}`);
    }
    await call("POST", "/api/approve", { planRevision: 4 });
    expect(server.decision()).toMatchObject({ approved: true, version: 4 });
  });

  test("an unchanged revision adds no version and leaves the decision standing", async () => {
    const { call, server } = session();
    await call("POST", "/api/deny", {});
    expect(server.revise("# v1")).toEqual({ version: 1, unchanged: true });
    expect(server.decision()).toMatchObject({ approved: false, version: 1 });
    expect((await call("GET", "/api/plan/versions")).json.versions).toHaveLength(1);
  });

  test("revise is refused after approval and after exit, and keeps the decision", async () => {
    const plan = session();
    await plan.call("POST", "/api/approve", {});
    expect(() => plan.server.revise("# v2")).toThrow(/finished/);
    expect(plan.server.decision()!.approved).toBe(true);

    const annotate = session({ mode: "annotate" });
    await annotate.call("POST", "/api/exit");
    expect(() => annotate.server.revise("# v2")).toThrow(/finished/);
    expect(annotate.server.decision()!.exit).toBe(true);
  });

  test("revise is allowed after annotate feedback", async () => {
    const { call, server } = session({ mode: "annotate" });
    await call("POST", "/api/feedback", { feedback: "x", annotations: [] });
    expect(server.revise("# v2").version).toBe(2);
    expect(server.decision()).toBeNull();
  });
});

const save = (generation: number, annotations: unknown[] = [generation]) => ({
  annotations,
  draftGeneration: generation,
  ts: 1,
});

describe("drafts", () => {
  test("no draft is a 200 with nothing in it", async () => {
    const { call } = session();
    expect(await call("GET", "/api/draft")).toEqual({ status: 200, json: {} });
  });

  test("round trip keeps exactly the draft fields", async () => {
    const { call } = session();
    expect((await call("POST", "/api/draft", { ...save(5), extra: "x" })).status).toBe(200);
    expect(await call("GET", "/api/draft")).toEqual({
      status: 200,
      json: { annotations: [5], draftGeneration: 5, ts: 1 },
    });
  });

  test("an older generation is refused with the latest; the same one overwrites", async () => {
    const { call } = session();
    await call("POST", "/api/draft", save(5));
    const stale = await call("POST", "/api/draft", save(4));
    expect(stale).toEqual({ status: 409, json: { error: "Stale draft", draftGeneration: 5 } });
    expect((await call("POST", "/api/draft", save(5, ["again"]))).status).toBe(200);
    expect((await call("GET", "/api/draft")).json.annotations).toEqual(["again"]);
  });

  test("a delete leaves a tombstone that refuses saves up to its generation", async () => {
    const { call } = session();
    await call("POST", "/api/draft", save(5));
    expect((await call("DELETE", "/api/draft?generation=6")).status).toBe(200);
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 6 });
    expect((await call("POST", "/api/draft", save(6))).status).toBe(409);
    expect((await call("POST", "/api/draft", save(7))).status).toBe(200);
  });

  test("a delete older than the stored draft is ignored", async () => {
    const { call } = session();
    await call("POST", "/api/draft", save(5));
    await call("DELETE", "/api/draft?generation=3");
    expect((await call("GET", "/api/draft")).json.draftGeneration).toBe(5);
  });

  test("bad draft requests are 400s", async () => {
    const { call } = session();
    expect((await call("POST", "/api/draft", { annotations: [] })).status).toBe(400);
    expect((await call("POST", "/api/draft", { draftGeneration: 1 })).status).toBe(400);
    expect((await call("POST", "/api/draft", { ...save(1), ts: "now" })).status).toBe(400);
    expect((await call("DELETE", "/api/draft")).status).toBe(400);
    expect((await call("DELETE", "/api/draft?generation=-1")).status).toBe(400);
  });

  test("a decision deletes the draft and later saves are refused as decided", async () => {
    const { call } = session();
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/deny", { feedback: "no", draftGeneration: 2 });
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 2 });
    expect(await call("POST", "/api/draft", save(3))).toEqual({
      status: 409,
      json: { error: "This review has already been decided.", decided: true },
    });
  });

  test("exit's draft generation comes from the query string", async () => {
    const { call } = session({ mode: "annotate" });
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/exit?draftGeneration=2");
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 2 });
  });

  test("drafts are per version", async () => {
    const { call, server } = session();
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/deny", { feedback: "no" });
    server.revise("# v2");
    expect((await call("GET", "/api/draft")).json).toEqual({});
  });
});
