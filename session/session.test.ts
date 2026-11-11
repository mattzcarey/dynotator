import { describe, expect, test } from "vite-plus/test";
import { MAX_ANNOTATIONS } from "./events";
import type { Files, ReviewInit } from "./files";
import { REVIEWER_HEADER } from "./http";
import { type Fs, currentVersion } from "./review";
import { Session } from "./session";
import { MemoryStore } from "./store";

/** `workspace.fs` as far as a review uses it: parents must exist, as in the Workspace. */
class MemoryFs implements Fs {
  readonly dirs = new Set(["/"]);
  readonly files = new Map<string, string>();

  async mkdir(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) this.dirs.add(`/${parts.slice(0, i).join("/")}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.dirs.has(path.slice(0, path.lastIndexOf("/")) || "/")) throw new Error("ENOENT");
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async rm(path: string): Promise<void> {
    for (const set of [this.dirs, this.files]) {
      for (const key of set.keys()) if (key === path || key.startsWith(`${path}/`)) set.delete(key);
    }
  }
}

const V1: Files = { "README.md": "# v1", "src/a.ts": "a", "src/deep/b.ts": "b" };
const V2: Files = { "README.md": "# v2", "src/a.ts": "a", "src/c.ts": "c" };

async function session(init: Partial<ReviewInit> = {}) {
  const fs = new MemoryFs();
  const store = new MemoryStore();
  const server = new Session(store, fs);
  await server.init({ files: V1, ...init });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => {
    // A submission that does not say otherwise is made on the version now under review.
    const submits = path === "/api/feedback" || path === "/api/approve";
    const sent =
      submits && (body === undefined || (typeof body === "object" && !("revision" in body!)))
        ? { revision: currentVersion(store), ...(body as object | undefined) }
        : body;
    const res = await server.fetch(
      new Request(`https://facet${path}`, {
        method,
        headers,
        body:
          sent === undefined ? undefined : typeof sent === "string" ? sent : JSON.stringify(sent),
      }),
    );
    // Tests poke at whatever shape a route returns.
    // oxlint-disable-next-line typescript/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };
  const types = async () => (await server.events()).map((e) => e.type);
  return { server, call, fs, types };
}

const note = (id: string, path = "README.md") => ({ id, path, type: "comment", text: id });

describe("review payload", () => {
  test("title, open path, versions, base and closed", async () => {
    const { call } = await session({ title: "T" });
    const { status, json } = await call("GET", "/api/review");
    expect(status).toBe(200);
    expect(json).toEqual({
      title: "T",
      open: "README.md",
      version: 1,
      versions: [{ version: 1, timestamp: json.versions[0].timestamp }],
      base: false,
      closed: false,
    });
    expect(Date.parse(json.versions[0].timestamp)).not.toBeNaN();
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 1, seq: 0 });
  });

  test("keeps the requested open path", async () => {
    const { call } = await session({ open: "src/a.ts" });
    expect((await call("GET", "/api/review")).json.open).toBe("src/a.ts");
  });

  test("unknown and removed routes are JSON 404s", async () => {
    const { call, types } = await session();
    expect(await call("GET", "/api/nope")).toEqual({
      status: 404,
      json: { error: "Not found", path: "/api/nope" },
    });
    for (const path of ["/api/deny", "/api/exit", "/api/plan", "/api/upload", "/api/revise"]) {
      expect((await call("POST", path, {})).status).toBe(404);
    }
    expect((await call("DELETE", "/api/draft?generation=1")).status).toBe(404);
    expect((await call("GET", "/api/raw?path=README.md")).status).toBe(404);
    expect(await types()).toEqual([]);
  });

  test("an uninitialised facet answers 404", async () => {
    const server = new Session(new MemoryStore(), new MemoryFs());
    expect((await server.fetch(new Request("https://facet/api/review"))).status).toBe(404);
  });

  test("init refuses to run twice", async () => {
    const { server } = await session();
    await expect(server.init({ files: V1 })).rejects.toThrow();
  });
});

