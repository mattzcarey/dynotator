import { matchRoute } from "./routes";

export { Dynotator } from "./api";
export type { Decision, DynotatorProps, Files, Review, ReviewInit, Revision } from "./api";
export { SessionSupervisor } from "./supervisor";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);
    const sessions = ctx.exports.SessionSupervisor;

    switch (route.kind) {
      case "create":
        // Reviews are opened over RPC (./api). This exists only under `cf dev`, so the app can be
        // tried without a second Worker bound to this one; production builds drop it.
        if (import.meta.env.DEV) return createForDev(request, ctx, url.origin);
        return notFound(url);
      case "page":
        if (!(await sessions.getByName(route.id).exists())) return pageNotFound();
        return env.ASSETS.fetch(new Request(new URL("/", url), request));
      case "page-not-found":
        return pageNotFound();
      case "session-api":
        return sessions
          .getByName(route.id)
          .fetch(new Request(new URL(route.path + url.search, url), request));
      case "api-not-found":
        return notFound(url);
      case "asset":
        return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;

async function createForDev(request: Request, ctx: ExecutionContext, origin: string) {
  try {
    const review = await ctx.exports
      .Dynotator({ props: { origin } })
      .createReview(await request.json());
    return Response.json(review, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

function notFound(url: URL): Response {
  return Response.json({ error: "Not found", path: url.pathname }, { status: 404 });
}

function pageNotFound(): Response {
  return new Response("This review session does not exist or has expired.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
