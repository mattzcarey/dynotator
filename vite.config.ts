import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sessionServerBundle } from "./scripts/build-session";

// One build (`cf build`) for the SPA (index.html + app/, served as static assets) and the host
// Worker (cloudflare.config.ts), whose session server comes in as virtual:session-server.
export default defineConfig({
  plugins: [react(), tailwindcss(), sessionServerBundle(), cloudflare()],
  resolve: { dedupe: ["react", "react-dom"] },
  // Scan only the SPA's own entry, not built copies of it under .cloudflare/.
  optimizeDeps: { entries: ["index.html"] },
  server: { port: 3000 },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 10_000,
  },
});
