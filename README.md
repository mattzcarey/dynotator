# 🦖🥔 Dynotator

Human review for agents that run on Cloudflare. An agent hands Dynotator a plan, a document or a
whole repository as a tree of text files; a person reads and annotates it in the browser; the agent
gets what the person said back, as a log of events.

Dynotator is a Worker you deploy once and bind to from your other Workers. It is a fork of
[Plannotator](https://github.com/backnotprop/plannotator) (forked at `38d4d7c`, MIT OR Apache-2.0)
cut down to that one job: no local server, no containers, no CLI. Each review's server is plain
TypeScript loaded into a [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) and
run as a Durable Object Facet with its own SQLite.

## Use it from a Worker

Bind the `Dynotator` entrypoint as a service, then call it over RPC. A review is a tree of text
files: one plan, a few documents, or a whole repository. The API is four methods; the full
contract is [docs/spec.md](docs/spec.md).

```ts
const { id, url } = await env.DYNOTATOR.createReview({
  title: "Migration",
  files: { "PLAN.md": plan, "src/schema.sql": schema },
  open: "PLAN.md",
});
await notifyHuman(url);

// The review is a conversation: read its event log with a cursor, as long as it stays open.
let cursor = 0;
for (;;) {
  const events = await env.DYNOTATOR.getEvents(id, cursor, 55); // waits up to 55 s; [] = nothing yet
  for (const event of events) {
    cursor = event.seq;
    if (event.type === "feedback") {
      await env.DYNOTATOR.revise(id, await rewrite(event.feedback, event.annotations));
    }
    if (event.type === "approved") return env.DYNOTATOR.close(id);
  }
}
```

An agent that hibernates keeps `cursor` in its storage and calls `getEvents(id, cursor)` from an
alarm instead of waiting. Nothing is missed or seen twice.

| Method                                           | Returns                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createReview({ files, patch?, title?, open? })` | `{ id, url }`. `open` is the file shown first (default `README.md`, else the first `.md`, else the first path). `patch` makes it a review of a change, below.                                                                                          |
| `revise(id, files)`                              | `{ version, unchanged }`. `files` is a full snapshot: it becomes the next version at the same URL, files left out are deleted in it, and `revised` is appended. Allowed any time until closed, approved or not. An identical snapshot appends nothing. |
| `getEvents(id, after = 0, wait = 0)`             | The events with `seq > after`, in order. With `wait` (seconds, at most 55) it holds the call until there is one; `[]` means none yet. A very long log may come over several calls.                                                                     |
| `close(id)`                                      | Ends the review: appends `closed`, after which `revise` and the reviewer are refused. Idempotent. Reads keep working until the review expires.                                                                                                         |

Every event is `{ seq, type, version, at, by?, feedback?, annotations? }`, `seq` counting 1, 2,
3, ... without gaps:

| `type`     | Who      | Meaning                                                                                                    |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `feedback` | reviewer | Comments, proposed replacements or answers on `version`: `feedback` as markdown, `annotations` structured. |
| `approved` | reviewer | Approves `version`, maybe with notes. Feedback sent later on that version withdraws it.                    |
| `revised`  | agent    | `revise` put up `version`. A new version has no approval.                                                  |
| `closed`   | agent    | `close` ended the review. Always the last event.                                                           |

The reviewer can send as often as they like; each event carries only what is new. An annotation is
`{ id, path, type: "comment" | "replacement" | "answer", lines?, side?, original?, text?, answer? }`:
a replacement gives you `path`, `lines`, `original` and the proposed `text` to apply exactly
(`""` proposes deleting). Ignore fields you do not know. The types are exported from this package
(`import type { Dynotator, ReviewEvent, Annotation, Files } from "dynotator"`).

`files` maps repo-relative POSIX paths (`"README.md"`, `"src/index.ts"`) to UTF-8 text. Paths
must not be absolute or contain empty, `.` or `..` segments, backslashes or NUL, and no path may
also be another's directory. Limits: 5,000 files, 1 MiB per file, 20 MiB in all (a patch
included) and 512 bytes per path. Workers RPC caps a message at 32 MiB, and a string with any
character above U+00FF travels at two bytes per character, so text that is mostly ASCII but
sprinkled with such characters can hit that cap before 20 MiB; the call then fails with the
platform's size error.

### Reviewing a change

Pass `patch`, the unified diff (`git diff`, with or without `--no-prefix`, or `diff -u`) of the
change that produced `files`. Dynotator applies it in reverse to get the state before, stored as
version 0, and the page opens on the changed files and their diffs:

```ts
await env.DYNOTATOR.createReview({
  title: "Retry uploads",
  open: "PLAN.md",
  files: { "PLAN.md": plan, "src/upload.ts": newUpload, "src/retry.ts": newRetry },
  patch: await git("diff", "main"), // touches src/upload.ts, creates src/retry.ts
});
```

Send the files the patch touches (their new contents) and anything else the reviewer should read;
paths the patch does not mention are context, the same before and after, so `PLAN.md` is not shown
as added. Files the patch deletes are rebuilt from it. If a hunk does not match `files` exactly,
`createReview` fails naming the file and the hunk, and no review is created; binary patches and
mode-only changes are refused. `revise` takes files only: the state before the change stays fixed,
and the reviewer can diff any version against it.

Reviews cannot be created over HTTP in production: the service binding is the authorisation.

## Use it from Claude, or from an agent on your laptop

An agent that is not a Worker has no binding. [`examples/remote`](examples/remote) is a Worker
that embeds Dynotator and serves the four methods as MCP tools at `/mcp`, behind Cloudflare
Access. Claude connects to that URL. A local coding agent uses the example's CLI:

```sh
dynotator review --base main    # prints the review URL
dynotator events --wait 600     # the reviewer's feedback
```

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
at the top of the event's `feedback`, and as `answer` annotations.

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
  `## Answers to your questions`, one `### Q<n>. <question>` section each.

## Deploy

```sh
npm install
DYNOTATOR_URL=https://dynotator.example.workers.dev npm run deploy
```

`npm run deploy` is `cf deploy` (the [Cloudflare CLI](https://developers.cloudflare.com/cf/),
configured by `cloudflare.config.ts`). `DYNOTATOR_URL` is the origin reviewers will open; review
URLs handed out over RPC start with it.

Review URLs are unguessable capabilities: whoever has one can read and answer that review. To also
require sign-in, put the Worker behind
[Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
Then reviewer events carry the signed-in email as `by`, taken from the platform's `ctx.access`;
a header sent by the browser is never trusted. Without Access there is no `by`. The Worker itself
holds no secrets and checks no tokens. Reviews expire after 7 days (`SESSION_TTL_SECONDS`).

## Develop

```sh
npm install
npm run dev
```

`npm run dev` is `vp dev` ([Vite+](https://viteplus.dev)): one Vite dev server on port 3000
serving the browser app with HMR and the real Worker, Dynamic Workers and facets included. Under
the dev server only (`worker/dev.ts`, absent from production builds), the agent side can be
driven over HTTP without a second Worker:

```sh
curl -s -X POST localhost:3000/api/sessions -H 'content-type: application/json' \
  -d '{"files":{"PLAN.md":"# Plan\n\nDo the thing.","src/a.ts":"export {};\n"}}'
# → { "id": "…", "url": "http://localhost:3000/s/…" }; the body may also carry patch, title, open
curl -s "localhost:3000/api/sessions/$ID/events?after=0&wait=25"
curl -s -X POST localhost:3000/api/sessions/$ID/revise -d '{"files":{"PLAN.md":"# Plan v2\n"}}'
curl -s -X POST localhost:3000/api/sessions/$ID/close
```

`DYNOTATOR_DEV_EMAIL=you@example.com npm run dev` simulates Cloudflare Access signing that reviewer
in, so events carry `by`.

Each review's files live in a [`@cloudflare/computer`](https://www.npmjs.com/package/@cloudflare/computer)
Workspace inside its facet, one tree per version (`/v/1/`, `/v/2/`, ...; `/v/0/` is the state
before a review's patch).

To review Dynotator's own source in it, run [the example](examples/self):

```sh
npm run dev:self
```

and open <http://localhost:3000/>.

`npm run check` is `vp check` (format, lint and type check) plus `vp test`.
[AGENTS.md](AGENTS.md) describes the architecture and what was removed from upstream.
