import { defineConfig } from "cf/config";
import { dynotator } from "../../cloudflare.config.ts";
import * as entrypoint from "./index.ts" with { type: "cf-worker" };

// Chosen by the root cloudflare.config.ts under `--mode self`: the Cloudflare Vite plugin reads
// the config at Vite's root, where the review SPA (index.html, app/) lives. The Worker is a
// factory because the two configs import each other.
export default defineConfig({
  worker: () => ({
    ...dynotator,
    name: "dynotator-self",
    entrypoint,
    assets: { ...dynotator.assets, runWorkerFirst: ["/", ...dynotator.assets.runWorkerFirst] },
  }),
});
