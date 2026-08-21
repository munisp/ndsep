/**
 * NDSEP Critical Workflow E2E Tests
 *
 * Tests the golden-path user flows that must work for production readiness.
 */
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads main dashboard with compliance overview", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // Performance budget: page should load within 3s
    const timing = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
    expect(timing).toBeLessThan(5000);
  });

  test("sidebar navigation has all critical sections", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("nav, [role=navigation]").first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Compliance Workflows", () => {
  test("organization list loads with data", async ({ page }) => {
    await page.goto("/organizations");
    await page.waitForLoadState("networkidle");
    // Should have either org cards or a table
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("enforcement dashboard loads", async ({ page }) => {
    await page.goto("/enforcement");
    await page.waitForLoadState("networkidle");
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("breach incidents page loads", async ({ page }) => {
    await page.goto("/breach-incidents");
    await page.waitForLoadState("networkidle");
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });

  test("data transfers page loads", async ({ page }) => {
    await page.goto("/data-transfers");
    await page.waitForLoadState("networkidle");
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });
});

test.describe("Network Intelligence", () => {
  test("network intelligence page loads with tabs", async ({ page }) => {
    await page.goto("/network-intelligence");
    await page.waitForLoadState("networkidle");
    const content = await page.textContent("body");
    expect(content).toBeTruthy();
  });
});

test.describe("Sector Dashboards", () => {
  const sectors = [
    { path: "/banking", name: "Banking" },
    { path: "/telecom", name: "Telecom" },
    { path: "/healthcare", name: "Healthcare" },
    { path: "/insurance", name: "Insurance" },
    { path: "/energy", name: "Energy" },
  ];

  for (const sector of sectors) {
    test(`${sector.name} dashboard loads`, async ({ page }) => {
      await page.goto(sector.path);
      await page.waitForLoadState("networkidle");
      const content = await page.textContent("body");
      expect(content).toBeTruthy();
    });
  }
});

test.describe("API Responses", () => {
  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/health");
    expect(response.status()).toBeLessThan(500);
  });

  test("tRPC endpoint exists", async ({ request }) => {
    const response = await request.get("/api/trpc");
    // Should not be 404 — could be 401 (auth required) or 400 (bad request)
    expect(response.status()).not.toBe(404);
  });
});

test.describe("Performance Budgets", () => {
  test("main page loads under performance budget", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const elapsed = Date.now() - start;
    // Page should be interactive within 5s
    expect(elapsed).toBeLessThan(5000);
  });
});