describe("files", () => {
  test("lists paths and sizes in path order and stores each version as a tree", async () => {
    const { call, fs } = await session();
    expect((await call("GET", "/api/files")).json).toEqual({
      files: [
        { path: "README.md", size: 4 },
        { path: "src/a.ts", size: 1 },
        { path: "src/deep/b.ts", size: 1 },
      ],
    });
    expect([...fs.files.keys()].toSorted()).toEqual([
      "/v/1/README.md",
      "/v/1/src/a.ts",
      "/v/1/src/deep/b.ts",
    ]);
  });

  test("sizes are UTF-8 bytes", async () => {
    const { call, server } = await session();
    await server.revise({ "é.md": "é" });
    expect((await call("GET", "/api/files")).json).toEqual({ files: [{ path: "é.md", size: 2 }] });
    expect((await call("GET", `/api/file?path=${encodeURIComponent("é.md")}`)).json.content).toBe(
      "é",
    );
  });

  test("reads a file, nested or not", async () => {
    const { call } = await session();
    expect((await call("GET", "/api/file?path=README.md")).json).toEqual({
      path: "README.md",
      content: "# v1",
    });
    expect((await call("GET", "/api/file?path=src%2Fdeep%2Fb.ts&v=1")).json).toEqual({
      path: "src/deep/b.ts",
      content: "b",
    });
  });

  test("unknown paths and versions are 404s; invalid ones are 400s", async () => {
    const { call } = await session();
    expect(await call("GET", "/api/file?path=nope.md")).toEqual({
      status: 404,
      json: { error: "File not found", path: "nope.md" },
    });
    expect((await call("GET", "/api/file?path=src")).status).toBe(404);
    expect((await call("GET", "/api/file?path=README.md&v=2")).status).toBe(404);
    expect((await call("GET", "/api/files?v=9")).status).toBe(404);
    // Without a patch there is no version 0.
    expect((await call("GET", "/api/files?v=0")).status).toBe(404);
    expect((await call("GET", "/api/changes")).status).toBe(404);
    for (const bad of ["../x", "/etc/passwd", "src/../README.md", "a//b", "./a", ""]) {
      const res = await call("GET", `/api/file?path=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
    expect((await call("GET", "/api/file")).status).toBe(400);
    for (const v of ["-1", "x", "1.5", ""]) {
      expect((await call("GET", `/api/files?v=${v}`)).status).toBe(400);
    }
  });
});

describe("a review of a patch", () => {
  const files = { "PLAN.md": "# Plan\n", "src/a.ts": "const a = 2;\n", "src/new.ts": "n\n" };
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-const a = 1;",
    "+const a = 2;",
    "diff --git a/src/new.ts b/src/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1 @@",
    "+n",
    "diff --git a/src/old.ts b/src/old.ts",
    "deleted file mode 100644",
    "--- a/src/old.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-o",
    "",
  ].join("\n");

  test("stores the state before the patch as version 0, outside versions", async () => {
    const { call, fs } = await session({ files, patch });
    const review = (await call("GET", "/api/review")).json;
    expect(review).toMatchObject({ base: true, version: 1 });
    expect(review.versions.map((v: { version: number }) => v.version)).toEqual([1]);
    expect((await call("GET", "/api/files?v=0")).json.files).toEqual([
      { path: "PLAN.md", size: 7 },
      { path: "src/a.ts", size: 13 },
      { path: "src/old.ts", size: 2 },
    ]);
    expect((await call("GET", "/api/file?path=src/a.ts&v=0")).json.content).toBe("const a = 1;\n");
    expect((await call("GET", "/api/file?path=src/old.ts&v=0")).json.content).toBe("o\n");
    expect((await call("GET", "/api/file?path=src/new.ts&v=0")).status).toBe(404);
    expect([...fs.files.keys()].filter((p) => p.startsWith("/v/0/")).toSorted()).toEqual([
      "/v/0/PLAN.md",
      "/v/0/src/a.ts",
      "/v/0/src/old.ts",
    ]);
  });

  test("changes from 0 list only what the patch changed; the plan is context", async () => {
    const { call, server } = await session({ files, patch });
    const expected = [
      { path: "src/a.ts", status: "modified" },
      { path: "src/new.ts", status: "added" },
      { path: "src/old.ts", status: "deleted" },
    ];
    expect((await call("GET", "/api/changes?from=0&to=1")).json.files).toEqual(expected);
    // Version 1's default "from" is the version before it: the base.
    expect((await call("GET", "/api/changes")).json.files).toEqual(expected);
    await server.revise({ ...files, "PLAN.md": "# Plan v2\n" });
    expect((await call("GET", "/api/changes?from=0&to=2")).json.files).toEqual([
      { path: "PLAN.md", status: "modified" },
      ...expected,
    ]);
    expect((await call("GET", "/api/changes")).json.files).toEqual([
      { path: "PLAN.md", status: "modified" },
    ]);
  });

  test("a patch that does not apply fails init and leaves no review", async () => {
    const server = new Session(new MemoryStore(), new MemoryFs());
    await expect(
      server.init({ files: { ...files, "src/a.ts": "const a = 3;\n" }, patch }),
    ).rejects.toThrow("src/a.ts: hunk @@ -1 +1 @@ does not apply: line 1 differs");
    expect((await server.fetch(new Request("https://facet/api/review"))).status).toBe(404);
  });
});

describe("events", () => {
  test("submissions append in order with gapless seq, and answer that seq", async () => {
    const { call, server } = await session();
    expect(await call("POST", "/api/feedback", { feedback: "one", revision: 1 })).toEqual({
      status: 200,
      json: { ok: true, seq: 1 },
    });
    expect((await call("POST", "/api/feedback", { feedback: "two" })).json.seq).toBe(2);
    await server.revise(V2);
    expect((await call("POST", "/api/approve", { revision: 2 })).json.seq).toBe(4);
    await server.close();
    const events = await server.events();
    expect(events.map((e) => [e.seq, e.type, e.version])).toEqual([
      [1, "feedback", 1],
      [2, "feedback", 1],
      [3, "revised", 2],
      [4, "approved", 2],
      [5, "closed", 2],
    ]);
    for (const e of events) expect(Date.parse(e.at)).not.toBeNaN();
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 2, seq: 5 });
  });

  test("the cursor returns only later events, in RPC and over HTTP", async () => {
    const { call, server } = await session();
    for (const text of ["a", "b", "c"]) await call("POST", "/api/feedback", { feedback: text });
    expect((await server.events(1)).map((e) => e.feedback)).toEqual(["b", "c"]);
    expect(await server.events(3)).toEqual([]);
    expect(await server.events(99)).toEqual([]);
    expect(
      (await call("GET", "/api/events?after=2")).json.events.map((e: { seq: number }) => e.seq),
    ).toEqual([3]);
    expect((await call("GET", "/api/events")).json.events).toHaveLength(3);
    for (const bad of ["-1", "x", "1.5", ""]) {
      expect((await call("GET", `/api/events?after=${bad}`)).status).toBe(400);
    }
    await expect(server.events(-1)).rejects.toThrow(/after/);
  });

  test("an event carries only what was sent: no empty feedback, no empty annotations", async () => {
    const { call, server } = await session();
    await call("POST", "/api/approve", { feedback: "", annotations: [] });
    const [approved] = await server.events();
    expect(Object.keys(approved).toSorted()).toEqual(["at", "seq", "type", "version"]);
    await call("POST", "/api/feedback", {
      feedback: "fix",
      annotations: [{ ...note("a"), lines: { start: 1, end: 1 }, side: "old", extra: 1 }],
      answersOnly: true,
    });
    const [, feedback] = await server.events();
    expect(feedback).toMatchObject({
      type: "feedback",
      feedback: "fix",
      annotations: [{ id: "a", side: "old", extra: 1 }],
    });
    expect(feedback).not.toHaveProperty("answersOnly");
  });

  test("a feedback after an approval withdraws it; the log keeps both", async () => {
    const { call, types } = await session();
    await call("POST", "/api/approve", {});
    await call("POST", "/api/feedback", { feedback: "on second thought" });
    expect(await types()).toEqual(["approved", "feedback"]);
    // So a second approval is a new fact, not a repeat.
    expect((await call("POST", "/api/approve", {})).json.seq).toBe(3);
  });

  test("a submission on a replaced version is 409 revised and appends nothing", async () => {
    const { call, server, types } = await session();
    await server.revise(V2);
    for (const path of ["/api/feedback", "/api/approve"]) {
      expect(await call("POST", path, { feedback: "late", revision: 1 })).toEqual({
        status: 409,
        json: {
          error: expect.stringMatching(/revised/),
          code: "revised",
          revision: 2,
        },
      });
    }
    expect(await types()).toEqual(["revised"]);
    expect((await call("POST", "/api/approve", { revision: 2 })).status).toBe(200);
  });

  test("malformed bodies are 400s and append nothing", async () => {
    const { call, types } = await session();
    const bad = [
      { annotations: "nope" },
      { feedback: 5 },
      { feedback: "no revision", revision: undefined },
      { feedback: "bad revision", revision: "1" },
      { annotations: [5] },
      { annotations: [[]] },
      { annotations: [{ id: "a" }] },
      { annotations: [{ path: "a" }] },
      { annotations: [{ id: 1, path: "a" }] },
      { annotations: Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, i) => note(`n${i}`)) },
    ];
    for (const body of bad) expect((await call("POST", "/api/feedback", body)).status).toBe(400);
    expect((await call("POST", "/api/feedback", "[1]")).status).toBe(400);
    expect((await call("POST", "/api/feedback", "{")).status).toBe(400);
    expect(await types()).toEqual([]);
  });

  test("the annotation bounds: 2,000 entries and a 2 MB body are accepted, more is not", async () => {
    const { call } = await session();
    const many = Array.from({ length: MAX_ANNOTATIONS }, (_, i) => note(`n${i}`));
    expect((await call("POST", "/api/feedback", { annotations: many })).status).toBe(200);
    const text = "x".repeat(1_999_900);
    expect((await call("POST", "/api/feedback", { feedback: text })).status).toBe(200);
    expect(
      (await call("POST", "/api/feedback", { feedback: `${text}${"x".repeat(200)}` })).status,
    ).toBe(413);
  });
});

describe("sent annotations", () => {
  test("an id already in the log is dropped from a later submission", async () => {
    const { call, server } = await session();
    await call("POST", "/api/feedback", { annotations: [note("a"), note("b")] });
    await call("POST", "/api/feedback", { annotations: [note("b"), note("c")] });
    const ids = (await server.events()).map((e) => e.annotations?.map((a) => a.id));
    expect(ids).toEqual([["a", "b"], ["c"]]);
  });

  test("an id repeated within one submission is sent once", async () => {
    const { call, server } = await session();
    await call("POST", "/api/feedback", { annotations: [note("a"), note("a")] });
    expect((await server.events())[0].annotations).toHaveLength(1);
  });

  test("a retry of the same body appends nothing and answers the last seq", async () => {
    const { call, types } = await session();
    const body = { feedback: "", annotations: [note("a")], revision: 1 };
    expect((await call("POST", "/api/feedback", body)).json).toEqual({ ok: true, seq: 1 });
    expect((await call("POST", "/api/feedback", body)).json).toEqual({ ok: true, seq: 1 });
    expect(await types()).toEqual(["feedback"]);
  });

  test("feedback with nothing new and no text appends nothing", async () => {
    const { call, types } = await session();
    expect((await call("POST", "/api/feedback", {})).json).toEqual({ ok: true, seq: 0 });
    expect((await call("POST", "/api/feedback", { feedback: "" })).json).toEqual({
      ok: true,
      seq: 0,
    });
    expect(await types()).toEqual([]);
  });

  test("feedback text is a new fact even with the same words", async () => {
    const { call, types } = await session();
    await call("POST", "/api/feedback", { feedback: "again" });
    await call("POST", "/api/feedback", { feedback: "again" });
    expect(await types()).toEqual(["feedback", "feedback"]);
  });

  test("approving an approved version with nothing new is a no-op", async () => {
    const { call, server, types } = await session();
    expect((await call("POST", "/api/approve", { annotations: [note("a")] })).json.seq).toBe(1);
    expect((await call("POST", "/api/approve", { annotations: [note("a")] })).json.seq).toBe(1);
    expect((await call("POST", "/api/approve", {})).json.seq).toBe(1);
    // Something new is another approval.
    expect((await call("POST", "/api/approve", { feedback: "ship it" })).json.seq).toBe(2);
    // A new version has no approval yet.
    await server.revise(V2);
    expect((await call("POST", "/api/approve", {})).json.seq).toBe(4);
    expect(await types()).toEqual(["approved", "approved", "revised", "approved"]);
  });

  test("a stale draft holding sent ids cannot send them again", async () => {
    const { call, server } = await session();
    await call("POST", "/api/draft", { annotations: [note("a")] });
    await call("POST", "/api/feedback", { annotations: [note("a")] });
    // Another tab still has the old draft and saves it back, then sends it with one more.
    await call("POST", "/api/draft", { annotations: [note("a"), note("b")] });
    const { annotations } = (await call("GET", "/api/draft")).json;
    await call("POST", "/api/feedback", { annotations });
    expect((await server.events()).map((e) => e.annotations?.map((a) => a.id))).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  test("ids are global to the review, across versions", async () => {
    const { call, server } = await session();
    await call("POST", "/api/feedback", { annotations: [note("a")] });
    await server.revise(V2);
    await call("POST", "/api/feedback", { annotations: [note("a")], revision: 2 });
    expect(await server.events()).toHaveLength(2);
  });
});

describe("waiting", () => {
  test("resolves every waiter on the next event", async () => {
    const { call, server } = await session();
    const waits = [server.events(0, 30), server.events(0, 30)];
    await call("POST", "/api/feedback", { feedback: "no" });
    const [a, b] = await Promise.all(waits);
    expect(a.map((e) => e.feedback)).toEqual(["no"]);
    expect(b).toEqual(a);
  });

  test("resolves on agent events too", async () => {
    const { server } = await session();
    const wait = server.events(0, 30);
    await server.close();
    expect((await wait).map((e) => e.type)).toEqual(["closed"]);
  });

  test("returns existing events at once", async () => {
    const { call, server } = await session();
    await call("POST", "/api/approve", {});
    const started = performance.now();
    expect(await server.events(0, 30)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("times out with []", async () => {
    const { server } = await session();
    const started = performance.now();
    expect(await server.events(0, 0.02)).toEqual([]);
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("without wait, or with nonsense, it does not hold", async () => {
    const { server } = await session();
    const started = performance.now();
    for (const wait of [0, -5, Number.NaN, undefined])
      expect(await server.events(0, wait)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  test("a waiter that timed out is not resolved later", async () => {
    const { call, server } = await session();
    expect(await server.events(0, 0)).toEqual([]);
    await call("POST", "/api/approve", {});
    expect(await server.events(0, 0)).toHaveLength(1);
  });
});

describe("revise and versions", () => {
  test("a snapshot becomes the next version; the old one stays readable", async () => {
    const { call, server } = await session();
    expect(await server.revise(V2)).toEqual({ version: 2, unchanged: false });
    expect((await call("GET", "/api/review")).json).toMatchObject({
      version: 2,
      open: "README.md",
    });
    const versions = (await call("GET", "/api/review")).json.versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(
      (await call("GET", "/api/files")).json.files.map((f: { path: string }) => f.path),
    ).toEqual(["README.md", "src/a.ts", "src/c.ts"]);
    expect((await call("GET", "/api/file?path=README.md")).json.content).toBe("# v2");
    expect((await call("GET", "/api/file?path=README.md&v=1")).json.content).toBe("# v1");
    expect((await call("GET", "/api/file?path=src/deep/b.ts")).status).toBe(404);
    expect((await call("GET", "/api/file?path=src/deep/b.ts&v=1")).status).toBe(200);
  });

  test("changes lists added, modified and deleted paths in path order", async () => {
    const { call, server } = await session();
    await server.revise(V2);
    const expected = {
      files: [
        { path: "README.md", status: "modified" },
        { path: "src/c.ts", status: "added" },
        { path: "src/deep/b.ts", status: "deleted" },
      ],
    };
    expect((await call("GET", "/api/changes?from=1&to=2")).json).toEqual(expected);
    expect((await call("GET", "/api/changes")).json).toEqual(expected);
    expect((await call("GET", "/api/changes?from=2&to=2")).json).toEqual({ files: [] });
    expect((await call("GET", "/api/changes?from=1&to=3")).status).toBe(404);
    expect((await call("GET", "/api/changes?from=x")).status).toBe(400);
  });

  test("the open path falls back to the default once a revision deletes it", async () => {
    const { call, server } = await session({ open: "src/deep/b.ts" });
    expect((await call("GET", "/api/review")).json.open).toBe("src/deep/b.ts");
    await server.revise({ "docs/guide.md": "g", "z.ts": "z" });
    expect((await call("GET", "/api/review")).json.open).toBe("docs/guide.md");
  });

  test("revise after an approval is a new version without one", async () => {
    const { call, server, types } = await session();
    await call("POST", "/api/approve", {});
    expect(await server.revise(V2)).toEqual({ version: 2, unchanged: false });
    expect(await types()).toEqual(["approved", "revised"]);
    expect((await server.events(1))[0]).toMatchObject({ type: "revised", version: 2 });
  });

  test("an unchanged snapshot adds no version and appends nothing", async () => {
    const { call, server, fs, types } = await session();
    expect(
      await server.revise({ "src/deep/b.ts": "b", "README.md": "# v1", "src/a.ts": "a" }),
    ).toEqual({ version: 1, unchanged: true });
    expect(await types()).toEqual([]);
    expect((await call("GET", "/api/review")).json.versions).toHaveLength(1);
    expect([...fs.files.keys()].every((p) => p.startsWith("/v/1/"))).toBe(true);
  });

  test("a snapshot that only renames a file is a new version", async () => {
    const { server } = await session();
    const { "src/a.ts": a, ...rest } = V1;
    expect(await server.revise({ ...rest, "src/a2.ts": a })).toEqual({
      version: 2,
      unchanged: false,
    });
  });

  test("concurrent revisions get consecutive versions", async () => {
    const { server } = await session();
    const results = await Promise.all([
      server.revise({ "a.md": "1" }),
      server.revise({ "a.md": "2" }),
      server.revise({ "a.md": "2" }),
    ]);
    expect(results).toEqual([
      { version: 2, unchanged: false },
      { version: 3, unchanged: false },
      { version: 3, unchanged: true },
    ]);
  });
});

describe("close", () => {
  test("is idempotent and final", async () => {
    const { call, server, types } = await session();
    await server.close();
    await server.close();
    expect(await types()).toEqual(["closed"]);
    expect((await call("GET", "/api/review")).json.closed).toBe(true);
    for (const path of ["/api/feedback", "/api/approve"]) {
      expect(await call("POST", path, { feedback: "x" })).toEqual({
        status: 409,
        json: { error: "This review is closed.", code: "closed" },
      });
    }
    await expect(server.revise(V2)).rejects.toThrow(/closed/);
    expect(await types()).toEqual(["closed"]);
    // Reads keep working.
    expect((await call("GET", "/api/file?path=README.md")).status).toBe(200);
    expect((await call("GET", "/api/events")).json.events).toHaveLength(1);
  });

  test("a close requested while a snapshot is written lands after it, and stays last", async () => {
    const { server, fs, types } = await session();
    const write = fs.writeFile.bind(fs);
    let closing: Promise<void> | undefined;
    fs.writeFile = async (path, content) => {
      closing ??= server.close();
      return write(path, content);
    };
    expect(await server.revise(V2)).toEqual({ version: 2, unchanged: false });
    await closing;
    expect(await types()).toEqual(["revised", "closed"]);
    await expect(server.revise({ "a.md": "late" })).rejects.toThrow(/closed/);
  });
});

describe("reviewer identity", () => {
  test("events carry the email the host passed on", async () => {
    const { call, server } = await session();
    await call(
      "POST",
      "/api/feedback",
      { feedback: "x" },
      { [REVIEWER_HEADER]: "ada@example.com" },
    );
    await call("POST", "/api/approve", {}, { [REVIEWER_HEADER]: "bob@example.com" });
    expect((await server.events()).map((e) => e.by)).toEqual([
      "ada@example.com",
      "bob@example.com",
    ]);
  });

  test("without it there is no by", async () => {
    const { call, server } = await session();
    await call("POST", "/api/feedback", { feedback: "x", by: "mallory@example.com" });
    expect((await server.events())[0]).not.toHaveProperty("by");
  });
});

describe("drafts", () => {
  test("no draft is an empty list", async () => {
    const { call } = await session();
    expect(await call("GET", "/api/draft")).toEqual({ status: 200, json: { annotations: [] } });
  });

  test("last write wins, and only annotations are kept", async () => {
    const { call } = await session();
    expect(
      await call("POST", "/api/draft", { annotations: [note("a")], draftGeneration: 9 }),
    ).toEqual({
      status: 200,
      json: { ok: true },
    });
    await call("POST", "/api/draft", { annotations: [note("b")] });
    expect((await call("GET", "/api/draft")).json).toEqual({ annotations: [note("b")] });
    await call("POST", "/api/draft", { annotations: [] });
    expect((await call("GET", "/api/draft")).json).toEqual({ annotations: [] });
  });

  test("a submission clears the draft, even one that adds nothing", async () => {
    const { call } = await session();
    await call("POST", "/api/draft", { annotations: [note("a")] });
    await call("POST", "/api/feedback", { annotations: [note("a")] });
    expect((await call("GET", "/api/draft")).json.annotations).toEqual([]);
    await call("POST", "/api/draft", { annotations: [note("a")] });
    await call("POST", "/api/feedback", { annotations: [note("a")] });
    expect((await call("GET", "/api/draft")).json.annotations).toEqual([]);
  });

  test("a refused submission keeps the draft", async () => {
    const { call, server } = await session();
    await server.revise(V2);
    await call("POST", "/api/draft", { annotations: [note("a")] });
    expect(
      (await call("POST", "/api/feedback", { annotations: [note("a")], revision: 1 })).status,
    ).toBe(409);
    expect((await call("GET", "/api/draft")).json.annotations).toEqual([note("a")]);
  });

  test("drafts are per version", async () => {
    const { call, server } = await session();
    await call("POST", "/api/draft", { annotations: [note("a")] });
    await server.revise(V2);
    expect((await call("GET", "/api/draft")).json).toEqual({ annotations: [] });
  });

  test("bad drafts are 400s, with the same bounds as submissions", async () => {
    const { call } = await session();
    expect((await call("POST", "/api/draft", {})).status).toBe(400);
    expect((await call("POST", "/api/draft", { annotations: "x" })).status).toBe(400);
    expect((await call("POST", "/api/draft", { annotations: [{ id: "a" }] })).status).toBe(400);
    const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, i) => note(`n${i}`));
    expect((await call("POST", "/api/draft", { annotations: many })).status).toBe(400);
  });

  test("a closed review still saves drafts: no 409s from drafts", async () => {
    const { call, server } = await session();
    await server.close();
    expect((await call("POST", "/api/draft", { annotations: [] })).status).toBe(200);
  });
});
