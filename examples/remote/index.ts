import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import dynotator, { type Dynotator } from "../../worker/index.ts";

export { Dynotator, SessionSupervisor } from "../../worker/index.ts";

// One snapshot is at most 20 MiB of files plus its patch; JSON escaping adds a little.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const files = z
  .record(z.string(), z.string())
  .describe(
    'Repo-relative POSIX paths mapped to UTF-8 text, for example {"PLAN.md": "# Plan"}. A full snapshot: every file the reviewer should see.',
  );
const id = z.string().describe("The review id that create_review returned.");

/** A tool result: the method's answer as JSON, or its error message for the agent to act on. */
async function reply(call: () => Promise<object | void>) {
  try {
    const text = JSON.stringify((await call()) ?? { ok: true });
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

/** The four Dynotator methods as MCP tools, for agents that cannot hold a service binding. */
function createServer(reviews: Service<typeof Dynotator>) {
  const server = new McpServer({ name: "dynotator", version: "0.1.0" });

  server.registerTool(
    "create_review",
    {
      description:
        "Put files up for a human to review in the browser. Returns { id, url }: give the url to the reviewer, keep the id. To review a change, also pass `patch`, the `git diff` that produced `files`; then `files` must hold the new contents of every file the patch touches, and any other file is shown as unchanged context.",
      inputSchema: z.object({
        files,
        patch: z.string().optional().describe("Unified diff (`git diff` output) of the change."),
        title: z.string().optional(),
        open: z.string().optional().describe("The path shown first. Default: README.md."),
      }),
    },
    (init) => reply(() => reviews.createReview(init)),
  );
  server.registerTool(
    "revise_review",
    {
      description:
        "Put a new full snapshot up as the next version at the same URL, after acting on feedback. Files left out are deleted in that version. Returns { version, unchanged }.",
      inputSchema: z.object({ id, files }),
    },
    (args) => reply(() => reviews.revise(args.id, args.files)),
  );
  server.registerTool(
    "get_review_events",
    {
      description:
        "Read what happened on a review: `feedback` and `approved` from the reviewer (with `feedback` markdown and structured `annotations`), `revised` and `closed` from the agent. Returns { events } with `seq` greater than `after`, in order. Keep a cursor: pass the last `seq` you saw as `after`. `wait` holds the call until an event arrives; an empty list means the time ran out, so call again.",
      inputSchema: z.object({
        id,
        after: z.number().int().min(0).optional().describe("Default 0: from the start."),
        wait: z.number().min(0).max(55).optional().describe("Seconds to wait. Default 0."),
      }),
    },
    (args) =>
      reply(async () => ({ events: await reviews.getEvents(args.id, args.after, args.wait) })),
  );
  server.registerTool(
    "close_review",
    {
      description: "End a review once its feedback is dealt with. Nothing more is accepted on it.",
      inputSchema: z.object({ id }),
    },
    (args) => reply(() => reviews.close(args.id)),
  );
  return server;
}

/**
 * Dynotator, plus `/mcp`: the agent side for agents that are not Workers. This Worker checks no
 * tokens, so anyone who can reach `/mcp` can create reviews. Deploy it behind Cloudflare Access.
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return dynotator.fetch(request, env, ctx);
    // A page on another site must not drive the agent side with the reviewer's Access cookie.
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) {
      return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }
    const reviews = ctx.exports.Dynotator({ props: { origin: url.origin } });
    return createMcpHandler(() => createServer(reviews), {
      maxRequestBodySize: MAX_BODY_BYTES,
    }).fetch(request);
  },
} satisfies ExportedHandler<Env>;
