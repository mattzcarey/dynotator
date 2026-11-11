import { bindings, defineConfig } from "cf/config";
import { dynotator } from "../../cloudflare.config.ts";
import * as entrypoint from "./index.ts" with { type: "cf-worker" };

// Evaluated by the cf CLI under Node; the Worker program has no Node types.
declare const process: { env: Record<string, string | undefined> };

// Everything a deployment chooses comes from the environment of `npm run deploy:remote`; see the
// README's table. Nothing here names an account, a hostname or a team.
const { DYNOTATOR_NAME, DYNOTATOR_DOMAIN, DYNOTATOR_URL, ACCESS_TEAM_DOMAIN, ACCESS_AUD } =
  process.env;
const publicUrl = DYNOTATOR_URL ?? (DYNOTATOR_DOMAIN && `https://${DYNOTATOR_DOMAIN}`);

// Chosen by the root cloudflare.config.ts under `--mode remote`, like examples/self.
export default defineConfig({
  worker: () => ({
    ...dynotator,
    name: DYNOTATOR_NAME ?? "dynotator-remote",
    entrypoint,
    ...(DYNOTATOR_DOMAIN && { domains: [DYNOTATOR_DOMAIN] }),
    assets: { ...dynotator.assets, runWorkerFirst: ["/mcp", ...dynotator.assets.runWorkerFirst] },
    env: {
      ...dynotator.env,
      ...(publicUrl && { PUBLIC_URL: bindings.text(publicUrl) }),
      ACCESS_TEAM_DOMAIN: bindings.text(ACCESS_TEAM_DOMAIN ?? ""),
      ACCESS_AUD: bindings.text(ACCESS_AUD ?? ""),
    },
  }),
});
