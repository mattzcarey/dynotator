# Dynotator

Human review for agents that run on Cloudflare: an agent submits a plan (or any markdown), a person
reads and annotates it in the browser, the agent receives the decision. It is a fork of
[Plannotator](https://github.com/backnotprop/plannotator) (MIT OR Apache-2.0, forked at `38d4d7c`)
reduced to that one job.

Dynotator is a library-style service, not an end-user application: one Worker that other Workers
bind to and call over RPC. Upstream starts a local Bun server per review; here each review's server
is TypeScript loaded into a **Dynamic Worker** and run as a **Durable Object Facet**. No
containers, no local server, no CLI.

## Layout

| Path                                 | What                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `worker/`                            | Host Worker: `Dynotator` RPC entrypoint (`api.ts`), HTTP router, `SessionSupervisor` Durable Object. |
| `session/`                           | The per-review server. Bundled to a JS string and loaded as a Dynamic Worker.                        |
| `index.html`, `app/`                 | Vite entry for the browser SPA.                                                                      |
| `packages/editor/`                   | The review app. Forked from upstream `packages/editor`.                                              |
| `packages/ui/`                       | Components, hooks, utils, theme. Forked from upstream `packages/ui`.                                 |
| `packages/core/`, `packages/shared/` | Framework-free shared logic and types.                                                               |
| `cloudflare.config.ts`               | Worker config for the `cf` CLI (bindings, exports, assets).                                          |
| `scripts/build-session.ts`           | Vite plugin that bundles `session/` into `virtual:session-server`.                                   |

Imports use `@dynotator/{ui,core,shared,editor}/...` (tsconfig `paths` + Vite aliases). npm
packages still published under `@plannotator/*` are upstream dependencies, not this repo.

## Architecture

```
agent Worker ─service binding (RPC)─▶ Dynotator entrypoint ─▶ SessionSupervisor DO (one per review)
browser ─GET /s/:id────────────────▶ host Worker ─▶ static SPA        │ ctx.facets.get("server")
browser ─/s/:id/api/*──────────────▶ host Worker ─▶ supervisor.fetch ─┴▶ SessionServer facet
                                                                         (Dynamic Worker, own SQLite)
```

- **`Dynotator`** (`worker/api.ts`, a `WorkerEntrypoint`): the public API. `createReview`,
  `getDecision`, `waitForDecision`, `revise`. Reachable only through a service binding, which is
  the authorisation. This is the surface to keep small and stable.
- **Host Worker** (`worker/index.ts`): routes `/s/:id` to the SPA and `/s/:id/api/*` to the
  review's supervisor. `POST /api/sessions` exists only under `cf dev`, to try things locally.
- **`SessionSupervisor`** (Durable Object, SQLite): named by review id. Stores only metadata and
  expiry. Loads the session-server bundle with `env.LOADER.get(bundleId, …)`
  (`globalOutbound: null`), takes its `SessionServer` class via `getDurableObjectClass`, and runs
  it as a facet. A facet stub cannot leave the supervisor, so RPC calls go through explicit
  pass-through methods.
- **`SessionServer`** (`session/`, inside the Dynamic Worker): owns the document, versions, drafts
  and the decision. It uses only its own facet storage: no bindings, no network.

Rules that follow from this:

- The Worker holds no secrets and checks no tokens. Agents authenticate by being bound; humans
  by holding the unguessable review URL (>= 128 bits), optionally behind Cloudflare Access.
  Do not add tokens, API keys or secret bindings.
- Agents never talk HTTP to Dynotator. New agent-facing capability goes on the RPC entrypoint.
- The browser's API is `/s/:id/api/*`: `GET /api/plan`, `GET /api/plan/revision`,
  `GET /api/plan/versions`, `GET /api/plan/version`, `POST /api/approve`, `POST /api/deny`,
  `POST /api/feedback`, `POST /api/exit`, `GET/POST/DELETE /api/draft`. Nothing else.
- Reviews expire (default 7 days, `SESSION_TTL_SECONDS`); the supervisor deletes the facet and
  its own storage in an alarm.

### Browser side

The SPA is served at `/s/:id` and its API lives at `/s/:id/api`. Forked UI code calls `/api/...`;
`packages/ui/utils/api.ts` exports `apiUrl(path)` that prefixes the review base, and
`app/index.tsx` installs a `fetch` shim that applies it to same-origin `/api/` URLs.

## What the browser app is

Only: render the markdown (code highlighting, tables, Mermaid), table of contents, select text
and annotate (comment, deletion, replacement, global comment), the annotation panel, question
blocks, drafts, version history and diff after a revision, the decision, light and dark.

Everything else upstream had is removed on purpose, including: the Inbox, code review, Guided
Reviews, Shapes, Ask AI, agent terminals, every local-file surface, note-app and editor
integrations, the archive, sharing, WebMCP, every harness plugin and the CLI, settings and
preferences, reviewer identity, keyboard-shortcut help, quick labels and templates, export,
print, images and uploads, in-place editing, math rendering, the theme catalogue and the mascot.

The rule for anything new: it stays out unless a human needs it to read and annotate a document
and return a decision to an agent. Product features belong in the projects that embed Dynotator.

## Tooling

- Runtime and package manager: `bun`. TypeScript only.
- `bun run fmt` (oxfmt), `bun run lint` (oxlint), `bun run typecheck` (tsrs, the Rust port of
  the TypeScript 7 compiler), `bun test`, `bun run check` (all of them).
- Cloudflare tooling is the `cf` CLI with `cloudflare.config.ts` and the Cloudflare Vite plugin;
  there is no Wrangler config. `bun run dev` is `cf dev` (port 3000: SPA with HMR plus the real
  Worker, Dynamic Workers and facets included), `bun run build` is `cf build` (one Vite build for
  the SPA and the Worker, output in `.cloudflare/`), `bun run deploy` is `cf deploy`.
- Everything committed must be formatted with oxfmt and must not add tsrs errors or oxlint
  errors. Prefer deleting code to suppressing a diagnostic.

## Style

- This is a simplification fork. Prefer fewer files, fewer options and fewer abstractions over
  parity with upstream. Delete dead code, dead props and dead settings outright; no compatibility
  shims, no "removed in fork" comments, no feature flags for things that are gone.
- Comments say why, not what, and are rare.
- UI styling follows the Cloudflare Workers look (see `packages/ui/theme.css`): white and warm
  off-white surfaces, near-black text, `#ff5e1f` orange accent, pill buttons, hairline and dashed
  borders, a mono face for labels. One light and one dark theme. The logo is the emoji pair
  🦖🥔. Never use Cloudflare's logo or wordmark.
