import { HttpError, MAX_MARKDOWN_BYTES, readJsonObject } from "../session/http";
import { parseSessionInit } from "../session/plan";
import { matchRoute } from "./routes";

export { Dynotator } from "./api";
export { SessionSupervisor } from "./supervisor";

const MAX_CREATE_BODY_BYTES = MAX_MARKDOWN_BYTES * 2 + 64 * 1024;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);
    const sessions = ctx.exports.SessionSupervisor;

    switch (route.kind) {
      case "create": {
        // Reviews are opened over RPC (see ./api). Plain HTTP creation exists only under
        // `cf dev`, so the app can be tried without a second Worker bound to this one.
        if (!import.meta.env.DEV) return notFound(url);
        try {
          const init = parseSessionInit(await readJsonObject(request, MAX_CREATE_BODY_BYTES));
          const review = await ctx.exports.Dynotator({ props: {} }).createReview(init);
          return Response.json({ ...review, url: `${url.origin}/s/${review.id}` }, { status: 201 });
        } catch (err) {
          if (err instanceof HttpError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          throw err;
        }
      }
      case "page":
        if (!(await sessions.getByName(route.id).exists())) return pageNotFound();
        return env.ASSETS.fetch(new Request(new URL("/", url), request));
      case "page-not-found":
        return pageNotFound();
      case "session-api":
        return sessions.getByName(route.id).fetch(request);
      case "api-not-found":
        return notFound(url);
      case "asset":
        return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;

function notFound(url: URL): Response {
  return Response.json({ error: "Not found", path: url.pathname }, { status: 404 });
}

function pageNotFound(): Response {
  return new Response("This review session does not exist or has expired.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
