/**
 * NDSEP Visual Regression Baseline — Phase 40
 * ============================================
 * Captures screenshot snapshots of critical UI pages for visual regression
 * detection in future phases. Run with:
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 * to create/update baseline snapshots.
 *
 * On subsequent runs (no --update-snapshots), failures indicate UI regressions.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

// Pages to snapshot — covers the most visually complex and business-critical pages
const SNAPSHOT_PAGES = [
  { name: "login-page", path: "/", waitFor: "h1, .hero, [data-testid='login']" },
  {
    name: "dashboard-home",
    path: "/dashboard",
    waitFor: ".dashboard-stats, [data-testid='stats'], h1",
  },
  {
    name: "penalty-table",
    path: "/financial-enforcement/penalties",
    waitFor: "table, [data-testid='penalty-table'], h1",
  },
  {
    name: "compliance-calendar",
    path: "/compliance/calendar",
    waitFor: ".calendar, [data-testid='calendar'], h1",
  },
  {
    name: "aml-cases",
    path: "/banking/aml",
    waitFor: "table, [data-testid='aml-table'], h1",
  },
  {
    name: "kyc-records",
    path: "/banking/kyc",
    waitFor: "table, [data-testid='kyc-table'], h1",
  },
  {
    name: "organizations-list",
    path: "/organizations",
    waitFor: "table, [data-testid='org-table'], h1",
  },
  {
    name: "audit-logs",
    path: "/audit-logs",
    waitFor: "table, [data-testid='audit-table'], h1",
  },
  {
    name: "siem-dashboard",
    path: "/siem",
    waitFor: "[data-testid='siem'], h1, .siem",
  },
  {
    name: "breach-notifications",
    path: "/breach-notifications",
    waitFor: "table, [data-testid='breach-table'], h1",
  },
];

test.describe("Visual Regression Baseline", () => {
  test.beforeEach(async ({ page }) => {
    // Set a consistent viewport for all snapshots
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const { name, path, waitFor } of SNAPSHOT_PAGES) {
    test(`snapshot: ${name}`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      // Wait for the primary content element to appear
      try {
        await page.waitForSelector(waitFor, { timeout: 8000 });
      } catch {
        // Page may require auth — still capture the auth redirect state
      }

      // Wait for any loading spinners to disappear
      await page.waitForTimeout(500);

      // Mask dynamic content (timestamps, IDs) to avoid flaky snapshots
      await page.addStyleTag({
        content: `
          [data-testid="timestamp"],
          [data-testid="last-updated"],
          .timestamp,
          .last-updated,
          time {
            visibility: hidden !important;
          }
        `,
      });

      // Take full-page screenshot
      const screenshot = await page.screenshot({
        fullPage: true,
        animations: "disabled",
      });

      // Compare against baseline (creates baseline on first run with --update-snapshots)
      expect(screenshot).toMatchSnapshot(`${name}.png`, {
        maxDiffPixelRatio: 0.02, // Allow up to 2% pixel difference (anti-aliasing, etc.)
        threshold: 0.1, // Per-pixel color threshold
      });
    });
  }

  test("snapshot: mobile viewport - dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
    await page.goto(`${BASE_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(500);

    const screenshot = await page.screenshot({
      fullPage: false, // Just the viewport for mobile
      animations: "disabled",
    });

    expect(screenshot).toMatchSnapshot("dashboard-mobile.png", {
      maxDiffPixelRatio: 0.02,
      threshold: 0.1,
    });
  });

  test("snapshot: tablet viewport - compliance calendar", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto(`${BASE_URL}/compliance/calendar`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(500);

    const screenshot = await page.screenshot({
      fullPage: false,
      animations: "disabled",
    });

    expect(screenshot).toMatchSnapshot("compliance-calendar-tablet.png", {
      maxDiffPixelRatio: 0.02,
      threshold: 0.1,
    });
  });
});
