import { parseArgs } from "node:util";

export interface Config {
  url?: string;
  noBrowser: boolean;
}

export interface ParsedArgs {
  command?: string;
  positionals: string[];
  help: boolean;
  version: boolean;
  config: Config;
}

export function parseCli(argv: string[], env: Record<string, string | undefined>): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      "no-browser": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const url = (values.url ?? env.DYNOTATOR_URL)?.trim().replace(/\/+$/, "");
  const noBrowserEnv = env.DYNOTATOR_NO_BROWSER;
  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    help: values.help === true,
    version: values.version === true,
    config: {
      url: url || undefined,
      noBrowser:
        values["no-browser"] === true ||
        (noBrowserEnv !== undefined && noBrowserEnv !== "" && noBrowserEnv !== "0"),
    },
  };
}

export const HELP = `dynotator: send plans and markdown to a Dynotator server for human review.

Usage:
  dynotator [plan]                 Claude Code PermissionRequest hook for ExitPlanMode.
                                   Reads the hook event on stdin, prints the decision JSON.
  dynotator annotate <file.md|->   Review a markdown file (or stdin) and print the feedback.
  dynotator revise <url|id> <file.md|->
                                   Submit a new version into an existing session, wait for
                                   the decision and print the feedback.

Options:
  --url <url>      Server URL (default: $DYNOTATOR_URL)
  --no-browser     Do not open the review page (also: DYNOTATOR_NO_BROWSER=1)
  -h, --help       Show this help
  -v, --version    Show the version

If the server is behind Cloudflare Access, the CLI signs in through cloudflared.
The review URL is printed to stderr. Stdout carries only the result for the agent.
`;
