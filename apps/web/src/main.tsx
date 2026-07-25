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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
