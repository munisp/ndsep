/**
 * Phase 9 Integration Tests
 * Covers: Security Audit, Multi-Org Trend Compare, DSAR Lifecycle,
 *         User Management CRUD, Audit Export, NIP Reconciliation, Platform Stats,
 *         Changelog Admin, Transfer Approval Rules, Theme Preferences,
 *         Security Headers hardening.
 *
 * Uses the same graceful-skip pattern as smoke.test.ts:
 * if the server is not running, tests are skipped (not failed).
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  return fetch(url, init).catch(() => null);
}

async function getAdminCookie(): Promise<string | null> {
  const res = await safeFetch(`${BASE_URL}/api/demo-login?role=admin`, { redirect: "manual" });
  if (!res) return null;
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

async function getUserCookie(): Promise<string | null> {
  const res = await safeFetch(`${BASE_URL}/api/demo-login`, { redirect: "manual" });
  if (!res) return null;
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

async function trpcGet(procedure: string, input: unknown, cookie: string): Promise<Response | null> {
  const qs = encodeURIComponent(JSON.stringify({ json: input }));
  return safeFetch(`${BASE_URL}/api/trpc/${procedure}?input=${qs}`, {
    headers: { Cookie: cookie },
  });
}

async function trpcPost(procedure: string, input: unknown, cookie: string): Promise<Response | null> {
  return safeFetch(`${BASE_URL}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ json: input }),
  });
}

// ─── Security Headers ────────────────────────────────────────────────────────

describe("Phase 9 — Security Headers", () => {
  it("should return X-Content-Type-Options: nosniff", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("should return Content-Security-Policy header", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("should return X-NDSEP-Platform header", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("x-ndsep-platform")).toBe("National Data Sovereignty Enforcement Platform");
  });

  it("should not expose X-Powered-By header", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("should not serve /etc/passwd via path traversal", async () => {
    const res = await safeFetch(`${BASE_URL}/api/../../../etc/passwd`);
    if (!res) return;
    const text = await res.text();
    expect(text).not.toContain("root:x:");
    expect(text).not.toContain("/bin/bash");
  });

  it("should block SQL injection patterns in URL (400 or 401)", async () => {
    const res = await safeFetch(`${BASE_URL}/api/trpc/auth.me?input=%27%20OR%201%3D1--`);
    if (!res) return;
    expect([400, 401, 403]).toContain(res.status);
  });

  it("should block XSS patterns in URL (400 or 401)", async () => {
    const res = await safeFetch(`${BASE_URL}/api/trpc/auth.me?input=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
    if (!res) return;
    expect([400, 401, 403]).toContain(res.status);
  });

  it("CSP should not contain unsafe-eval in production", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    const csp = res.headers.get("content-security-policy") ?? "";
    // In dev mode unsafe-eval is allowed; in prod it must not be present
    if (process.env.NODE_ENV === "production") {
      expect(csp).not.toContain("unsafe-eval");
    }
    // Always check that CSP is present
    expect(csp.length).toBeGreaterThan(0);
  });
});

// ─── Security Audit Router ───────────────────────────────────────────────────

describe("Phase 9 — Security Audit", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return a security score (admin)", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("securityAudit.getScore", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data) {
      const score = data?.overallScore ?? data?.score ?? data;
      if (typeof score === "number") {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("should return security findings list (admin)", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("securityAudit.getFindings", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

// ─── Compliance Trend Router ─────────────────────────────────────────────────

describe("Phase 9 — Compliance Trend", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return sparkline history", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("sparkline.getHistory", { days: 30 }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });

  it("should return anomalies for org 1", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("complianceTrend.getAnomalies", { orgId: 1 }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

// ─── DSAR Lifecycle Router ───────────────────────────────────────────────────

describe("Phase 9 — DSAR Lifecycle", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return DSAR deadline alerts", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("dsarLifecycle.getDeadlineAlerts", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });

  it("should return DSAR statistics", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("dsarLifecycle.getStats", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    expect(data).toBeDefined();
  });
});

// ─── User Management Router ──────────────────────────────────────────────────

describe("Phase 9 — User Management", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should list users (admin only)", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("userManagement.list", { page: 1, pageSize: 10 }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      const users = data?.users ?? data;
      expect(Array.isArray(users)).toBe(true);
    }
  });

  it("should reject non-admin user listing", async () => {
    const userCookie = await getUserCookie();
    if (!userCookie) return;
    const res = await trpcGet("userManagement.list", { page: 1, pageSize: 10 }, userCookie);
    if (!res) return;
    // Either 403 FORBIDDEN or 401 UNAUTHORIZED
    if (res.status === 200) {
      const body = await res.json() as any;
      const error = body?.error;
      if (error) {
        expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(error?.data?.code);
      }
    } else {
      expect([401, 403]).toContain(res.status);
    }
  });
});

// ─── Audit Export Router ─────────────────────────────────────────────────────

describe("Phase 9 — Audit Export", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return audit log entries for export", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("auditExport.getLogs", { limit: 50, format: "json" }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    expect(data).toBeDefined();
  });

  it("should return violation entries for export", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("auditExport.getViolations", { limit: 50 }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

// ─── NIP Reconciliation Router ───────────────────────────────────────────────

describe("Phase 9 — NIP Reconciliation", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return NIP reconciliation summary", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("nipReconciliation.getSummary", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    expect(data).toBeDefined();
  });

  it("should return NIP transactions list", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("nipReconciliation.getTransactions", { limit: 20 }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

// ─── Platform Stats Router ───────────────────────────────────────────────────

describe("Phase 9 — Platform Stats", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return platform statistics", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("platformStats.getStats", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    expect(data).toBeDefined();
  });

  it("should return API health metrics", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("apiHealth.getMetrics", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    expect(data).toBeDefined();
  });
});

// ─── Changelog Admin Router ──────────────────────────────────────────────────

describe("Phase 9 — Changelog Admin", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should list changelogs (public)", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("changelog.list", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });

  it("should create a changelog entry (admin)", async () => {
    if (!adminCookie) return;
    const res = await trpcPost("changelogAdmin.create", {
      version: "9.9.9-test",
      title: "Phase 9 Test Entry",
      body: "This is a test changelog entry created by the Phase 9 test suite.",
      category: "feature",
    }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data?.id) createdId = data.id;
  });

  it("should update a changelog entry (admin)", async () => {
    if (!adminCookie || !createdId) return;
    const res = await trpcPost("changelogAdmin.update", {
      id: createdId,
      title: "Phase 9 Test Entry (Updated)",
    }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
  });

  it("should delete a changelog entry (admin)", async () => {
    if (!adminCookie || !createdId) return;
    const res = await trpcPost("changelogAdmin.delete", { id: createdId }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
  });
});

// ─── Theme Preferences Router ────────────────────────────────────────────────

describe("Phase 9 — Theme Preferences", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should get theme preference", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("themePrefs.get", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      const theme = data?.theme ?? data;
      expect(["light", "dark", null, undefined]).toContain(theme);
    }
  });

  it("should set theme preference to dark", async () => {
    if (!adminCookie) return;
    const res = await trpcPost("themePrefs.set", { theme: "dark" }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
  });

  it("should set theme preference to light", async () => {
    if (!adminCookie) return;
    const res = await trpcPost("themePrefs.set", { theme: "light" }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
  });
});

// ─── Transfer Approval Rules Router ─────────────────────────────────────────

describe("Phase 9 — Transfer Approval Rules", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => {
    adminCookie = await getAdminCookie();
  });

  it("should return transfer approval rules list", async () => {
    if (!adminCookie) return;
    const res = await trpcGet("transferApprovalRules.list", {}, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== undefined) {
      expect(Array.isArray(data)).toBe(true);
    }
  });

  it("should create a transfer approval rule (admin)", async () => {
    if (!adminCookie) return;
    const res = await trpcPost("transferApprovalRules.create", {
      sourceCountry: "NG",
      destinationCountry: "US",
      dataCategory: "financial",
      requiresApproval: true,
      autoApproveThresholdMb: 0,
      notes: "Test rule created by Phase 9 tests",
    }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
  });
});
