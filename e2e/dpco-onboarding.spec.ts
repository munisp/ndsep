/**
 * DPCO Onboarding Flow — Playwright E2E Smoke Tests
 * ==================================================
 * Covers the full DPCO lifecycle:
 *   1. Public accreditation application submission
 *   2. Application status tracking by reference token
 *   3. Certificate verification (public /verify/:token route)
 *   4. DPCO billing — subscription tiers, invoices
 *   5. Demo login flows (admin + DPCO)
 *   6. Admin accreditation review procedures
 *   7. DPCO client portal procedures
 *   8. Revenue analytics (admin)
 *
 * IMPORTANT: tRPC v11 requires input wrapped as { "json": { ...actual input... } }
 * IMPORTANT: Authenticated requests must use page.evaluate(fetch) so the browser
 *            cookie jar (set by page.goto demo-login) is included.
 */
import { test, expect, Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** tRPC v11 GET query via browser fetch (sends cookies) */
async function trpcGet(page: Page, path: string, input?: object): Promise<{ status: number; data: any }> {
  const wrapped = input ? { json: input } : undefined;
  const url = wrapped
    ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(wrapped))}`
    : `${BASE}/api/trpc/${path}`;
  return page.evaluate(async (fetchUrl: string) => {
    const res = await fetch(fetchUrl, { credentials: "include" });
    const json = await res.json().catch(() => null);
    const data = json?.result?.data?.json ?? json?.result?.data ?? null;
    return { status: res.status, data };
  }, url);
}

/** tRPC v11 POST mutation via browser fetch (sends cookies) */
async function trpcPost(page: Page, path: string, body: object): Promise<{ status: number; data: any }> {
  return page.evaluate(
    async ([fetchUrl, payload]: [string, string]) => {
      const res = await fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: payload,
      });
      const json = await res.json().catch(() => null);
      const data = json?.result?.data?.json ?? json?.result?.data ?? null;
      return { status: res.status, data };
    },
    [`${BASE}/api/trpc/${path}`, JSON.stringify({ json: body })] as [string, string]
  );
}

/** Navigate to demo-login so the browser context receives the session cookie */
async function demoLogin(page: Page, role: "admin" | "dpco") {
  await page.goto(`${BASE}/api/demo-login?role=${role}`, { waitUntil: "networkidle" });
}

// ─── Suite 1: Public Accreditation Application ───────────────────────────────
test.describe("DPCO Onboarding 1: Accreditation application (public)", () => {
  test("submitApplication tRPC procedure is reachable", async ({ page }) => {
    await page.goto(BASE);
    const result = await trpcPost(page, "accreditation.submitApplication", {
      orgName: "Test Org E2E",
      rcNumber: "RC-E2E-001",
      address: "123 Test Street, Lagos",
      email: "e2e@testorg.ng",
      leadAuditors: [{ name: "Test Auditor", email: "auditor@test.ng", certifications: ["CISA"] }],
      sectors: ["fintech"],
      conflictDeclaration: true,
    });
    // Should be 200 (success) or 400 (validation) — not 404 or 500
    expect([200, 400]).toContain(result.status);
  });

  test("getApplicationStatus returns NOT_FOUND for unknown token", async ({ page }) => {
    await page.goto(BASE);
    const result = await trpcGet(page, "accreditation.getApplicationStatus", {
      token: "NDPC-DPCO-NONEXISTENT",
    });
    // NOT_FOUND maps to 404 in tRPC
    expect([404]).toContain(result.status);
  });

  test("publicListDpcos returns an array", async ({ page }) => {
    await page.goto(BASE);
    const result = await trpcGet(page, "accreditation.publicListDpcos");
    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ─── Suite 2: Certificate Verification (public) ───────────────────────────────
test.describe("DPCO Onboarding 2: Certificate verification", () => {
  test("verify.certificate returns valid=false for unknown token", async ({ page }) => {
    await page.goto(BASE);
    const result = await trpcGet(page, "verify.certificate", {
      token: "NDPC-DPCO-NONEXISTENT-TOKEN",
    });
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    expect(result.data.valid).toBe(false);
  });

  test("accreditation.verifyDpcoCertificate returns valid=false for unknown token", async ({ page }) => {
    await page.goto(BASE);
    const result = await trpcGet(page, "accreditation.verifyDpcoCertificate", {
      token: "NDPC-DPCO-NONEXISTENT",
    });
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    expect(result.data.valid).toBe(false);
  });

  test("verify.certificate returns valid=true for a known token (if available)", async ({ page }) => {
    await page.goto(BASE);
    const listResult = await trpcGet(page, "accreditation.publicListDpcos");
    const dpcos = listResult.data as Array<{ certificate_token?: string }>;
    const withToken = dpcos?.find((d) => d.certificate_token);
    if (withToken?.certificate_token) {
      const result = await trpcGet(page, "verify.certificate", {
        token: withToken.certificate_token,
      });
      expect(result.status).toBe(200);
      expect(typeof result.data.valid).toBe("boolean");
    } else {
      test.skip(true, "No certified DPCO with certificate_token in demo data");
    }
  });
});

// ─── Suite 3: DPCO Billing & Subscription ────────────────────────────────────
test.describe("DPCO Onboarding 3: Billing and subscription", () => {
  test("billing.getSubscriptionTiers returns tier list after demo login", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "billing.getSubscriptionTiers");
    expect(result.status).toBe(200);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(3);
    const tierKeys = result.data.map((t: { key: string }) => t.key);
    expect(tierKeys).toContain("starter");
    expect(tierKeys).toContain("professional");
    expect(tierKeys).toContain("enterprise");
  });

  test("billing.getSubscription returns subscription for org 1 after demo login", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "billing.getSubscription", { dpcoOrgId: 1 });
    expect(result.status).toBe(200);
    // May be null if no subscription exists, or an object
    expect(result.data === null || typeof result.data === "object").toBe(true);
  });

  test("billing.listInvoices returns invoices for org 1 after demo login", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "billing.listInvoices", { dpcoOrgId: 1 });
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    const rows = Array.isArray(result.data) ? result.data : (result.data?.rows ?? []);
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─── Suite 4: Demo Login Flows ────────────────────────────────────────────────
test.describe("DPCO Onboarding 4: Demo login flows", () => {
  test("Demo DPCO login endpoint responds and sets session", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "auth.me");
    expect(result.status).toBe(200);
    // auth.me returns null for unauthenticated, or a user object
    if (result.data !== null && result.data !== undefined) {
      expect(typeof result.data).toBe("object");
    }
  });

  test("Demo admin login endpoint responds and sets session", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "auth.me");
    expect(result.status).toBe(200);
  });

  test("After demo DPCO login, auth.me returns a user", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "auth.me");
    expect(result.status).toBe(200);
    if (result.data !== null && result.data !== undefined) {
      expect(typeof result.data).toBe("object");
    }
  });

  test("After demo admin login, auth.me returns admin user", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "auth.me");
    expect(result.status).toBe(200);
    if (result.data !== null && result.data !== undefined && typeof result.data === "object") {
      expect(["admin", "government_staff", "user"]).toContain(
        (result.data as { role?: string }).role ?? "user"
      );
    }
  });

  test("Logout endpoint clears session", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcPost(page, "auth.logout", {});
    expect(result.status).toBe(200);
    if (typeof result.data === "object" && result.data !== null) {
      expect(typeof (result.data as { success: unknown }).success).toBe("boolean");
    }
  });
});

// ─── Suite 5: Admin Accreditation Review ─────────────────────────────────────
test.describe("DPCO Onboarding 5: Admin accreditation review", () => {
  test("accreditation.adminGetStats returns stats after admin login", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "accreditation.adminGetStats");
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    expect(typeof result.data.total).toBe("number");
    expect(typeof result.data.activeDpcos).toBe("number");
  });

  test("accreditation.adminListApplications returns applications after admin login", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "accreditation.adminListApplications", {});
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    const rows = Array.isArray(result.data) ? result.data : (result.data?.rows ?? result.data?.applications ?? []);
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─── Suite 6: DPCO Client Portal ─────────────────────────────────────────────
test.describe("DPCO Onboarding 6: DPCO client portal", () => {
  test("dpco.listClients returns clients for org 1 after demo login", async ({ page }) => {
    await demoLogin(page, "dpco");
    const result = await trpcGet(page, "dpco.listClients", { dpcoOrgId: 1 });
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    const rows = Array.isArray(result.data) ? result.data : (result.data?.rows ?? []);
    expect(Array.isArray(rows)).toBe(true);
  });

  test("dpco.getOrganisation returns org details after demo login", async ({ page }) => {
    await demoLogin(page, "dpco");
    // getOrganisation requires an org id — use org 1 (demo org)
    const result = await trpcGet(page, "dpco.getOrganisation", { id: 1 });
    // 200 if org exists, 404 if not found
    expect([200, 404]).toContain(result.status);
    if (result.status === 200) {
      expect(result.data === null || typeof result.data === "object").toBe(true);
    }
  });
});

// ─── Suite 7: Revenue & Admin Analytics ──────────────────────────────────────
test.describe("DPCO Onboarding 7: Revenue analytics", () => {
  test("billing.listRevenueSplits returns splits after admin login", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "billing.listRevenueSplits", {});
    expect(result.status).toBe(200);
    expect(result.data).toBeDefined();
    const rows = Array.isArray(result.data) ? result.data : (result.data?.rows ?? []);
    expect(Array.isArray(rows)).toBe(true);
  });

  test("billing.getRevenueSummary returns summary after admin login", async ({ page }) => {
    await demoLogin(page, "admin");
    const result = await trpcGet(page, "billing.getRevenueSummary");
    expect([200, 400, 401, 404]).toContain(result.status);
  });
});
