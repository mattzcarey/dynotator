#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { openBrowser, run } from "./commands.ts";
import { defaultStateDir } from "./hook.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version);
  } catch {
    return "dev";
  }
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stateDir: defaultStateDir(process.env, homedir()),
  version: version(),
  stdinIsTTY: process.stdin.isTTY === true,
  readStdin,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openBrowser,
});
