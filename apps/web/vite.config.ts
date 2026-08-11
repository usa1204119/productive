import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy API calls to the Express server so the browser talks to a single
// origin — session cookies stay first-party and CORS is a non-issue in dev.
export default defineConfig({
  plugins: [react()],
  // Excalidraw reads process.env at runtime; Vite doesn't define it in the
  // browser, so shim the one flag it needs.
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/workspaces": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/workspace-invitations": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/__e2e": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/health": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/socket.io": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:4000",
        ws: true,
      },
    },
  },
});
