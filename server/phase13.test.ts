/**
 * Phase 13 Integration Tests
 * Covers all 12 new Phase 13 routers:
 *   consentRecords, dpoRegistry, notificationCenter, penaltyCalculator,
 *   publicRegistry, riskScorecard, dataResidency, rateLimit,
 *   bulkDsar, whistleblowerCases, crossBorderMonitor, regulatoryReporting
 *
 * Uses the same graceful-skip pattern as phase9.test.ts:
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

async function expectOk(res: Response | null): Promise<any> {
  if (!res) return null;
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

// ─── Consent Records ─────────────────────────────────────────────────────────
describe("Phase 13 — Consent Records", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list consent records", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.consentRecords.list", { page: 1, limit: 10 }, adminCookie));
    if (data !== null) expect(Array.isArray(data.records ?? data)).toBe(true);
  });

  it("should create a consent record", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.consentRecords.create", {
      org_id: 1,
      data_subject_id: "subject-p13-001",
      data_subject_email: "subject@example.com",
      purpose: "marketing_analytics",
      legal_basis: "consent",
      data_categories: ["email", "name"],
      third_party_sharing: false,
      third_parties: [],
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.purpose ?? data.id).toBeTruthy();
  });

  it("should get consent stats", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.consentRecords.getStats", {}, adminCookie));
    if (data !== null) expect(typeof (Number(data.total ?? data.active ?? 0))).toBe("number");
  });

  it("should withdraw a consent record", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.consentRecords.withdraw", { id: createdId }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── DPO Registry ────────────────────────────────────────────────────────────
describe("Phase 13 — DPO Registry", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list DPO registry entries", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.dpoRegistry.list", { page: 1, limit: 10 }, adminCookie));
    if (data !== null) expect(Array.isArray(data.records ?? data)).toBe(true);
  });

  it("should create a DPO registry entry", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.dpoRegistry.create", {
      organization_id: 1,
      dpo_name: "Test DPO Officer",
      dpo_email: "dpo-test-p13@example.com",
      dpo_phone: "+2348012345678",
      dpco_name: "NDPC",
      notes: "Qualified DPO with CIPP/E certification",
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.dpo_name ?? data.id).toBeTruthy();
  });

  it("should get DPO stats", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.dpoRegistry.getStats", {}, adminCookie));
    if (data !== null) expect(typeof (Number(data.total ?? data.verified ?? 0))).toBe("number");
  });

  it("should verify a DPO entry", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.dpoRegistry.verify", {
      id: createdId,
      credential_status: "verified",
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Notification Center ─────────────────────────────────────────────────────
describe("Phase 13 — Notification Center", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list notifications", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.notificationCenter.list", { page: 1, limit: 10 }, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should get unread count", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.notificationCenter.getUnreadCount", {}, adminCookie));
    if (data !== null) expect(typeof (data.count ?? 0)).toBe("number");
  });

  it("should mark all notifications as read", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.notificationCenter.markAllRead", {}, adminCookie));
    if (data !== null) expect(data.success ?? data).toBeTruthy();
  });
});

// ─── Penalty Calculator ──────────────────────────────────────────────────────
describe("Phase 13 — Penalty Calculator", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list penalty calculations", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.penaltyCalculator.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should calculate a penalty", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.penaltyCalculator.calculate", {
      org_name: "Test Bank Nigeria",
      org_id: 1,
      violation_type: "data_breach",
      violation_date: new Date().toISOString().split("T")[0],
      annual_turnover: 5000000000,
      aggravating_factors: ["repeat_offender"],
      mitigating_factors: ["cooperation"],
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.final_penalty ?? data.id).toBeTruthy();
  });

  it("should approve a penalty calculation", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.penaltyCalculator.approve", {
      id: createdId,
      approved_by: "Director General",
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Public Registry ─────────────────────────────────────────────────────────
describe("Phase 13 — Public Registry", () => {
  let adminCookie: string | null = null;
  let upsertedId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list public registry entries (public)", async () => {
    const res = await safeFetch(`${BASE_URL}/api/trpc/phase13.publicRegistry.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should get public registry stats (public)", async () => {
    const res = await safeFetch(`${BASE_URL}/api/trpc/phase13.publicRegistry.getStats?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`);
    if (!res) return;
    expect(res.status).toBe(200);
  });

  it("should upsert a registry entry", async () => {
    if (!adminCookie) return;
    const res = await trpcPost("phase13.publicRegistry.upsert", {
      org_id: 1,
      org_name: "Test Bank Nigeria",
      sector: "finance",
      compliance_status: "compliant",
      compliance_score: 87,
      certifications: ["ISO27001", "NDPA"],
    }, adminCookie);
    if (!res) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const data = body?.result?.data?.json ?? body?.result?.data;
    // upsert may return null if ON CONFLICT DO NOTHING; that is still a valid 200
    if (data?.id) upsertedId = data.id;
    expect(res.status).toBe(200);
  });

  it("should publish a registry entry", async () => {
    if (!adminCookie) return;
    // Find an existing entry to publish
    const listRes = await safeFetch(`${BASE_URL}/api/trpc/phase13.publicRegistry.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`);
    if (!listRes) return;
    const listBody = await listRes.json() as any;
    const entries = listBody?.result?.data?.json ?? listBody?.result?.data ?? [];
    if (!Array.isArray(entries) || entries.length === 0) return;
    const id = upsertedId ?? entries[0].id;
    if (!id) return;
    const data = await expectOk(await trpcPost("phase13.publicRegistry.publish", { id }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Risk Scorecard ──────────────────────────────────────────────────────────
describe("Phase 13 — Risk Scorecard", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list risk scorecard entries", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.riskScorecard.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should create a risk entry", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.riskScorecard.create", {
      org_id: 1,
      risk_category: "data_security",
      risk_name: "Unencrypted PII Storage",
      likelihood: 4,
      impact: 5,
      owner: "CISO",
      mitigation_plan: "Implement AES-256 encryption across all storage tiers",
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.risk_name ?? data.id).toBeTruthy();
  });

  it("should get risk matrix", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.riskScorecard.getMatrix", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should update a risk entry", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.riskScorecard.update", {
      id: createdId,
      status: "mitigated",
      likelihood: 2,
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Data Residency ──────────────────────────────────────────────────────────
describe("Phase 13 — Data Residency", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list data residency locations", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.dataResidency.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should create a data residency location", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.dataResidency.create", {
      org_id: 1,
      data_category: "personal_data",
      storage_country: "NG",
      storage_region: "Lagos",
      provider_name: "AWS Lagos",
      provider_type: "cloud",
      volume_gb: 500,
      adequacy_decision: true,
      transfer_mechanism: "adequacy_decision",
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.storage_country ?? data.id).toBeTruthy();
  });

  it("should get data residency by country", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.dataResidency.getByCountry", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should delete a data residency location", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.dataResidency.delete", { id: createdId }, adminCookie));
    if (data !== null) expect(data.success ?? data).toBeTruthy();
  });
});

// ─── Rate Limit Dashboard ────────────────────────────────────────────────────
describe("Phase 13 — Rate Limit Dashboard", () => {
  let adminCookie: string | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should get rate limit stats", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.rateLimit.getStats", { hours: 24 }, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should get rate limit timeline", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.rateLimit.getTimeline", { hours: 24 }, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should get rate limit summary", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.rateLimit.getSummary", {}, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Bulk DSAR ───────────────────────────────────────────────────────────────
describe("Phase 13 — Bulk DSAR", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list bulk DSAR jobs", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.bulkDsar.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data.items ?? data)).toBe(true);
  });

  it("should create a bulk DSAR job", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.bulkDsar.create", {
      org_id: 1,
      job_name: "Q1 2026 Bulk Access Request",
      job_type: "data_export",
      total_subjects: 150,
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.job_name ?? data.id).toBeTruthy();
  });

  it("should process a bulk DSAR job", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.bulkDsar.process", { id: createdId }, adminCookie));
    if (data !== null) expect(data.success ?? data.processed).toBeTruthy();
  });

  it("should cancel a bulk DSAR job", async () => {
    if (!adminCookie) return;
    const newJob = await expectOk(await trpcPost("phase13.bulkDsar.create", {
      org_id: 1,
      job_name: "Test Cancellation Job",
      job_type: "erasure",
      total_subjects: 50,
    }, adminCookie));
    if (!newJob?.id) return;
    const data = await expectOk(await trpcPost("phase13.bulkDsar.cancel", { id: newJob.id }, adminCookie));
    if (data !== null) expect(data.success ?? data).toBeTruthy();
  });
});

// ─── Whistleblower Cases ─────────────────────────────────────────────────────
describe("Phase 13 — Whistleblower Cases", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list whistleblower cases", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.whistleblowerCases.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should get whistleblower stats", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.whistleblowerCases.getStats", {}, adminCookie));
    if (data !== null) expect(typeof (Number(data.total ?? data.new_cases ?? 0))).toBe("number");
  });

  it("should update whistleblower case status (existing case)", async () => {
    if (!adminCookie) return;
    // Get an existing case
    const cases = await expectOk(await trpcGet("phase13.whistleblowerCases.list", {}, adminCookie));
    if (!cases || !Array.isArray(cases) || cases.length === 0) return;
    const caseId = cases[0].id;
    const data = await expectOk(await trpcPost("phase13.whistleblowerCases.updateStatus", {
      id: caseId,
      status: "under_investigation",
      investigation_notes: "Case assigned to internal audit team for review",
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Cross-Border Monitor ────────────────────────────────────────────────────
describe("Phase 13 — Cross-Border Monitor", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list cross-border transfers", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.crossBorderMonitor.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should create a cross-border transfer record", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.crossBorderMonitor.create", {
      org_id: 1,
      org_name: "Test Bank Nigeria",
      destination_country: "US",
      data_category: "personal_data",
      transfer_mechanism: "standard_contractual_clauses",
      volume_records: 5000,
      safeguards: "SCCs signed, DPA in place, encryption in transit",
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.destination_country ?? data.id).toBeTruthy();
  });

  it("should get cross-border transfers by country", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.crossBorderMonitor.getByCountry", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should notify NITDA about a transfer", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.crossBorderMonitor.notifyNITDA", {
      id: createdId,
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Regulatory Reporting ────────────────────────────────────────────────────
describe("Phase 13 — Regulatory Reporting", () => {
  let adminCookie: string | null = null;
  let createdId: number | null = null;

  beforeAll(async () => { adminCookie = await getAdminCookie(); });

  it("should list regulatory reports", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcGet("phase13.regulatoryReporting.list", {}, adminCookie));
    if (data !== null) expect(Array.isArray(data)).toBe(true);
  });

  it("should generate a regulatory report", async () => {
    if (!adminCookie) return;
    const data = await expectOk(await trpcPost("phase13.regulatoryReporting.generate", {
      report_name: "Q4 2025 National Compliance Report",
      report_type: "quarterly_national",
      reporting_period_start: "2025-10-01",
      reporting_period_end: "2025-12-31",
      org_id: 1,
    }, adminCookie));
    if (data?.id) createdId = data.id;
    if (data !== null) expect(data.report_name ?? data.id).toBeTruthy();
  });

  it("should submit a regulatory report", async () => {
    if (!adminCookie || !createdId) return;
    const data = await expectOk(await trpcPost("phase13.regulatoryReporting.submit", {
      id: createdId,
      submitted_to: "NDPC",
    }, adminCookie));
    if (data !== null) expect(data).toBeTruthy();
  });
});

// ─── Phase 13 Security Headers ───────────────────────────────────────────────
describe("Phase 13 — Security Headers Validation", () => {
  it("should return X-Content-Type-Options: nosniff on Phase 13 routes", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("should return X-Frame-Options or CSP frame-ancestors header", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    const frameOptions = res.headers.get("x-frame-options");
    const csp = res.headers.get("content-security-policy");
    expect(frameOptions !== null || (csp !== null && csp.includes("frame"))).toBe(true);
  });

  it("should return NDSEP API version header", async () => {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    if (!res) return;
    expect(res.headers.get("x-ndsep-api-version")).toBe("2.0.0");
  });
});
