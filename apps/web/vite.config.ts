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
      "/auth": "http://localhost:4000",
      "/workspaces": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
});
