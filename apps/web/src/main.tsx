// Excalidraw (and some deps) read `process.env` at runtime in the browser.
// In a production bundle `process` is undefined -> ReferenceError -> crash.
// Shim it before anything (including the lazy Excalidraw chunk) loads.
(globalThis as unknown as { process?: { env: Record<string, string> } }).process ??= { env: {} };

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import "./index.css";

// Retry only transient failures (a cold-starting server, a blip, a rate limit).
// Never retry definitive client errors (auth/permission/not-found/validation) —
// those won't change on their own and would just delay the real error.
const RETRYABLE_CODES = new Set(["NETWORK_ERROR", "INTERNAL_ERROR", "RATE_LIMITED"]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const code = (error as { code?: string } | null)?.code;
        return code !== undefined && RETRYABLE_CODES.has(code) && failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 4000),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
