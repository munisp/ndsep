/*
 * NDSEP Critical Workflow E2E Tests
 *
 * This CI shard runs without Keycloak credentials. It verifies that the public
 * application shell is responsive, unauthenticated users cannot see privileged
 * navigation, protected routes present an explicit sign-in boundary, and public
 * API endpoints use valid paths. Authenticated workflow acceptance belongs in
 * the protected staging suite, with a real Keycloak-issued session.
 */
import { test, expect } from "@playwright/test";

const SIGN_IN_HEADING = "Sign in to continue";

async function expectUnauthenticatedBoundary(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: SIGN_IN_HEADING })).toBeVisible();
  await expect(page.locator("nav, [role=navigation]")).toHaveCount(0);
}

test.describe("Unauthenticated dashboard boundary", () => {
  test("loads the secure sign-in state without evaluating privileged navigation", async ({ page }) => {
    const startedAt = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectUnauthenticatedBoundary(page);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("does not render sidebar navigation before authentication", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectUnauthenticatedBoundary(page);
  });
});

test.describe("Protected route boundaries", () => {
  const protectedRoutes = [
    "/organizations",
    "/enforcement",
    "/breach-incidents",
    "/data-transfers",
    "/network-intelligence",
    "/banking",
    "/telecom",
    "/healthcare",
    "/insurance",
    "/energy",
  ];

  for (const path of protectedRoutes) {
    test(`${path} presents the sign-in boundary without privileged content`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expectUnauthenticatedBoundary(page);
    });
  }
});

test.describe("Public API responses", () => {
  test("health endpoint returns a successful health response", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ status: expect.any(String) }));
  });

  test("auth.me tRPC procedure returns a valid unauthenticated response", async ({ request }) => {
    const response = await request.get("/api/trpc/auth.me?batch=1&input=%7B%7D");
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.any(Object));
  });
});

test.describe("Performance budgets", () => {
  test("the unauthenticated main page reaches the real sign-in boundary within budget", async ({ page }) => {
    const startedAt = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectUnauthenticatedBoundary(page);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
