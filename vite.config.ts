import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
import { sessionServerBundle } from "./scripts/build-session";

// One build (`vp build`) for the SPA (index.html + app/, served as static assets) and the host
// Worker (cloudflare.config.ts), whose session server comes in as virtual:session-server.
export default defineConfig({
  fmt: {
    printWidth: 100,
    ignorePatterns: [".cloudflare"],
  },
  lint: {
    plugins: ["typescript", "react", "unicorn", "oxc"],
    categories: {
      correctness: "error",
      suspicious: "warn",
    },
    ignorePatterns: [".cloudflare"],
    rules: {
      "react/react-in-jsx-scope": "off",
      // Flags the ordinary `let cancelled = false` effect-cleanup flag as a mutation after render.
      "react/immutability": "off",
      // Effects that return a cleanup on one path only are normal React.
      "typescript/consistent-return": "off",
      // JSON from our own server and typed storage getters are asserted, not validated.
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), sessionServerBundle(), cloudflare()]),
  resolve: { dedupe: ["react", "react-dom"] },
  // Scan only the SPA's own entry, not built copies of it under .cloudflare/.
  optimizeDeps: { entries: ["index.html"] },
  server: { port: 3000 },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 10_000,
  },
});
