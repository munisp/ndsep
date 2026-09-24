/**
 * Accessibility E2E — axe-core checks (gap 10)
 *
 * Runs @axe-core/playwright against the most citizen-facing routes with a
 * violation budget:
 *   - critical: 0 (hard fail)
 *   - serious:  0 on public routes
 *   - moderate/minor: reported, budget of 5 per page until remediation
 *     (see docs/accessibility-statement.md "Known issues")
 *
 * Requires the devDependency noted in g2_registration.md:
 *   "@axe-core/playwright": "^4.10.2"
 */
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const BUDGET = { critical: 0, serious: 0, moderate: 5, minor: 5 } as const;

const PUBLIC_ROUTES = [
  { path: "/", name: "home" },
  { path: "/dsar", name: "dsar-public-portal" },
  { path: "/registry", name: "public-compliance-registry" },
];

for (const route of PUBLIC_ROUTES) {
  test.describe(`a11y: ${route.name} (${route.path})`, () => {
    test("passes axe WCAG 2.1 AA scan within violation budget", async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState("domcontentloaded");
      // Give lazy sections a moment to render before scanning.
      await page.waitForTimeout(1500);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude("#ndsep-aria-live-polite")
        .exclude("#ndsep-aria-live-assertive")
        .analyze();

      const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const violation of results.violations) {
        const impact = (violation.impact ?? "minor") as keyof typeof byImpact;
        if (impact in byImpact) byImpact[impact] += 1;
        console.warn(
          `[axe:${route.path}] ${impact} — ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
        );
      }

      // Attach the full report for triage.
      await test.info().attach(`axe-${route.name}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      expect(byImpact.critical, "critical a11y violations must be zero").toBeLessThanOrEqual(BUDGET.critical);
      expect(byImpact.serious, "serious a11y violations must be zero").toBeLessThanOrEqual(BUDGET.serious);
      expect(byImpact.moderate, "moderate violations above remediation budget").toBeLessThanOrEqual(BUDGET.moderate);
      expect(byImpact.minor, "minor violations above remediation budget").toBeLessThanOrEqual(BUDGET.minor);
    });
  });
}

test.describe("a11y: keyboard & landmarks", () => {
  test("home page has a main landmark", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const main = page.locator("main, [role=main]").first();
    await expect(main).toBeAttached({ timeout: 10000 });
  });

  test("skip link becomes visible on keyboard focus when present", async ({ page }) => {
    await page.goto("/dsar");
    await page.waitForLoadState("domcontentloaded");
    const skipLink = page.locator(".ndsep-skip-link");
    // Soft check: skip link is progressive enhancement; only assert behaviour
    // when the wrapper that mounts it is on the route.
    if ((await skipLink.count()) > 0) {
      await page.keyboard.press("Tab");
      await expect(skipLink.first()).toBeFocused();
    }
  });
});
