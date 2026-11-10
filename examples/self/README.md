# Dynotator reviews itself

A Worker that embeds Dynotator and puts Dynotator's own repository up for review.

```sh
npm run dev:self
```

Open <http://localhost:3000/>. Each visit to `/` opens a new annotate-mode review of the repository
and redirects to it; everything else (`/s/:id`, the review app, its API) is Dynotator's own
handler.

- `index.ts` re-exports `Dynotator` and `SessionSupervisor` from `../../worker`, and on `GET /`
  calls its own entrypoint, `ctx.exports.Dynotator({ props: { origin } }).createReview(...)`, so
  review URLs start with the origin the request came in on.
- The files come from Vite's `import.meta.glob(..., { query: "?raw", eager: true })`: read as text
  when the Worker is built, and live under the dev server. The glob takes the top-level docs and config
  files, `app/`, `worker/`, `session/`, `scripts/`, `examples/` and `public/`. It skips
  `node_modules`, dotfiles (so `.cloudflare/`), the lockfile, `cloudflare.config.ts` (the
  Cloudflare Vite plugin will not let a Worker import it) and `index.ts` itself (Vite never globs
  the importing module).
- `cloudflare.config.ts` is Dynotator's Worker config with another name (`dynotator-self`), this
  entrypoint, and `/` routed to the Worker before assets. The Cloudflare Vite plugin reads the
  config at Vite's root, where the review app's `index.html` lives, so the root
  `cloudflare.config.ts` returns this one under `--mode self`: `npm run dev:self` is
  `vp dev --mode self`, `npm run build:self` is `vp build --mode self`, and
  `npm run deploy:self` is `cf deploy --mode self`.
