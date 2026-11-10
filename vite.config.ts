import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json";

const pkgDir = (name: string) => path.resolve(import.meta.dirname, "packages", name);

// The SPA is built to dist/app and served by the host Worker as static assets.
export default defineConfig({
  root: "app",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
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
  server: {
    port: 3000,
    // `wrangler dev` serves the API; run it alongside `vite` for HMR.
    proxy: { "/api": "http://localhost:8787", "/s": "http://localhost:8787" },
  },
  build: {
    outDir: "../dist/app",
    emptyOutDir: true,
    target: "esnext",
    chunkSizeWarningLimit: 10_000,
  },
});
