import { defineConfig } from "cf/config";
import { dynotator } from "../../cloudflare.config.ts";
import * as entrypoint from "./index.ts" with { type: "cf-worker" };

// Chosen by the root cloudflare.config.ts under `--mode remote`, like examples/self.
export default defineConfig({
  worker: () => ({
    ...dynotator,
    name: "dynotator-remote",
    entrypoint,
    assets: { ...dynotator.assets, runWorkerFirst: ["/mcp", ...dynotator.assets.runWorkerFirst] },
  }),
});
