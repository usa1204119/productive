import { defineConfig } from "vitest/config";

// The SceneSaver is pure TS (no DOM), so a node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
