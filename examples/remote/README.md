# Dynotator for agents that are not Workers

A Worker that embeds Dynotator and adds `/mcp`, so an agent with no service binding can use it:
Claude or any other MCP client connects to the URL, and a coding agent on your laptop uses the CLI
in `cli/`. Deploy your own copy; there is no shared server.

```sh
DYNOTATOR_URL=https://dynotator-remote.example.workers.dev npm run deploy:remote
```

## Put it behind Cloudflare Access first

This Worker checks no tokens, like Dynotator itself. Anyone who can reach `/mcp` can create
reviews and read their feedback, so the deployment is only as private as what sits in front of it.
Turn on [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
for the Worker before you share the URL. One policy then covers all three kinds of caller: the
reviewers who open review pages, the CLI, and MCP clients.

MCP clients cannot complete a browser login redirect. Turn on
[managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
on the Access application and they sign in through the same policy with a standard OAuth flow.

## The MCP server

`index.ts` serves `/mcp` with the official MCP SDK (`@modelcontextprotocol/server`). It is
stateless: one server per request, no Durable Object of its own. The tools are Dynotator's four
methods and return their results as JSON text.

| Tool                | Arguments                            | Returns                  |
| ------------------- | ------------------------------------ | ------------------------ |
| `create_review`     | `files`, `patch?`, `title?`, `open?` | `{ id, url }`            |
| `revise_review`     | `id`, `files`                        | `{ version, unchanged }` |
| `get_review_events` | `id`, `after?`, `wait?`              | `{ events }`             |
| `close_review`      | `id`                                 | `{ ok: true }`           |

A method's error (a bad path, a patch that does not apply, a closed review) comes back as a tool
error with the message. Requests carrying an `Origin` other than the Worker's own are refused, so
a page on another site cannot use a reviewer's Access session to call the tools.

In Claude, add a custom connector with the URL `https://<your-worker>/mcp`, then ask for what you
want reviewed: "put this plan up on Dynotator and wait for my comments".

## The CLI

`cli/dynotator.ts` is an MCP client of the same endpoint. It needs Node 22.18 or later (it runs
as TypeScript) and this repository's `node_modules`. `cli/snapshot.ts` turns the working tree
into the files and patch a review takes.

```sh
ln -s "$PWD/examples/remote/cli/dynotator.ts" ~/.local/bin/dynotator
export DYNOTATOR_URL=https://dynotator-remote.example.workers.dev
```

```sh
dynotator review                  # the working tree's changes against HEAD
dynotator review --base main      # the changes against a branch, tag or commit
dynotator review PLAN.md docs/    # just these files, no diff
dynotator review --base main PLAN.md   # the changes, with PLAN.md as unchanged context
dynotator events --wait 600       # print new feedback, waiting up to ten minutes for it
dynotator revise                  # put the files as they are now up as the next version
dynotator close
```

`review` prints the URL to send to the reviewer. `events`, `revise` and `close` act on the last
review created from the current directory unless you pass an id.

- A change review sends the patch (`git diff` plus untracked files) and the new contents of the
  files it touches. Binary files, files over 1 MiB and anything that is not a regular file are
  left out of both, and listed.
- The CLI keeps each review's paths and event cursor in `~/.config/dynotator/reviews.json`. That
  is how `revise` knows to re-send a file whose change you reverted, and how `events` prints each
  event once.
- Behind Access, the CLI signs in with
  [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/):
  the first call opens a browser. On a machine with no browser, set
  `DYNOTATOR_ACCESS_CLIENT_ID` and `DYNOTATOR_ACCESS_CLIENT_SECRET` to an Access service token.

`skill/SKILL.md` teaches a coding agent to use the CLI. Copy or link it into the agent's skills
directory.

## Develop

```sh
npm run dev:remote
DYNOTATOR_URL=http://localhost:3000 node examples/remote/cli/dynotator.ts review
```

`cloudflare.config.ts` is Dynotator's Worker config with another name (`dynotator-remote`), this
entrypoint, and `/mcp` routed to the Worker before assets. The root `cloudflare.config.ts` returns
it under `--mode remote`, the same way it does for [`examples/self`](../self).
