# Dynotator for agents that are not Workers

A Worker that embeds Dynotator and adds `/mcp`, so an agent with no service binding can use it:
Claude or any other MCP client connects to the URL, and a coding agent on your laptop uses the CLI
in `cli/`. Deploy your own copy behind Cloudflare Access; there is no shared server.

It also does the one thing Dynotator itself will not: it checks the Cloudflare Access token on
every request. That keeps the agent side closed to anyone outside your Access policy, and it is
how reviewer events get the signed-in email as `by`.

## Deploy your own

Everything a deployment chooses is a variable. Nothing in the code names an account, a hostname
or a team.

```sh
DYNOTATOR_URL=https://dynotator-remote.example.workers.dev \
ACCESS_TEAM_DOMAIN=acme \
ACCESS_AUD=4f2e...c91a \
npm run deploy:remote
```

| Variable                | What it sets                                                                                                             | Default                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `DYNOTATOR_NAME`        | The Worker's name.                                                                                                       | `dynotator-remote`                 |
| `DYNOTATOR_DOMAIN`      | A custom domain to serve the Worker on, for example `review.example.com`.                                                | none: `workers.dev` only           |
| `DYNOTATOR_URL`         | The origin reviewers open. Review URLs handed out over RPC start with it; ones from `/mcp` use the request's own origin. | `https://$DYNOTATOR_DOMAIN` if set |
| `ACCESS_TEAM_DOMAIN`    | Your Zero Trust team: `acme`, `acme.cloudflareaccess.com` or the full URL.                                               | none: validation off               |
| `ACCESS_AUD`            | The Access application's audience tag. Separate several with commas if more than one application fronts the Worker.      | none: validation off               |
| `CLOUDFLARE_ACCOUNT_ID` | The account to deploy to, read by the `cf` CLI.                                                                          | the CLI's default account          |

They are read when you deploy and stored on the Worker as plain variables. None is a secret.

### Set up Cloudflare Access

1. Deploy once without the Access variables. The Worker serves review pages, and `/mcp` answers
   503 until Access is configured, so nothing is open in the meantime.
2. Create a self-hosted Access application for the Worker's hostname, with the policy that
   decides who may review and who may create reviews, and turn on
   [managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).
   MCP clients cannot follow a browser login redirect; managed OAuth lets them sign in through
   the same policy. With the `cf` CLI:

   ```sh
   cf zero-trust access applications create --body '{
     "name": "dynotator",
     "type": "self_hosted",
     "domain": "dynotator-remote.example.workers.dev",
     "destinations": [{ "type": "public", "uri": "dynotator-remote.example.workers.dev" }],
     "session_duration": "730h",
     "policies": [{ "id": "<a reusable policy id>", "precedence": 1 }],
     "oauth_configuration": {
       "enabled": true,
       "dynamic_client_registration": {
         "enabled": true,
         "allow_any_on_localhost": true,
         "allow_any_on_loopback": true,
         "allowed_uris": ["https://claude.ai/api/mcp/auth_callback"]
       },
       "grant": { "access_token_lifetime": "15m", "session_duration": "336h" }
     }
   }'
   ```

   `allowed_uris` lists the OAuth callback of each hosted MCP client you use. Local clients are
   covered by the two `allow_any_on_` settings.

3. Copy the application's audience tag (`aud` in the command's output, or **Application Audience
   (AUD) Tag** in the dashboard) and deploy again with `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.

### What the Worker checks

With both Access variables set, `access.ts` verifies the `Cf-Access-Jwt-Assertion` token that
Access attaches to every request it lets through: signed by your team's keys, issued for one of
the audiences, not expired. A request without a valid token gets 403, whether it is for a review
page or for `/mcp`. A service token passes but has no email, so its events carry no `by`.

Setting only one of the two variables is an error: every request gets 500 naming the problem,
so a half-configured deployment cannot run open.

With neither set, nothing is checked. Review pages still work, since a review URL is an
unguessable capability, but `/mcp` is served only under the dev server.

The check lives here and not in Dynotator because Dynotator checks no tokens by design. It reads
the reviewer from the platform's `ctx.access`, which Workers with static assets do not receive,
so this Worker verifies the token itself and hands the result over in that same place.

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

Under the dev server the Access variables are normally unset and `/mcp` is open on localhost.
`DYNOTATOR_DEV_EMAIL=you@example.com npm run dev:remote` simulates a signed-in reviewer.

`cloudflare.config.ts` is Dynotator's Worker config with the variables above, this entrypoint,
and `/mcp` routed to the Worker before assets. The root `cloudflare.config.ts` returns
it under `--mode remote`, the same way it does for [`examples/self`](../self).
