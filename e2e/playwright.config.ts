/**
 * NDSEP Playwright E2E Test Configuration
 *
 * Comprehensive end-to-end testing covering:
 * - All critical compliance workflows
 * - Dashboard rendering and data integrity
 * - Authentication and authorization flows
 * - Cross-browser compatibility
 * - Performance budgets
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/e2e-results.json" }],
    process.env.CI ? ["github"] : ["list"],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "pnpm run dev",
        port: 3000,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
