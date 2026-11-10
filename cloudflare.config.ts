import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

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
    },
    exports: {
      SessionSupervisor: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
