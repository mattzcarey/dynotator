# 🦖🥔 Dynotator

Human review for agents that run on Cloudflare. An agent hands Dynotator a plan, a document or a
whole repository as a tree of text files; a person reads and annotates it in the browser; the agent
gets the decision back.

Dynotator is a Worker you deploy once and bind to from your other Workers. It is a fork of
[Plannotator](https://github.com/backnotprop/plannotator) (forked at `38d4d7c`, MIT OR Apache-2.0)
cut down to that one job: no local server, no containers, no CLI. Each review's server is plain
TypeScript loaded into a [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) and
run as a Durable Object Facet with its own SQLite.

## Use it from a Worker

Bind the `Dynotator` entrypoint as a service, then call it over RPC. A review is a tree of text
files: one plan, a few documents, or a whole repository.

```ts
const review = await env.DYNOTATOR.createReview({
  mode: "plan",
  title: "Migration",
  files: { "PLAN.md": plan, "src/schema.sql": schema },
  open: "PLAN.md",
});
await notifyHuman(review.url);

// Either wait (up to 55 s per call; null means still open)...
const decision = await env.DYNOTATOR.waitForDecision(review.id);
// ...or poll from an alarm so the agent can hibernate.
const later = await env.DYNOTATOR.getDecision(review.id);

if (decision && !decision.approved) {
  const files = await rewrite(decision.feedback);
  await env.DYNOTATOR.revise(review.id, files); // same URL; the reviewer sees what changed
}
```

| Method                                         | Returns                                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReview({ mode, files, title?, open? })` | `{ id, url }`. `mode` is `"plan"` (approve or request changes) or `"annotate"` (send feedback or close). `open` is the file shown first (default `README.md`, else the first `.md`, else the first path).                     |
| `getDecision(id)`                              | The decision, or `null` while the review is open.                                                                                                                                                                             |
| `waitForDecision(id, seconds?)`                | Same, waiting up to `seconds` (default 25, at most 55).                                                                                                                                                                       |
| `revise(id, files)`                            | `{ version, unchanged }`. `files` is a full snapshot: it becomes the next version, files left out are deleted in it, and the decision reopens. An identical snapshot is ignored. Refused once a review is approved or closed. |

`files` maps repo-relative POSIX paths (`"README.md"`, `"src/index.ts"`) to UTF-8 text. Paths
must not be absolute or contain empty, `.` or `..` segments, backslashes or NUL, and no path may
also be another's directory. Limits: 5,000 files, 1 MiB per file, 20 MiB in all and 512 bytes per
path, which keeps every call under the 32 MiB Workers RPC limit.

A decision is `{ approved, feedback?, answersOnly?, annotations?, exit?, version, decidedAt }`;
each annotation carries the `path` of the file it is on. The types are exported from this package
(`import type { Dynotator, Decision, ReviewInit, Files } from "dynotator"`).

Reviews cannot be created over HTTP in production: the service binding is the authorisation.

## Embed it in your own Worker

Instead of binding to a deployed Dynotator, a Worker can run it itself: re-export the entrypoint
and the Durable Object from `dynotator/worker`, pass everything it does not handle to Dynotator's
`fetch`, and call its own entrypoint, passing the origin reviewers reach it at:

```ts
import dynotator from "dynotator/worker";
export { Dynotator, SessionSupervisor } from "dynotator/worker";

export default {
  async fetch(request, env, ctx) {
    const origin = new URL(request.url).origin;
    const review = await ctx.exports.Dynotator({ props: { origin } }).createReview(init);
    return dynotator.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

The Worker needs Dynotator's bindings, exports and assets (`dynotator` in `cloudflare.config.ts`),
the browser app built as its assets, and `sessionServerBundle()` from `dynotator/vite` among its
Vite plugins. [`examples/self`](examples/self) does exactly this.

## Asking the reviewer questions

A document can carry questions for the reviewer. They render as cards, and the answers come back
at the top of `decision.feedback`.

```markdown
:::question
Where should we keep the edit that loses a sync conflict?

When two devices edit one note offline, the later save wins and the other is lost.

- [ ] Nowhere — silent loss, as today
- [ ] Local only, purged after 30 days — cheap, no server change
- [ ] Server-side per user — survives reinstall, needs a retention policy

Recommended: Local only, purged after 30 days
:::
```

- `:::question` picks one choice, `:::question-multi` any number, `:::question-text` takes free
  text (so does a block with no choices). The block ends at the first `:::` line.
- The first line is the question. Every other line is context, shown under it as markdown.
- Choices are `- [ ] label` or `- [ ] label — description`. `- [x] label` marks a choice as
  already settled.
- `Recommended: <label>` marks your recommendation (`A, B and C` on `:::question-multi`).
- The reviewer can pick, answer "Other", add a note, or skip. The feedback opens with
  `## Answers to your questions`, one `### Q<n>. <question>` section each. When the reviewer only
  answered and left no other feedback, a plan's decision has `answersOnly: true`.

## Deploy

```sh
npm install
DYNOTATOR_URL=https://dynotator.example.workers.dev npm run deploy
```

`npm run deploy` is `cf deploy` (the [Cloudflare CLI](https://developers.cloudflare.com/cf/),
configured by `cloudflare.config.ts`). `DYNOTATOR_URL` is the origin reviewers will open; review
URLs handed out over RPC start with it.

Review URLs are unguessable capabilities: whoever has one can read and decide that review. To also
require sign-in, put the Worker behind
[Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
The Worker itself holds no secrets and checks no tokens. Reviews expire after 7 days
(`SESSION_TTL_SECONDS`).

## Develop

```sh
npm install
npm run dev
```

`npm run dev` is `vp dev` ([Vite+](https://viteplus.dev)): one Vite dev server on port 3000 serving the browser app with HMR and
the real Worker, Dynamic Workers and facets included. Under the dev server only, a review can be opened
without a second Worker:

```sh
curl -s -X POST localhost:3000/api/sessions -H 'content-type: application/json' \
  -d '{"mode":"plan","files":{"PLAN.md":"# Plan\n\nDo the thing.","src/a.ts":"export {};\n"}}'
```

Each review's files live in a [`@cloudflare/computer`](https://www.npmjs.com/package/@cloudflare/computer)
Workspace inside its facet, one tree per version (`/v/1/`, `/v/2/`, ...).

To review Dynotator's own source in it, run [the example](examples/self):

```sh
npm run dev:self
```

and open <http://localhost:3000/>.

`npm run check` is `vp check` (format, lint and type check) plus `vp test`.
[AGENTS.md](AGENTS.md) describes the architecture and what was removed from upstream.
