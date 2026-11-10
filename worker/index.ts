import { HttpError, MAX_MARKDOWN_BYTES, readJsonObject } from "../session/http";
import { parseSessionInit } from "../session/plan";
import { matchRoute, newSessionId, ttlSeconds } from "./routes";

export { SessionSupervisor } from "./supervisor";

const MAX_CREATE_BODY_BYTES = MAX_MARKDOWN_BYTES * 2 + 64 * 1024;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);
    const sessions = ctx.exports.SessionSupervisor;

    switch (route.kind) {
      case "create": {
        let init;
        try {
          init = parseSessionInit(await readJsonObject(request, MAX_CREATE_BODY_BYTES));
        } catch (err) {
          if (err instanceof HttpError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          throw err;
        }
        const id = newSessionId();
        await sessions.getByName(id).create(init, ttlSeconds(env.SESSION_TTL_SECONDS));
        const base = `${url.origin}/s/${id}`;
        return Response.json({ id, url: base, apiUrl: `${base}/api` }, { status: 201 });
      }
      case "page":
        if (!(await sessions.getByName(route.id).exists())) return pageNotFound();
        return env.ASSETS.fetch(new Request(new URL("/", url), request));
      case "page-not-found":
        return pageNotFound();
      case "session-api":
        return sessions.getByName(route.id).fetch(request);
      case "api-not-found":
        return Response.json({ error: "Not found", path: url.pathname }, { status: 404 });
      case "asset":
        return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;

function pageNotFound(): Response {
  return new Response("This review session does not exist or has expired.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
