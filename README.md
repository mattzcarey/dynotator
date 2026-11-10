# 🦖🥔 Dynotator

Human review for agents that run on Cloudflare. An agent hands Dynotator a plan (or any markdown),
a person reads and annotates it in the browser, and the agent gets the decision back.

Dynotator is a Worker you deploy once and bind to from your other Workers. It is a fork of
[Plannotator](https://github.com/backnotprop/plannotator) (forked at `38d4d7c`, MIT OR Apache-2.0)
cut down to that one job: no local server, no containers, no CLI. Each review's server is plain
TypeScript loaded into a [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) and
run as a Durable Object Facet with its own SQLite.

## Use it from a Worker

Bind the `Dynotator` entrypoint as a service, then call it over RPC:

```ts
const review = await env.DYNOTATOR.createReview({
  mode: "plan",
  markdown: plan,
  title: "Migration",
});
await notifyHuman(review.url);

// Either wait (up to 55 s per call; null means still open)...
const decision = await env.DYNOTATOR.waitForDecision(review.id);
// ...or poll from an alarm so the agent can hibernate.
const later = await env.DYNOTATOR.getDecision(review.id);

if (decision && !decision.approved) {
  const revised = await rewrite(plan, decision.feedback);
  await env.DYNOTATOR.revise(review.id, revised); // same URL; the reviewer sees the diff
}
```

| Method                                     | Returns                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `createReview({ mode, markdown, title? })` | `{ id, url }`. `mode` is `"plan"` (approve or request changes) or `"annotate"` (send feedback or close). |
| `getDecision(id)`                          | The decision, or `null` while the review is open.                                                        |
| `waitForDecision(id, seconds?)`            | Same, waiting up to `seconds` (default 25, at most 55).                                                  |
| `revise(id, markdown)`                     | Adds a version and reopens the decision. Refused once a review is approved or closed.                    |

A decision is `{ approved, feedback?, answersOnly?, annotations?, exit?, version, decidedAt }`.
The types are exported from this package (`import type { Dynotator, Decision } from "dynotator"`).

Reviews cannot be created over HTTP in production: the service binding is the authorisation.

## Deploy

```sh
bun install
DYNOTATOR_URL=https://dynotator.example.workers.dev bun run deploy
```

`bun run deploy` is `cf deploy` (the [Cloudflare CLI](https://developers.cloudflare.com/cf/),
configured by `cloudflare.config.ts`). `DYNOTATOR_URL` is the origin reviewers will open; review
URLs handed out over RPC start with it.

Review URLs are unguessable capabilities: whoever has one can read and decide that review. To also
require sign-in, put the Worker behind
[Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
The Worker itself holds no secrets and checks no tokens. Reviews expire after 7 days
(`SESSION_TTL_SECONDS`).

## Develop

```sh
bun install
bun run dev
```

`bun run dev` is `cf dev`: one Vite dev server on port 3000 serving the browser app with HMR and
the real Worker, Dynamic Workers and facets included. Under `cf dev` only, a review can be opened
without a second Worker:

```sh
curl -s -X POST localhost:3000/api/sessions -H 'content-type: application/json' \
  -d '{"mode":"plan","markdown":"# Plan\n\nDo the thing."}'
```

`bun run check` runs the formatter check, the linter, the type checker and the tests.
[AGENTS.md](AGENTS.md) describes the architecture and what was removed from upstream.
