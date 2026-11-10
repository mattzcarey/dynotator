import { defineConfig } from "cf/config";
import { dynotator } from "../../cloudflare.config.ts";
import * as entrypoint from "./index.ts" with { type: "cf-worker" };

// Loaded by the root cloudflare.config.ts under `--mode self`: the Cloudflare Vite plugin reads
// the config at Vite's root, where the review SPA (index.html, app/) lives.
export default defineConfig({
  worker: {
    ...dynotator,
    name: "dynotator-self",
    entrypoint,
    assets: { ...dynotator.assets, runWorkerFirst: ["/", ...dynotator.assets.runWorkerFirst] },
  },
});
