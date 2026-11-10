import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { HELP, parseCli, type Config } from "./args.ts";
import {
  clearState,
  hookOutput,
  parseHookEvent,
  readState,
  resolvePlan,
  writeState,
} from "./hook.ts";
import {
  createSession,
  revise,
  waitForDecision,
  type Decision,
  type Fetch,
  type Session,
} from "./http.ts";

export interface Context {
  env: Record<string, string | undefined>;
  cwd: string;
  stateDir: string;
  version: string;
  stdinIsTTY: boolean;
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  openBrowser: (url: string) => void;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

class UsageError extends Error {}

export async function run(argv: string[], ctx: Context): Promise<number> {
  let args;
  try {
    args = parseCli(argv, ctx.env);
  } catch (error) {
    ctx.stderr(`dynotator: ${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    ctx.stdout(HELP);
    return 0;
  }
  if (args.version) {
    ctx.stdout(`${ctx.version}\n`);
    return 0;
  }

  if (args.command === undefined || args.command === "plan") {
    if (args.command === undefined && ctx.stdinIsTTY) {
      ctx.stdout(HELP);
      return 0;
    }
    return planHook(args.config, ctx);
  }

  try {
    if (args.command === "annotate") return await annotate(args.positionals, args.config, ctx);
    if (args.command === "revise") return await reviseCommand(args.positionals, args.config, ctx);
    throw new UsageError(`unknown command "${args.command}"`);
  } catch (error) {
    ctx.stderr(`dynotator: ${(error as Error).message}\n`);
    if (error instanceof UsageError) ctx.stderr(`\n${HELP}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

function requireUrl(config: Config): string {
  if (!config.url) {
    throw new UsageError(
      "no server URL: set DYNOTATOR_URL or pass --url https://your-worker.example",
    );
  }
  return config.url;
}

// A failing hook must not block the agent: exit non-zero with nothing on stdout, and Claude
// Code falls back to its own plan approval dialog.
async function planHook(config: Config, ctx: Context): Promise<number> {
  try {
    const event = parseHookEvent(await ctx.readStdin());
    if (!event) return 0;
    if (event.tool_name !== undefined && event.tool_name !== "ExitPlanMode") return 0;

    const plan = resolvePlan(event.tool_input);
    if (!plan) throw new Error("No plan content in hook event");
    const baseUrl = requireUrl(config);
    const claudeSessionId = typeof event.session_id === "string" ? event.session_id : "";

    let session: Session | undefined;
    const prior = claudeSessionId ? readState(ctx.stateDir, claudeSessionId) : undefined;
    if (prior && prior.baseUrl === baseUrl) {
      try {
        await revise(prior.apiUrl, plan, ctx.fetch);
        session = prior;
      } catch (error) {
        ctx.stderr(
          `dynotator: could not revise the previous session, starting a new one (${(error as Error).message})\n`,
        );
      }
    }
    session ??= await createSession(
      baseUrl,
      {
        mode: "plan",
        markdown: plan,
        origin: "claude-code",
        permissionMode: event.permission_mode || "default",
        project: projectName(typeof event.cwd === "string" && event.cwd ? event.cwd : ctx.cwd),
      },
      ctx.fetch,
    );
    if (claudeSessionId) writeState(ctx.stateDir, claudeSessionId, { ...session, baseUrl });

    const decision = await review(session, config, ctx);
    if (claudeSessionId && decision.approved) clearState(ctx.stateDir, claudeSessionId);
    ctx.stdout(`${hookOutput(event, plan, decision)}\n`);
    return 0;
  } catch (error) {
    ctx.stderr(`dynotator: ${(error as Error).message}\n`);
    return 1;
  }
}

async function annotate(positionals: string[], config: Config, ctx: Context): Promise<number> {
  if (positionals.length !== 1) throw new UsageError("annotate takes one file (or - for stdin)");
  const baseUrl = requireUrl(config);
  const { markdown, filePath } = await readInput(positionals[0], ctx);
  const session = await createSession(
    baseUrl,
    {
      mode: "annotate",
      markdown,
      ...(filePath && { filePath, title: basename(filePath) }),
      ...(ctx.env.CLAUDECODE && { origin: "claude-code" }),
      project: projectName(ctx.cwd),
    },
    ctx.fetch,
  );
  const decision = await review(session, config, ctx);
  printAnnotateOutcome(decision, filePath, ctx);
  return 0;
}

async function reviseCommand(positionals: string[], config: Config, ctx: Context): Promise<number> {
  if (positionals.length !== 2) throw new UsageError("revise takes a session URL or id and a file");
  const [target, file] = positionals;
  const apiUrl = sessionApiUrl(target, config.url);
  const { markdown, filePath } = await readInput(file, ctx);
  await revise(apiUrl, markdown, ctx.fetch);
  const url = apiUrl.replace(/\/api$/, "");
  const decision = await review({ id: basename(url), url, apiUrl }, config, ctx);
  printAnnotateOutcome(decision, filePath, ctx);
  return 0;
}

export function sessionApiUrl(target: string, baseUrl: string | undefined): string {
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    const match = /^(.*\/s\/[^/]+)/.exec(url.pathname);
    if (!match) throw new UsageError(`not a session URL: ${target}`);
    return `${url.origin}${match[1]}/api`;
  }
  if (!/^[\w-]+$/.test(target)) throw new UsageError(`not a session URL or id: ${target}`);
  if (!baseUrl) throw new UsageError("a bare session id needs DYNOTATOR_URL or --url");
  return `${baseUrl}/s/${target}/api`;
}

async function review(session: Session, config: Config, ctx: Context): Promise<Decision> {
  ctx.stderr(`dynotator: review at ${session.url}\n`);
  if (!config.noBrowser) ctx.openBrowser(session.url);
  return waitForDecision(session.apiUrl, {
    fetch: ctx.fetch,
    sleep: ctx.sleep,
    onRetry: (error, attempt) =>
      ctx.stderr(`dynotator: ${(error as Error).message}; retrying (${attempt})\n`),
  });
}

async function readInput(file: string, ctx: Context) {
  if (file === "-") return { markdown: await ctx.readStdin(), filePath: undefined };
  const filePath = resolve(ctx.cwd, file);
  return { markdown: readFileSync(filePath, "utf8"), filePath };
}

const ANNOTATE_APPROVED_WITH_NOTES_PROMPT =
  "# Approved with Notes\n\nThe artifact is approved. The notes below are non-blocking guidance, not a request for another revision.\n\n{{contextBlock}}{{feedback}}\n\nDo not revise or reopen the artifact solely because of these notes unless the user explicitly requests it. Carry the notes into subsequent work where applicable.";

export function annotateOutcome(decision: Decision, filePath: string | undefined): string | null {
  if (decision.exit === true) return null;
  const feedback = decision.feedback?.trim() ? decision.feedback : "";
  if (!decision.approved) return feedback || null;
  if (!feedback) return "The user approved.";
  return ANNOTATE_APPROVED_WITH_NOTES_PROMPT.replace(
    "{{contextBlock}}",
    filePath ? `File: ${filePath}\n\n` : "",
  ).replace("{{feedback}}", () => feedback);
}

function printAnnotateOutcome(decision: Decision, filePath: string | undefined, ctx: Context) {
  const output = annotateOutcome(decision, filePath);
  if (output !== null) ctx.stdout(`${output}\n`);
}

function projectName(cwd: string): string {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    if (top) return basename(top);
  } catch {
    // Not a git checkout, or git is not installed.
  }
  return basename(cwd) || "_unknown";
}

export function openBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best effort: the URL is already on stderr.
  }
}
