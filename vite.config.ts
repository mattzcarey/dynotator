import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json";
import { sessionServerBundle } from "./scripts/build-session";

const pkgDir = (name: string) => path.resolve(import.meta.dirname, "packages", name);

// One build (`cf build`) for the SPA (index.html + app/, served as static assets) and the host
// Worker (cloudflare.config.ts), whose session server comes in as virtual:session-server.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), sessionServerBundle(), cloudflare()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      // @pierre/diffs picks its Shiki engine at runtime; we only use the JS
      // regex engine, so stub out the ~600 KB Oniguruma WASM.
      {
        find: "shiki/wasm",
        replacement: path.resolve(import.meta.dirname, "app/shiki-wasm-stub.ts"),
      },
      {
        find: "@dynotator/ui/theme-modes",
        replacement: path.join(pkgDir("ui"), "components/themeModes.tsx"),
      },
      { find: /^@dynotator\/editor$/, replacement: path.join(pkgDir("editor"), "App.tsx") },
      {
        find: /^@dynotator\/(ui|core|shared|editor)\//,
        replacement: `${path.resolve(import.meta.dirname, "packages")}/$1/`,
      },
    ],
  },
  // Scan only the SPA's own entry, not built copies of it under dist/.
  optimizeDeps: { entries: ["index.html"] },
  server: { port: 3000 },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 10_000,
  },
});
