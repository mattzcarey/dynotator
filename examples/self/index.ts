import dynotator from "../../worker/index.ts";

export { Dynotator, SessionSupervisor } from "../../worker/index.ts";

// Dynotator's own source, read as text at build time (and live under `cf dev`). Vite's glob skips
// node_modules and dotfiles, so .cloudflare/ stays out; the Cloudflare Vite plugin refuses to let
// a Worker import cloudflare.config.ts, so those stay out too.
const sources = import.meta.glob<string>(
  [
    "/*.{md,json,ts,html}",
    "/LICENSE-*",
    "/{app,worker,session,scripts,examples,public}/**/*.{ts,tsx,css,md,json,html,svg}",
    "!**/cloudflare.config.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);
const files = Object.fromEntries(Object.entries(sources).map(([path, text]) => [path.slice(1), text]));

/** Dynotator, plus `GET /`: open a review of this repository and go to it. */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      const review = await ctx.exports
        .Dynotator({ props: { origin: url.origin } })
        .createReview({ mode: "annotate", title: "Dynotator", files, open: "README.md" });
      return Response.redirect(review.url, 303);
    }
    return dynotator.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
