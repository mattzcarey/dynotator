# Dynotator

Human review for agents that run on Cloudflare: an agent submits a tree of text files (a plan, a
document, a whole repository), a person reads and annotates it in the browser, the agent receives
the decision. It is a fork of
[Plannotator](https://github.com/backnotprop/plannotator) (MIT OR Apache-2.0, forked at `38d4d7c`)
reduced to that one job.

Dynotator is a library-style service, not an end-user application: one Worker that other Workers
bind to and call over RPC. Upstream starts a local Bun server per review; here each review's server
is TypeScript loaded into a **Dynamic Worker** and run as a **Durable Object Facet**. No
containers, no local server, no CLI.

## Layout

| Path                       | What                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `worker/`                  | Host Worker: `Dynotator` RPC entrypoint (`api.ts`), HTTP router, `SessionSupervisor` Durable Object. |
| `session/`                 | The per-review server. Bundled to a JS string and loaded as a Dynamic Worker.                        |
| `index.html`, `app/`       | The browser review app (Vite entry `app/index.tsx`, styles and theme tokens in `app/theme.css`).     |
| `app/review/`              | The review: annotating, panel, sidebar, drafts, decisions, version diff, feedback text.              |
| `app/files/`               | The file tree, path and hash handling, lazy file loading, the source view with line numbers.         |
| `app/markdown/`            | Markdown to blocks (`blocks.ts`) and the block and inline renderers, code highlighting, Mermaid.     |
| `app/questions/`           | `:::question` blocks: grammar and answer export (`questions.ts`, the authoring reference), the card. |
| `examples/self/`           | A Worker that embeds Dynotator and puts this repository up for review (`npm run dev:self`).          |
| `cloudflare.config.ts`     | Worker config for the `cf` CLI (bindings, exports, assets); `--mode self` selects the example.       |
| `vite.config.ts`           | Vite+ config: the build, and the format, lint and test settings.                                     |
| `scripts/build-session.ts` | Vite plugin that bundles `session/` into `virtual:session-server`.                                   |

Imports are relative; there are no path aliases. npm packages still published under `@plannotator/*`
are upstream dependencies, not this repo.

## Architecture

```
agent Worker ─service binding (RPC)─▶ Dynotator entrypoint ─▶ SessionSupervisor DO (one per review)
browser ─GET /s/:id────────────────▶ host Worker ─▶ static SPA        │ ctx.facets.get("server")
browser ─/s/:id/api/*──────────────▶ host Worker ─▶ supervisor.fetch ─┴▶ SessionServer facet
                                                                         (Dynamic Worker, own SQLite)
```

- **`Dynotator`** (`worker/api.ts`, a `WorkerEntrypoint`): the public API, four methods:
  `createReview`, `revise`, `getEvents`, `close` (`docs/spec.md` is the contract). Reachable only through a service binding, which is
  the authorisation. This is the surface to keep small and stable.
- **Host Worker** (`worker/index.ts`): routes `/s/:id` to the SPA and `/s/:id/api/*` to the
  review's supervisor. The agent side over HTTP (`worker/dev.ts`: `/api/sessions...`) exists only
  under the dev server, to try things locally and drive tests.
- **`SessionSupervisor`** (Durable Object, SQLite): named by review id. Stores only metadata and
  expiry. Loads the session-server bundle with `env.LOADER.get(bundleId, …)`
  (`globalOutbound: null`), takes its `SessionServer` class via `getDurableObjectClass`, and runs
  it as a facet. A facet stub cannot leave the supervisor, so RPC calls go through explicit
  pass-through methods.
- **`SessionServer`** (`session/`, inside the Dynamic Worker): owns the files, versions, drafts
  and the event log. The files live in a `@cloudflare/computer` `Workspace` on the facet's own
  storage, one full tree per version (`/v/1/...`, `/v/2/...`), with a small hash index beside it
  so listings and changes need no file reads. No bindings, no network, no execution backends.

Rules that follow from this:

- The Worker holds no secrets and checks no tokens. Agents authenticate by being bound; humans
  by holding the unguessable review URL (>= 128 bits), optionally behind Cloudflare Access.
  Do not add tokens, API keys or secret bindings.
- Agents never talk HTTP to Dynotator. New agent-facing capability goes on the RPC entrypoint.
- The browser's API is `/s/:id/api/*`: `GET /api/review`, `GET /api/revision`, `GET /api/files`,
  `GET /api/file`, `GET /api/changes`, `GET /api/events`, `POST /api/feedback`,
  `POST /api/approve`, `GET/POST /api/draft`. Nothing else.
- A review is a conversation, not a verdict: everything is appended to an event log, the
  reviewer can submit repeatedly, and only the agent's `close` (or expiry) ends it. An annotation
  is sent if its `id` is in the log; submissions are idempotent by id. There are no modes.
- A change is expressed with `patch` (a unified diff of what produced `files`); the base is
  derived by reverse-applying it (`session/patch.ts`) and stored as version 0.
- Reviewer identity (`by` on events) comes only from the platform's Cloudflare Access context
  (`worker/identity.ts`), never from a client header.
- A review's content arrives as a full snapshot (`files`: path to UTF-8 text) on `createReview`
  and `revise`. Limits live in `session/files.ts` and keep a snapshot under the 32 MiB RPC
  message limit. Dynotator can also be embedded in another Worker instead of bound
  (`dynotator/worker`, see `examples/self`).
- Reviews expire (default 7 days, `SESSION_TTL_SECONDS`); the supervisor deletes the facet and
  its own storage in an alarm.

### Browser side

The SPA is served at `/s/:id` and its API lives at `/s/:id/api`. `app/api.ts` exports
`api(path)`, which prefixes `/api/...` with the review base; every request goes through it.

## What the browser app is

Only: a file tree (hidden for a single file), markdown files rendered (code highlighting, tables,
Mermaid) and other files shown as source with line numbers, a location in the URL hash, select
text and annotate per file and line (comment, deletion, replacement, general comment), the
annotation panel with what was already sent, question blocks, drafts, versions with changed files
and an annotatable per-file diff (after a revision, or against the base in a change review), two
actions (send feedback, approve) that can be used repeatedly, light and dark.

It is a review surface, not an IDE: no search, editing, download, blame or tabs.

Everything else upstream had is removed on purpose, including: the Inbox, code review, Guided
Reviews, Shapes, Ask AI, agent terminals, every local-file surface, note-app and editor
integrations, the archive, sharing, WebMCP, every harness plugin and the CLI, settings and
preferences, self-declared reviewer names, modes, keyboard-shortcut help, quick labels and templates, export,
print, images and uploads, in-place editing, math rendering, the theme catalogue and the mascot.

The rule for anything new: it stays out unless a human needs it to read and annotate a document
and return a decision to an agent. Product features belong in the projects that embed Dynotator.

## Tooling

- Node and npm. TypeScript only.
- [Vite+](https://viteplus.dev) (`vp`) is the toolchain, configured in `vite.config.ts`:
  `npm run dev` is `vp dev` (port 3000: SPA with HMR plus the real Worker, Dynamic Workers and
  facets included), `npm run build` is `vp build` (one build for the SPA and the Worker, output in
  `.cloudflare/`), `npm test` is `vp test run` (Vitest; tests import from `vite-plus/test`),
  `npm run check` is `vp check` (oxfmt, oxlint and the type check) plus the tests, `npm run fmt`
  and `npm run lint` are `vp fmt` and `vp lint`.
- Cloudflare tooling is the `cf` CLI with `cloudflare.config.ts` and the Cloudflare Vite plugin;
  there is no Wrangler config. `npm run deploy` is `cf deploy`, `npm run types` regenerates the
  binding types in `.cloudflare/types`.
- Everything committed must pass `npm run check`. Prefer deleting code to suppressing a diagnostic.

## Style

- This is a simplification fork. Prefer fewer files, fewer options and fewer abstractions over
  parity with upstream. Delete dead code, dead props and dead settings outright; no compatibility
  shims, no "removed in fork" comments, no feature flags for things that are gone.
- Comments say why, not what, and are rare.
- UI styling follows the Cloudflare Workers look (see `app/theme.css`): white and warm
  off-white surfaces, near-black text, `#ff5e1f` orange accent, pill buttons, hairline and dashed
  borders, a mono face for labels. One light and one dark theme. The logo is the emoji pair
  🦖🥔. Never use Cloudflare's logo or wordmark.
