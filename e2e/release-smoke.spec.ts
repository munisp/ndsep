import { expect, test } from "@playwright/test";

const BASE =
  process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function trpcResponse(
  page: import("@playwright/test").Page,
  procedure: string
) {
  return page.request.get(`${BASE}/api/trpc/${procedure}`);
}

test.describe("Release smoke", () => {
  test("health endpoint reports a healthy API", async ({ page }) => {
    const response = await page.request.get(`${BASE}/api/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", service: "ndsep-api" });
  });

  test("public application shell renders without a browser runtime error", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", error => pageErrors.push(error));

    const response = await page.goto(BASE, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#root")).toBeAttached();
    await expect(page.locator("body")).not.toContainText(
      "Unhandled Runtime Error"
    );
    expect(pageErrors).toEqual([]);
  });

  test("authentication status endpoint returns a well-formed unauthenticated response", async ({
    page,
  }) => {
    const response = await trpcResponse(page, "auth.me");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("result");
  });

  test("protected orchestration metadata is not anonymously exposed", async ({
    page,
  }) => {
    const response = await trpcResponse(page, "orchestration.temporalConfig");
    expect(response.status()).toBe(401);
  });

  test("protected worker status is not anonymously exposed", async ({
    page,
  }) => {
    const response = await page.request.get(`${BASE}/api/workers/status`);
    expect(response.status()).toBe(401);
  });
});
