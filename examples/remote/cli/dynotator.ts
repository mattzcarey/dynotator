#!/usr/bin/env node
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { ReviewEvent, Revision } from "../../../session/events.ts";
import {
  Failure,
  type Snapshot,
  addFiles,
  collectChange,
  expandPaths,
  gitRoot,
} from "./snapshot.ts";

const USAGE = `dynotator: put local files up for human review on a deployed Dynotator.

  dynotator review [--base REF] [--title T] [--open PATH] [PATH...]
      No arguments: review the working tree's changes against HEAD.
      --base REF:   review the changes against REF (a branch, tag or commit).
      PATH...:      review just these files or directories. With --base, they ride
                    along with the changes as unchanged context.
  dynotator events [ID] [--wait SECONDS] [--after SEQ] [--json]
      Print events not yet seen: the reviewer's feedback and approvals.
      --wait holds on until one arrives or the time runs out.
  dynotator revise [ID]     Put the files as they are now up as the next version.
  dynotator close [ID]      End the review.

ID defaults to the last review created from this directory.

Environment:
  DYNOTATOR_URL                    The deployed Worker, for example https://dynotator.example.com
  DYNOTATOR_ACCESS_CLIENT_ID,      A Cloudflare Access service token, for machines with no
  DYNOTATOR_ACCESS_CLIENT_SECRET   browser. Otherwise the CLI signs in with cloudflared.`;

const MAX_WAIT_PER_CALL = 55;

/** What the CLI remembers about a review it created, so `revise` and `events` need no arguments. */
interface Tracked {
  url: string;
  server: string;
  root: string;
  /** The ref the change is against. Absent when the review is of plain files. */
  base?: string;
  /** Every path a version has touched. `revise` re-reads them all, so a reverted change is kept. */
  paths: string[];
  /** The last event `seq` printed. */
  cursor: number;
  createdAt: string;
}

const STATE_FILE = path.join(homedir(), ".config", "dynotator", "reviews.json");

function loadState(): Record<string, Tracked> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, Tracked>;
  } catch {
    return {};
  }
}

function saveState(state: Record<string, Tracked>): void {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Headers that get a request through Cloudflare Access, or none if the server is not behind it. */
async function accessHeaders(server: string): Promise<Record<string, string>> {
  const id = process.env.DYNOTATOR_ACCESS_CLIENT_ID;
  const secret = process.env.DYNOTATOR_ACCESS_CLIENT_SECRET;
  if (id && secret) return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };

  const probe = await fetch(new URL("/mcp", server), { redirect: "manual" });
  const behindAccess =
    probe.status === 401 || (probe.headers.get("location") ?? "").includes("cloudflareaccess.com");
  if (!behindAccess) return {};

  const token = () => {
    const run = spawnSync("cloudflared", ["access", "token", `-app=${server}`], {
      encoding: "utf8",
    });
    if (run.error) {
      throw new Failure(
        `${server} is behind Cloudflare Access. Install cloudflared to sign in, or set DYNOTATOR_ACCESS_CLIENT_ID and DYNOTATOR_ACCESS_CLIENT_SECRET.`,
      );
    }
    const value = run.stdout.trim();
    return run.status === 0 && value.split(".").length === 3 ? value : undefined;
  };
  let jwt = token();
  if (!jwt) {
    console.error(`Signing in to ${server} with Cloudflare Access...`);
    spawnSync("cloudflared", ["access", "login", server], { stdio: ["ignore", 2, 2] });
    jwt = token();
  }
  if (!jwt) throw new Failure(`Could not sign in. Try: cloudflared access login ${server}`);
  return { "cf-access-token": jwt };
}

type Call = <T>(tool: string, args: Record<string, unknown>) => Promise<T>;

/** Runs `use` with a function that calls the server's MCP tools. */
async function withServer<T>(server: string, use: (call: Call) => Promise<T>): Promise<T> {
  const headers = await accessHeaders(server);
  const client = new Client({ name: "dynotator-cli", version: "0.1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server), {
      requestInit: { headers, redirect: "manual" },
    }),
  );
  try {
    return await use(async <R>(tool: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: tool, arguments: args }, { timeout: 120_000 });
      const first = result.content[0];
      const text = first?.type === "text" ? first.text : "";
      if (result.isError) throw new Failure(text || `${tool} failed`);
      return JSON.parse(text) as R;
    });
  } finally {
    await client.close();
  }
}

