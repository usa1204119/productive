import { defineConfig, devices } from "@playwright/test";

const serverEnv = {
  ...process.env,
  NODE_ENV: "test",
  E2E_TEST_MODE: "true",
  USE_PGLITE: "true",
  SHARING_ENABLED: "true",
  MAIL_PROVIDER: "memory",
  PORT: "4100",
  SERVER_URL: "http://127.0.0.1:4100",
  WEB_URL: "http://127.0.0.1:4173",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  SESSION_COOKIE_SECURE: "false",
  GOOGLE_CLIENT_ID: "e2e-client",
  GOOGLE_CLIENT_SECRET: "e2e-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://127.0.0.1:4100/auth/google/callback",
  GOOGLE_DRIVE_REDIRECT_URI: "http://127.0.0.1:4100/auth/google/drive/callback",
  ENCRYPTION_KEY: "00".repeat(32),
};

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run smoke:schema --workspace apps/server && npm run dev:server",
      cwd: "../..",
      url: "http://127.0.0.1:4100/health",
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 4173",
      cwd: "../..",
      url: "http://127.0.0.1:4173",
      env: { ...process.env, API_PROXY_TARGET: "http://127.0.0.1:4100" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
