import { describe, expect, test } from "vitest";
import type { Files } from "./files";
import type { Fs } from "./review";
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

async function session(init: { mode?: "plan" | "annotate"; title?: string; open?: string } = {}) {
  const fs = new MemoryFs();
  const server = new Session(new MemoryStore(), fs);
  await server.init({ mode: "plan", files: V1, ...init });
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
  return { server, call, fs };
}

describe("review payload", () => {
  test("plan mode", async () => {
    const { call } = await session({ title: "T" });
    const { status, json } = await call("GET", "/api/review");
    expect(status).toBe(200);
    expect(json).toEqual({
      mode: "plan",
      title: "T",
      open: "README.md",
      version: 1,
      versions: [{ version: 1, timestamp: json.versions[0].timestamp }],
    });
    expect(Date.parse(json.versions[0].timestamp)).not.toBeNaN();
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 1 });
  });

  test("annotate mode has a revision too, and keeps the requested open path", async () => {
    const { call } = await session({ mode: "annotate", open: "src/a.ts" });
    expect((await call("GET", "/api/review")).json).toMatchObject({
      mode: "annotate",
      open: "src/a.ts",
    });
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 1 });
  });

  test("unknown and removed paths and the other mode's decisions are JSON 404s", async () => {
    const plan = await session();
    expect(await plan.call("GET", "/api/nope")).toEqual({
      status: 404,
      json: { error: "Not found", path: "/api/nope" },
    });
    for (const path of ["/api/plan", "/api/plan/revision", "/api/plan/versions"]) {
      expect((await plan.call("GET", path)).status).toBe(404);
    }
    expect((await plan.call("GET", "/api/plan/version?v=1")).status).toBe(404);
    for (const path of ["/api/feedback", "/api/exit", "/api/upload", "/api/revise"]) {
      expect((await plan.call("POST", path, {})).status).toBe(404);
    }
    const annotate = await session({ mode: "annotate" });
    for (const path of ["/api/approve", "/api/deny"]) {
      expect((await annotate.call("POST", path, {})).status).toBe(404);
    }
    expect(plan.server.decision()).toBeNull();
    expect(annotate.server.decision()).toBeNull();
  });

  test("an uninitialised facet answers 404", async () => {
    const server = new Session(new MemoryStore(), new MemoryFs());
    expect((await server.fetch(new Request("https://facet/api/review"))).status).toBe(404);
  });

  test("init refuses to run twice", async () => {
    const { server } = await session();
    await expect(server.init({ mode: "plan", files: V1 })).rejects.toThrow();
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
    for (const bad of ["../x", "/etc/passwd", "src/../README.md", "a//b", "./a", ""]) {
      const res = await call("GET", `/api/file?path=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
    expect((await call("GET", "/api/file")).status).toBe(400);
    for (const v of ["0", "-1", "x", "1.5", ""]) {
      expect((await call("GET", `/api/files?v=${v}`)).status).toBe(400);
    }
  });
});

describe("decisions", () => {
  test("plan approve keeps notes; empty notes are omitted", async () => {
    const a = await session();
    expect(await a.call("POST", "/api/approve", { feedback: "nit", revision: 1 })).toEqual({
      status: 200,
      json: { ok: true },
    });
    const d = a.server.decision();
    expect(d).toEqual({ approved: true, feedback: "nit", version: 1, decidedAt: d!.decidedAt });
    expect(Date.parse(d!.decidedAt)).not.toBeNaN();

    const b = await session();
    await b.call("POST", "/api/approve", { feedback: "" });
    expect(Object.keys(b.server.decision()!).toSorted()).toEqual([
      "approved",
      "decidedAt",
      "version",
    ]);
  });

  test("plan deny carries feedback and answersOnly, and ignores unknown fields", async () => {
    const { call, server } = await session();
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
    const { call, server } = await session({ mode: "annotate" });
    const annotations = [{ id: "a", path: "src/a.ts" }];
    await call("POST", "/api/feedback", { feedback: "fix it", annotations });
    expect(server.decision()).toMatchObject({ approved: false, feedback: "fix it", annotations });
  });

  test("annotate exit is a bare POST and records only exit", async () => {
    const { call, server } = await session({ mode: "annotate" });
    expect((await call("POST", "/api/exit?draftGeneration=1")).json).toEqual({ ok: true });
    const d = server.decision()!;
    expect(d).toEqual({ approved: false, exit: true, version: 1, decidedAt: d.decidedAt });
  });

  test("malformed bodies are 400s and record nothing", async () => {
    const { call, server } = await session({ mode: "annotate" });
    expect((await call("POST", "/api/feedback", { annotations: "nope" })).status).toBe(400);
    expect((await call("POST", "/api/feedback", { feedback: 5 })).status).toBe(400);
    expect((await call("POST", "/api/feedback", "[1]")).status).toBe(400);
    expect((await call("POST", "/api/feedback", "{")).status).toBe(400);
    expect(server.decision()).toBeNull();
  });

  test("a second decision is refused with already_decided and keeps the first", async () => {
    const { call, server } = await session();
    await call("POST", "/api/approve", {});
    const again = await call("POST", "/api/deny", { feedback: "late" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_decided");
    expect(server.decision()!.approved).toBe(true);
  });

  test("a decision on a replaced version is refused with revised", async () => {
    const { call, server } = await session();
    await server.revise({ ...V1, "README.md": "# v2" });
    const stale = await call("POST", "/api/approve", { revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "revised", revision: 2 });
    expect(server.decision()).toBeNull();
    expect((await call("POST", "/api/approve", { revision: 2 })).status).toBe(200);
  });
});

describe("wait", () => {
  test("resolves every pending waiter with the decision", async () => {
    const { call, server } = await session();
    const waits = [server.wait(30), server.wait(30)];
    await call("POST", "/api/deny", { feedback: "no" });
    const [a, b] = await Promise.all(waits);
    expect(a).toMatchObject({ approved: false, feedback: "no", version: 1 });
    expect(b).toEqual(a);
  });

  test("returns a standing decision at once", async () => {
    const { call, server } = await session();
    await call("POST", "/api/approve", {});
    expect((await server.wait(30))!.approved).toBe(true);
  });

  test("times out with null", async () => {
    const { server } = await session();
    const started = performance.now();
    expect(await server.wait(0.02)).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("a waiter that timed out is not resolved later", async () => {
    const { call, server } = await session();
    expect(await server.wait(0)).toBeNull();
    await call("POST", "/api/approve", {});
    expect((await server.wait(0))!.approved).toBe(true);
  });
});

describe("revise and versions", () => {
  const V2: Files = { "README.md": "# v2", "src/a.ts": "a", "src/c.ts": "c" };

  test("a snapshot becomes the next version; the old one stays readable", async () => {
    const { call, server } = await session();
    await call("POST", "/api/deny", { feedback: "no" });
    expect(await server.revise(V2)).toEqual({ version: 2, unchanged: false });
    expect(server.decision()).toBeNull();
    expect((await call("GET", "/api/review")).json).toMatchObject({ version: 2, open: "README.md" });
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 2 });
    const versions = (await call("GET", "/api/review")).json.versions;
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await call("GET", "/api/files")).json.files.map((f: { path: string }) => f.path)).toEqual(
      ["README.md", "src/a.ts", "src/c.ts"],
    );
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
    expect((await call("GET", "/api/changes?from=2&to=1")).json.files).toEqual([
      { path: "README.md", status: "modified" },
      { path: "src/c.ts", status: "deleted" },
      { path: "src/deep/b.ts", status: "added" },
    ]);
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

  test("the decision records the version it was made on", async () => {
    const { call, server } = await session();
    for (let v = 2; v <= 4; v++) {
      await call("POST", "/api/deny", { feedback: `round ${v}`, revision: v - 1 });
      await server.revise({ ...V1, "README.md": `# v${v}` });
    }
    await call("POST", "/api/approve", { revision: 4 });
    expect(server.decision()).toMatchObject({ approved: true, version: 4 });
  });

  test("an unchanged snapshot adds no version and leaves the decision standing", async () => {
    const { call, server, fs } = await session();
    await call("POST", "/api/deny", {});
    expect(await server.revise({ "src/deep/b.ts": "b", "README.md": "# v1", "src/a.ts": "a" })).toEqual(
      { version: 1, unchanged: true },
    );
    expect(server.decision()).toMatchObject({ approved: false, version: 1 });
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

  test("revise is refused after approval and after exit, and keeps the decision", async () => {
    const plan = await session();
    await plan.call("POST", "/api/approve", {});
    await expect(plan.server.revise(V2)).rejects.toThrow(/finished/);
    expect(plan.server.decision()!.approved).toBe(true);

    const annotate = await session({ mode: "annotate" });
    await annotate.call("POST", "/api/exit");
    await expect(annotate.server.revise(V2)).rejects.toThrow(/finished/);
    expect(annotate.server.decision()!.exit).toBe(true);
  });

  test("an approval that lands while a snapshot is written wins over the snapshot", async () => {
    const { call, server, fs } = await session();
    const write = fs.writeFile.bind(fs);
    let approved = false;
    fs.writeFile = async (path, content) => {
      if (!approved) {
        approved = true;
        await call("POST", "/api/approve", {});
      }
      return write(path, content);
    };
    await expect(server.revise(V2)).rejects.toThrow(/finished/);
    expect(server.decision()).toMatchObject({ approved: true, version: 1 });
    expect((await call("GET", "/api/revision")).json).toEqual({ revision: 1 });
    // The abandoned tree is cleared by the next attempt, not served.
    expect((await call("GET", "/api/files?v=2")).status).toBe(404);
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

  test("revise is allowed after annotate feedback", async () => {
    const { call, server } = await session({ mode: "annotate" });
    await call("POST", "/api/feedback", { feedback: "x", annotations: [] });
    expect((await server.revise(V2)).version).toBe(2);
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
    const { call } = await session();
    expect(await call("GET", "/api/draft")).toEqual({ status: 200, json: {} });
  });

  test("round trip keeps exactly the draft fields", async () => {
    const { call } = await session();
    expect((await call("POST", "/api/draft", { ...save(5), extra: "x" })).status).toBe(200);
    expect(await call("GET", "/api/draft")).toEqual({
      status: 200,
      json: { annotations: [5], draftGeneration: 5, ts: 1 },
    });
  });

  test("an older generation is refused with the latest; the same one overwrites", async () => {
    const { call } = await session();
    await call("POST", "/api/draft", save(5));
    const stale = await call("POST", "/api/draft", save(4));
    expect(stale).toEqual({ status: 409, json: { error: "Stale draft", draftGeneration: 5 } });
    expect((await call("POST", "/api/draft", save(5, ["again"]))).status).toBe(200);
    expect((await call("GET", "/api/draft")).json.annotations).toEqual(["again"]);
  });

  test("a delete leaves a tombstone that refuses saves up to its generation", async () => {
    const { call } = await session();
    await call("POST", "/api/draft", save(5));
    expect((await call("DELETE", "/api/draft?generation=6")).status).toBe(200);
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 6 });
    expect((await call("POST", "/api/draft", save(6))).status).toBe(409);
    expect((await call("POST", "/api/draft", save(7))).status).toBe(200);
  });

  test("a delete older than the stored draft is ignored", async () => {
    const { call } = await session();
    await call("POST", "/api/draft", save(5));
    await call("DELETE", "/api/draft?generation=3");
    expect((await call("GET", "/api/draft")).json.draftGeneration).toBe(5);
  });

  test("bad draft requests are 400s", async () => {
    const { call } = await session();
    expect((await call("POST", "/api/draft", { annotations: [] })).status).toBe(400);
    expect((await call("POST", "/api/draft", { draftGeneration: 1 })).status).toBe(400);
    expect((await call("POST", "/api/draft", { ...save(1), ts: "now" })).status).toBe(400);
    expect((await call("DELETE", "/api/draft")).status).toBe(400);
    expect((await call("DELETE", "/api/draft?generation=-1")).status).toBe(400);
  });

  test("a decision deletes the draft and later saves are refused as decided", async () => {
    const { call } = await session();
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/deny", { feedback: "no", draftGeneration: 2 });
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 2 });
    expect(await call("POST", "/api/draft", save(3))).toEqual({
      status: 409,
      json: { error: "This review has already been decided.", decided: true },
    });
  });

  test("exit's draft generation comes from the query string", async () => {
    const { call } = await session({ mode: "annotate" });
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/exit?draftGeneration=2");
    expect((await call("GET", "/api/draft")).json).toEqual({ draftGeneration: 2 });
  });

  test("drafts are per version", async () => {
    const { call, server } = await session();
    await call("POST", "/api/draft", save(1));
    await call("POST", "/api/deny", { feedback: "no" });
    await server.revise({ "a.md": "2" });
    expect((await call("GET", "/api/draft")).json).toEqual({});
  });
});
