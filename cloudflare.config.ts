import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// Evaluated by the cf CLI under Node; the Worker program has no Node types.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  worker: {
    name: "dynotator",
    entrypoint,
    compatibilityDate: "2026-11-01",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/s/*"],
    },
    observability: { enabled: true },
    env: {
      ASSETS: bindings.assets(),
      LOADER: bindings.workerLoader(),
      SESSION_TTL_SECONDS: bindings.text("604800"),
      // The origin reviewers reach this Worker at; review URLs handed out over RPC start with it.
      PUBLIC_URL: bindings.text(process.env.DYNOTATOR_URL ?? "http://localhost:3000"),
    },
    exports: {
      Dynotator: exports.worker(),
      SessionSupervisor: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
