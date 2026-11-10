import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";
import type { Plugin } from "vite";

const ENTRY = path.resolve(import.meta.dirname, "../session/index.ts");
const VIRTUAL_ID = "virtual:session-server";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Bundles `session/` into one ESM module for the Worker Loader. */
export async function bundleSession(): Promise<{ code: string; id: string; inputs: string[] }> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2024",
    // Node built-ins come from the Dynamic Worker's nodejs_compat flag (worker/supervisor.ts).
    external: ["cloudflare:*", "node:*"],
    write: false,
    metafile: true,
    legalComments: "none",
  });
  const code = result.outputFiles[0].text;
  const id = `session-server-${createHash("sha256").update(code).digest("hex").slice(0, 16)}`;
  const inputs = Object.keys(result.metafile.inputs).map((p) => path.resolve(p));
  return { code, id, inputs };
}

/**
 * `import bundle from "virtual:session-server"` yields `{ code, id }`: the session server as a
 * string, plus a content hash used as the Worker Loader id so new code gets a new isolate.
 */
export function sessionServerBundle(): Plugin {
  return {
    name: "dynotator-session-server",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const { code, id: bundleId, inputs } = await bundleSession();
      for (const file of inputs) this.addWatchFile(file);
      return `export default ${JSON.stringify({ code, id: bundleId })};`;
    },
  };
}
