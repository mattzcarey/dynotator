# Dynotator

A fork of [Plannotator](https://github.com/backnotprop/plannotator) (MIT OR Apache-2.0, forked at
`38d4d7c`) that runs entirely on Cloudflare Workers. A coding agent submits a plan (or any markdown)
over HTTP, a human reviews and annotates it in the browser, and the agent receives the decision.
Upstream starts a local Bun server per review; here each review session's server is TypeScript loaded
into a **Dynamic Worker** and run as a **Durable Object Facet**. No containers, no local server.

## Layout

| Path | What |
| --- | --- |
| `app/` | Vite entry for the browser SPA (`index.html`, `index.tsx`). Built to `dist/app`. |
| `packages/editor/` | The review app (`App.tsx`). Forked from upstream `packages/editor`. |
| `packages/ui/` | Components, hooks, utils, theme. Forked from upstream `packages/ui`. |
| `packages/core/`, `packages/shared/` | Framework-free shared logic and types. |
| `worker/` | Host Worker: router, static assets, `SessionSupervisor` Durable Object, Worker Loader. |
| `session/` | The per-session server. Bundled to a JS string and loaded as a Dynamic Worker. |
| `cli/` | `dynotator` CLI: the agent-side client (Claude Code hook, `annotate`). |

Imports use `@dynotator/{ui,core,shared,editor}/...` (tsconfig `paths` + Vite aliases). The npm
packages still published under `@plannotator/*` (`atomic-editor`, `markdown-editor`,
`web-highlighter`) are upstream dependencies, not this repo.

## Architecture

```
agent ──POST /api/sessions──▶ host Worker ──▶ SessionSupervisor DO (one per session id)
browser ─GET /s/:id────────▶ host Worker ──▶ static SPA                │ ctx.facets.get("server")
browser ─/s/:id/api/*──────▶ host Worker ──▶ SessionSupervisor.fetch ──┴▶ SessionServer facet
agent ──GET /s/:id/api/wait▶ (long poll for the decision)                 (Dynamic Worker, own SQLite)
```

- **Host Worker** (`worker/`): owns routing, auth on session creation, and serves `dist/app`.
- **SessionSupervisor** (Durable Object, SQLite): named by session id. Stores only session
  metadata and expiry. Loads the session-server bundle with `env.LOADER.get(bundleId, …)`
  (`globalOutbound: null`), gets its `SessionServer` class via `getDurableObjectClass`, and runs it
  as a facet. Forwards requests with the `/s/:id` prefix stripped.
- **SessionServer** (`session/`, runs inside the Dynamic Worker): everything upstream's per-session
  Bun server did that still makes sense without a local machine. It only uses its own facet
  storage, has no bindings and no network.

### HTTP contract

Host routes:

- `POST /api/sessions` creates a session. If the `DYNOTATOR_TOKEN` secret is set, requires
  `Authorization: Bearer <token>`. Body:
  `{ mode: "plan" | "annotate", markdown: string, title?: string, origin?: string, permissionMode?: string, filePath?: string, project?: string }`.
  Response `201 { id, url, apiUrl }` where `url` is `<origin>/s/<id>` and `apiUrl` is `<origin>/s/<id>/api`.
- `GET /s/:id` serves the SPA. `ANY /s/:id/api/*` goes to that session's server as `/api/*`.
- The session id is an unguessable capability (>= 128 bits, URL-safe). Knowing it is the
  authorisation for everything under `/s/:id`.

Session server routes (paths as the session server sees them):

- The browser-facing `/api/*` routes the SPA uses (`/api/plan`, `/api/approve`, `/api/deny`,
  `/api/feedback`, `/api/draft`, `/api/upload`, `/api/image`, `/api/config`, `/api/plan/versions`,
  …) keep upstream's request and response shapes so the forked UI needs no protocol changes.
- `GET /api/wait?timeout=<seconds>` (agent-facing, default 25, max 55) long-polls.
  Returns `{ status: "pending" }` on timeout or
  `{ status: "decided", decision: { approved: boolean, feedback?: string, permissionMode?: string, annotations?: unknown, … } }`.
  Repeating the call after a decision returns the same decision.
- `POST /api/revise` (agent-facing) submits a new revision of the plan after a denial:
  `{ markdown: string }`. It clears the decision and adds a version so the UI can show the diff.

Sessions expire (default 7 days, `SESSION_TTL_SECONDS`); the supervisor deletes the facet and its
own storage in an alarm.

### Browser side

The SPA is served at `/s/:id` and its API lives at `/s/:id/api`. Forked UI code calls `/api/...`;
`packages/ui/utils/api.ts` exports `apiUrl(path)` that prefixes the session base, and
`app/index.tsx` installs a `fetch`/`EventSource` shim that applies it to same-origin `/api/` URLs.
Non-fetch uses (`<img src>`, `href`, `sendBeacon`) must call `apiUrl()` themselves.

## What was removed from upstream, and the rule for more

Removed on purpose: the Inbox, code review, Guided Reviews, Shapes, Ask AI / "Ask this session",
agent terminals, the local-file surfaces (linked docs, file browser, code-file popouts, source
save, HTML and AsciiDoc documents, bundles), note-app integrations (Obsidian, Bear, Octarine),
VS Code integration, the archive browser, update checks, telemetry, star/feedback prompts, the
paste/share service, WebMCP, every harness plugin other than the Claude Code hook, the theme
catalogue and the mascot sprites.

The rule: a feature stays if it helps a human read and annotate a markdown plan in a browser and
can be served by a Worker with per-session storage. It goes if it needs the user's machine, a
local agent process, an LLM provider, or another Plannotator product surface.

## Tooling

- Runtime and package manager: `bun`. TypeScript only (no containers, no Python, no shell glue).
- `bun run fmt` (oxfmt), `bun run lint` (oxlint), `bun run typecheck` (tsrs, the Rust port of
  the TypeScript 7 compiler), `bun test`, `bun run build`, `bun run check` (all of them).
- `bun run dev` builds and runs `wrangler dev` (Dynamic Workers and facets work locally in
  Miniflare). `bun run deploy` deploys.
- Everything committed must be formatted with oxfmt and must not add tsrs errors or oxlint
  errors. Prefer deleting code to suppressing a diagnostic.

## Style

- This is a simplification fork. Prefer fewer files, fewer options and fewer abstractions over
  parity with upstream. Delete dead code, dead props and dead settings outright; no compatibility
  shims, no "removed in fork" comments, no feature flags for things that are gone.
- Comments say why, not what, and are rare. Do not carry over upstream's long narrative comments
  when the code they explain has been simplified.
- UI styling follows the Cloudflare Workers look (see `packages/ui/theme.css`): white and warm
  off-white surfaces, near-black text, `#ff5e1f` orange accent, pill buttons, hairline and dashed
  borders, a mono face for labels. One light and one dark theme, nothing else. Never use
  Cloudflare's logo or wordmark.
