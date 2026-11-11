/**
 * The agent side over HTTP, only under the dev server (worker/index.ts imports this behind
 * `import.meta.env.DEV`, so production builds drop it): lets the app and its tests drive a review
 * without a second Worker bound to this one.
 *
 * - `POST /api/sessions` with `{ files, patch?, title?, open? }` → 201 `{ id, url }`
 * - `POST /api/sessions/:id/revise` with `{ files }` → `{ version, unchanged }`
 * - `GET /api/sessions/:id/events?after=N&wait=S` → `{ events }`
 * - `POST /api/sessions/:id/close` → `{ ok: true }`
 */
export async function devRoute(
  request: Request,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response | undefined> {
  const m = /^\/api\/sessions(?:\/([^/]+)\/(revise|events|close))?$/.exec(url.pathname);
  if (!m) return undefined;
  const [, id, action] = m;
  const dynotator = ctx.exports.Dynotator({ props: { origin: url.origin } });
  const number = (name: string) => Number(url.searchParams.get(name) ?? 0);
  try {
    if (!id && request.method === "POST") {
      return Response.json(await dynotator.createReview(await request.json()), { status: 201 });
    }
    if (action === "revise" && request.method === "POST") {
      const { files } = await request.json<{ files: Record<string, string> }>();
      return Response.json(await dynotator.revise(id, files));
    }
    if (action === "events" && request.method === "GET") {
      return Response.json({
        events: await dynotator.getEvents(id, number("after"), number("wait")),
      });
    }
    if (action === "close" && request.method === "POST") {
      await dynotator.close(id);
      return Response.json({ ok: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
  return undefined;
}
