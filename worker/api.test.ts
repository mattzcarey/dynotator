import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Decision } from "../session/decision";
import { isSessionId } from "./routes";

// Same stand-ins as session/session.test.ts: bun shares one module registry across test files.
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

interface Api {
  createReview(init: unknown): Promise<{ id: string; url: string }>;
  getDecision(id: string): Promise<Decision | null>;
}

// Imported by a computed path so that the tests' type check (no Workers types) does not follow it.
const API = "./api";
let Dynotator: new (ctx: unknown, env: unknown) => Api;
beforeAll(async () => {
  ({ Dynotator } = await import(API));
});

function api(publicUrl = "https://review.example/") {
  const created: Array<{ id: string; init: unknown; ttl: number }> = [];
  const asked: string[] = [];
  const supervisor = (id: string) => ({
    create: async (init: unknown, ttl: number) => void created.push({ id, init, ttl }),
    decision: async () => (asked.push(id), null),
  });
  const ctx = { exports: { SessionSupervisor: { getByName: supervisor } } };
  const env = { PUBLIC_URL: publicUrl, SESSION_TTL_SECONDS: "60" };
  return { api: new Dynotator(ctx, env), created, asked };
}

describe("createReview", () => {
  test("seeds a supervisor under a fresh id and returns the public URL", async () => {
    const { api: a, created } = api();
    const review = await a.createReview({ mode: "annotate", markdown: "# x", title: "T" });
    expect(isSessionId(review.id)).toBe(true);
    expect(review.url).toBe(`https://review.example/s/${review.id}`);
    expect(created).toEqual([
      { id: review.id, init: { mode: "annotate", markdown: "# x", title: "T" }, ttl: 60 },
    ]);
  });

  test("passes on only the known fields", async () => {
    const { api: a, created } = api();
    const init = { mode: "plan", markdown: "", origin: "cli", title: "" };
    await a.createReview(init);
    expect(created[0].init).toEqual({ mode: "plan", markdown: "" });
  });

  test.each([
    [{ mode: "review", markdown: "x" }, /mode/],
    [{ mode: "plan" }, /markdown/],
    [{ mode: "plan", markdown: "é".repeat(500_001) }, /exceeds/],
    [{ mode: "plan", markdown: "x", title: 5 }, /title/],
    [null, /Expected/],
  ])("rejects %j", async (init, message) => {
    const { api: a, created } = api();
    await expect(a.createReview(init)).rejects.toThrow(message);
    expect(created).toHaveLength(0);
  });
});

test("ids that cannot be review ids never reach a supervisor", async () => {
  const { api: a, asked } = api();
  await expect(a.getDecision("../x")).rejects.toThrow(/does not exist/);
  expect(asked).toHaveLength(0);
});
