/**
 * Playwright E2E Test Configuration
 * ===================================
 * Recommendation H8: Configure Playwright for executable E2E tests
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The CI suite exercises both desktop and mobile projects. Four workers keep
  // the complete isolated-browser matrix within its bounded release window.
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
    },
  ],
  webServer:
    process.env.CI && !process.env.E2E_BASE_URL
      ? {
          command: "pnpm run dev",
          url: "http://localhost:3000/api/health",
          // CI starts and health-checks the production bundle in the workflow.
          // Reuse it here rather than racing a second dev server for port 3000.
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
});
