import { devRoute } from "./dev";
import { asReviewer, reviewerEmail } from "./identity";
import { matchRoute } from "./routes";

export { Dynotator } from "./api";
export type {
  Annotation,
  DynotatorProps,
  Files,
  Review,
  ReviewEvent,
  ReviewInit,
  Revision,
} from "./api";
export { SessionSupervisor } from "./supervisor";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (import.meta.env.DEV) {
      const response = await devRoute(request, ctx, url);
      if (response) return response;
    }
    const route = matchRoute(url.pathname);
    const sessions = ctx.exports.SessionSupervisor;
    switch (route.kind) {
      case "page":
        if (!(await sessions.getByName(route.id).exists())) return pageNotFound();
        return env.ASSETS.fetch(new Request(new URL("/", url), request));
      case "page-not-found":
        return pageNotFound();
      case "session-api":
        return sessions
          .getByName(route.id)
          .fetch(asReviewer(request, new URL(route.path + url.search, url), await reviewerEmail(ctx)));
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