function printEvent(event: ReviewEvent): void {
  const who = event.by ? ` by ${event.by}` : "";
  console.log(`## #${event.seq} ${event.type} on version ${event.version}${who} (${event.at})`);
  if (event.feedback) console.log(`\n${event.feedback.trim()}\n`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      base: { type: "string" },
      title: { type: "string" },
      open: { type: "string" },
      after: { type: "string" },
      wait: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    console.log(USAGE);
    return;
  }
  const server = process.env.DYNOTATOR_URL?.replace(/\/+$/, "");
  if (!server) throw new Failure("Set DYNOTATOR_URL to your deployed Dynotator Worker.");

  const repo = gitRoot();
  const root = repo ?? process.cwd();
  const state = loadState();
  const resolve = (given: string | undefined): string => {
    if (given) return given;
    const latest = Object.entries(state)
      .filter(([, t]) => t.root === root && t.server === server)
      .toSorted(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) throw new Failure(`No review was created from ${root}. Pass its id.`);
    return latest[0];
  };

  if (command === "review") {
    if (!repo && (values.base || rest.length === 0)) {
      throw new Failure("Not a git repository: name the files to review.");
    }
    const base = values.base ?? (rest.length === 0 ? "HEAD" : undefined);
    const snapshot: Snapshot =
      base === undefined
        ? { files: {}, deleted: [], changed: 0, skipped: [] }
        : collectChange(root, base);
    addFiles(root, snapshot, expandPaths(root, repo !== undefined, rest));
    const count = Object.keys(snapshot.files).length;
    if (count === 0 && !snapshot.patch) throw new Failure("Nothing to review.");

    const review = await withServer(server, (call) =>
      call<{ id: string; url: string }>("create_review", {
        files: snapshot.files,
        ...(snapshot.patch && { patch: snapshot.patch }),
        title: values.title ?? path.basename(root),
        ...(values.open && { open: values.open }),
      }),
    );
    state[review.id] = {
      url: review.url,
      server,
      root,
      ...(base !== undefined && { base }),
      paths: [...Object.keys(snapshot.files), ...snapshot.deleted],
      cursor: 0,
      createdAt: new Date().toISOString(),
    };
    saveState(state);
    console.log(review.url);
    console.log(`id: ${review.id}`);
    const what = base === undefined ? "" : `, ${snapshot.changed} changed against ${base}`;
    console.log(`${count} files${what}.`);
    if (snapshot.skipped.length > 0) {
      console.log(`Left out (binary, over 1 MiB or not a file): ${snapshot.skipped.join(", ")}`);
    }
    console.log("Read the reviewer's feedback with: dynotator events --wait 600");
    return;
  }

  if (command === "events") {
    const id = resolve(rest[0]);
    const tracked = state[id];
    let after = values.after === undefined ? (tracked?.cursor ?? 0) : Number(values.after);
    const deadline = Date.now() + Number(values.wait ?? 0) * 1000;
    const events = await withServer(server, async (call) => {
      for (;;) {
        const left = Math.max(0, (deadline - Date.now()) / 1000);
        const wait = Math.min(MAX_WAIT_PER_CALL, Math.floor(left));
        const got = await call<{ events: ReviewEvent[] }>("get_review_events", { id, after, wait });
        if (got.events.length > 0 || wait === 0) return got.events;
      }
    });
    if (events.length > 0) after = events[events.length - 1].seq;
    if (tracked) {
      tracked.cursor = Math.max(tracked.cursor, after);
      saveState(state);
    }
    if (values.json) console.log(JSON.stringify(events, null, 2));
    else if (events.length === 0) console.log("No new events.");
    else events.forEach(printEvent);
    return;
  }

  if (command === "revise") {
    const id = resolve(rest[0]);
    const tracked = state[id];
    if (!tracked) throw new Failure(`${id} was not created by this CLI, so its files are unknown.`);
    const snapshot: Snapshot =
      tracked.base === undefined
        ? { files: {}, deleted: [], changed: 0, skipped: [] }
        : collectChange(tracked.root, tracked.base);
    addFiles(tracked.root, snapshot, tracked.paths);
    if (Object.keys(snapshot.files).length === 0) throw new Failure("No files left to review.");
    const revision = await withServer(server, (call) =>
      call<Revision>("revise_review", { id, files: snapshot.files }),
    );
    tracked.paths = [
      ...new Set([...tracked.paths, ...Object.keys(snapshot.files), ...snapshot.deleted]),
    ];
    saveState(state);
    console.log(
      revision.unchanged
        ? `Nothing changed: still version ${revision.version}.`
        : `Version ${revision.version} is up at ${tracked.url}`,
    );
    return;
  }

  if (command === "close") {
    const id = resolve(rest[0]);
    await withServer(server, (call) => call("close_review", { id }));
    console.log(`Closed ${id}.`);
    return;
  }

  throw new Failure(`Unknown command: ${command}\n\n${USAGE}`);
}

try {
  await main();
} catch (err) {
  if (!(err instanceof Failure)) throw err;
  console.error(`dynotator: ${err.message}`);
  process.exitCode = 1;
}
