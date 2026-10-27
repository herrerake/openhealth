// Static Astro site served by the OpenHealth Worker as static assets (D-028).
// Per-athlete data is fetched client-side from /api; interactive parts are React islands.
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const WORKER = "http://localhost:8787";

export default defineConfig({
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": WORKER,
        "/mock": WORKER,
        "/agents": { target: WORKER, ws: true },
      },
    },
  },
});
