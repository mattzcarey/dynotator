# Dynotator

Dynotator lets a person review and annotate a coding agent's plan in the browser before the agent
acts on it. The agent sends the plan (or any markdown file) to a server, the reviewer approves it or
sends feedback, and the agent receives that decision.

It is a fork of [Plannotator](https://github.com/backnotprop/plannotator) by backnotprop, forked at
commit `38d4d7c`. The review UI is upstream's, simplified. Plannotator and Dynotator are both
licensed under MIT OR Apache-2.0; see [LICENSE-MIT](LICENSE-MIT) and
[LICENSE-APACHE](LICENSE-APACHE).

## How it differs from Plannotator

Plannotator runs on the developer's machine: each review starts a local Bun server and opens a
browser tab on it. Dynotator runs on Cloudflare Workers instead. Each review session gets its own
server, loaded as a Dynamic Worker and run as a Durable Object facet with its own storage. The
agent-side `dynotator` CLI creates the session over HTTP and long-polls for the decision, so the
reviewer does not have to be on the machine the agent runs on: anyone with the session URL can
review.

Everything that needs the local machine, a local agent process or an LLM provider was removed.

## Architecture

- A host Worker (`worker/`) routes requests and serves the browser app. It does no authentication of
  its own; put it behind Cloudflare Access.
- A `SessionSupervisor` Durable Object per session loads the session server (`session/`) as a
  Dynamic Worker and runs it as a facet. The session server keeps the plan, versions, drafts and
  the decision in its own SQLite storage.
- The browser app (`app/`, `packages/`) is served at `/s/<id>` and talks to `/s/<id>/api/*`.
- The CLI (`cli/`) is the agent side: `POST /api/sessions`, then `GET /s/<id>/api/wait`.

[AGENTS.md](AGENTS.md) has the layout, the HTTP contract and the tooling rules.

## Deploy

You need a Cloudflare account with Workers enabled and [Bun](https://bun.sh).

```sh
bun install
bun run deploy
```

`bun run deploy` runs `cf deploy` (the [Cloudflare CLI](https://developers.cloudflare.com/cf/),
configured by `cloudflare.config.ts`), which builds the browser app and the Worker in one Vite
build and deploys them. It prints the Worker's URL; that is your `DYNOTATOR_URL`. Sign in first
with `bunx cf login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The Worker has no authentication of its own: as deployed, anyone who can reach it can create
sessions. Protect it with [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/):
in the dashboard open the Worker, select the **Access** tab, choose **Protect this Worker behind
Access** for all traffic, and pick who may sign in. Reviewers then sign in with your identity
provider in the browser, and the CLI signs in as you through
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
(it runs `cloudflared access login` the first time Access challenges it). No token is configured
anywhere.

Within that boundary, session URLs are unguessable capabilities: whoever has one and passes Access
can read and decide that session. Sessions expire after 7 days by default.

## Claude Code setup

Put the CLI on your `PATH` as `dynotator`. From a checkout of this repository, either run
`bun link`, or symlink the entry point (it has a `#!/usr/bin/env bun` shebang):

```sh
ln -s "$PWD/cli/index.ts" ~/.local/bin/dynotator
```

Then tell Claude Code where the server is, for example in `~/.claude/settings.json` (hooks inherit
this environment):

```json
{
  "env": {
    "DYNOTATOR_URL": "https://dynotator.example.workers.dev"
  }
}
```

Register the hook, either by loading the plugin in `cli/claude/`:

```sh
claude --plugin-dir /path/to/dynotator/cli/claude
```

or by adding the hook to `~/.claude/settings.json` yourself:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "dynotator plan", "timeout": 345600 }]
      }
    ]
  }
}
```

Restart Claude Code after changing hooks. When Claude calls `ExitPlanMode`, the hook creates a
session, prints the review URL to stderr and opens it in your browser. Approving lets Claude
continue (in the permission mode the reviewer picked, if any). Sending feedback denies the
request, and Claude gets the feedback and revises the plan.

The next `ExitPlanMode` from the same Claude Code session is submitted to the same review session
as a new version, so the reviewer sees what changed. The CLI remembers that session in a small file
under your cache directory (`~/.cache/dynotator/sessions` on Linux, `~/Library/Caches` on macOS,
`%LOCALAPPDATA%` on Windows) and forgets it once a plan is approved.

If the hook cannot run (no `DYNOTATOR_URL`, server unreachable, Access sign-in failed), it writes the reason
to stderr and exits with status 1 without a decision, and Claude Code shows its own plan approval
dialog instead.

## CLI

```
dynotator [plan]                       Claude Code ExitPlanMode hook (hook event on stdin)
dynotator annotate <file.md|->         review a markdown file or stdin, print the feedback
dynotator revise <url|id> <file.md|->  submit a new version into an existing session
```

Options: `--url` (default `$DYNOTATOR_URL`), `--no-browser`
(or `DYNOTATOR_NO_BROWSER=1`), `--help`, `--version`. Flags take precedence over the environment.

The review URL always goes to stderr; stdout carries only what the agent should read. `annotate`
and `revise` print the reviewer's feedback, `The user approved.` for a plain approval, or nothing
if the reviewer closed the session without a decision. While waiting, network errors and 5xx
responses are retried with backoff; a 4xx (for example an expired session) ends the command with
an error.

The CLI has no dependencies. It runs with `bun cli/index.ts` and with Node 22.18 or newer
(`node cli/index.ts`).

## Local development

```sh
bun install
bun run dev
```

`bun run dev` runs `cf dev`: one Vite dev server on port 3000 serving the browser app with HMR and
the real Worker, Dynamic Workers and facets included. Point the CLI at it with
`DYNOTATOR_URL=http://localhost:3000`.

`bun run check` runs the formatter check, the linter, the type checker and the tests.

## What was removed

Compared with upstream, Dynotator drops the Inbox, code review, Guided Reviews, Shapes, Ask AI,
agent terminals, local file features (linked docs, file browser, saving back to source, HTML and
AsciiDoc documents, bundles), note-app and VS Code integrations, the archive browser, update
checks, telemetry, the paste/share service, WebMCP, every harness integration other than the
Claude Code hook, the theme catalogue and the mascot sprites. [AGENTS.md](AGENTS.md) keeps the
authoritative list and the rule for deciding what else goes.
