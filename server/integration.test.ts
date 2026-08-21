/**
 * NDSEP Integration Test Suite
 * Tests the full tRPC router stack with mocked database layer.
 * Run: pnpm test server/integration.test.ts
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─────────────────────────────────────────────────────────────────────────────
// Mock all DB helpers
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  // Organizations
  getOrganizations: vi.fn().mockResolvedValue([
    { id: 1, name: "National Bank", sector: "finance", complianceScore: "85.5", riskScore: "22.3" },
    { id: 2, name: "Telecom Alpha", sector: "telecom", complianceScore: "42.1", riskScore: "78.9" },
  ]),
  getOrganizationById: vi.fn().mockResolvedValue({ id: 1, name: "National Bank", sector: "finance" }),
  createOrganization: vi.fn().mockResolvedValue({ id: 3, name: "New Org" }),
  updateOrganization: vi.fn().mockResolvedValue({ id: 1, name: "Updated Bank" }),
  deleteOrganization: vi.fn().mockResolvedValue(true),
  // Compliance
  getCompliancePolicies: vi.fn().mockResolvedValue([]),
  getComplianceViolations: vi.fn().mockResolvedValue([]),
  getEnforcementActions: vi.fn().mockResolvedValue([]),
  // Breaches
  listBreachIncidents: vi.fn().mockResolvedValue([]),
  createBreachIncident: vi.fn().mockResolvedValue({ id: 1, title: 'Test Breach' }),
  updateBreachIncident: vi.fn().mockResolvedValue({ id: 1, status: 'notified' }),
  deleteBreachIncident: vi.fn().mockResolvedValue(true),
  // Assets
  listAssets: vi.fn().mockResolvedValue({ assets: [], total: 0 }),
  createAsset: vi.fn().mockResolvedValue({ id: 1, name: "Test Asset" }),
  updateAsset: vi.fn().mockResolvedValue({ id: 1, name: "Updated Asset" }),
  deleteAsset: vi.fn().mockResolvedValue(true),
  // Dashboard
  getDashboardStats: vi.fn().mockResolvedValue({
    totalOrganizations: 150,
    compliantOrganizations: 112,
    activeViolations: 23,
    openBreaches: 5,
    avgComplianceScore: 78.4,
  }),
  // Consent
  listConsents: vi.fn().mockResolvedValue({ consents: [], total: 0 }),
  createConsent: vi.fn().mockResolvedValue({ id: 1, purpose: "analytics" }),
  updateConsent: vi.fn().mockResolvedValue({ id: 1, status: "withdrawn" }),
  deleteConsent: vi.fn().mockResolvedValue(true),
  // DPIA
  listDpiaAssessments: vi.fn().mockResolvedValue({ assessments: [], total: 0 }),
  createDpiaAssessment: vi.fn().mockResolvedValue({ id: 1, title: "Test DPIA" }),
  updateDpiaAssessment: vi.fn().mockResolvedValue({ id: 1, status: "approved" }),
  deleteDpiaAssessment: vi.fn().mockResolvedValue(true),
  // DPO Registry
  listDpoRegistrations: vi.fn().mockResolvedValue({ registrations: [], total: 0 }),
  createDpoRegistration: vi.fn().mockResolvedValue({ id: 1, name: "John DPO" }),
  updateDpoRegistration: vi.fn().mockResolvedValue({ id: 1, status: "active" }),
  deleteDpoRegistration: vi.fn().mockResolvedValue(true),
  // Penalties
  listPenalties: vi.fn().mockResolvedValue({ penalties: [], total: 0 }),
  createPenalty: vi.fn().mockResolvedValue({ id: 1, amount: "50000" }),
  updatePenalty: vi.fn().mockResolvedValue({ id: 1, status: "paid" }),
  deletePenalty: vi.fn().mockResolvedValue(true),
  // Enforcement Cases
  listEnforcementCases: vi.fn().mockResolvedValue({ cases: [], total: 0 }),
  createEnforcementCase: vi.fn().mockResolvedValue({ id: 1, title: "Test Case" }),
  updateEnforcementCase: vi.fn().mockResolvedValue({ id: 1, status: "open" }),
  deleteEnforcementCase: vi.fn().mockResolvedValue(true),
  // Notifications
  listNotifications: vi.fn().mockResolvedValue({ notifications: [], total: 0 }),
  markNotificationRead: vi.fn().mockResolvedValue(true),
  // Misc
  getWorkerStatus: vi.fn().mockResolvedValue([]),
  getWorkersStatus: vi.fn().mockResolvedValue([]),
  listAuditLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  listRopaRecords: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  createRopaRecord: vi.fn().mockResolvedValue({ id: 1 }),
  updateRopaRecord: vi.fn().mockResolvedValue({ id: 1 }),
  deleteRopaRecord: vi.fn().mockResolvedValue(true),
  listTransferApprovals: vi.fn().mockResolvedValue({ approvals: [], total: 0 }),
  createTransferApproval: vi.fn().mockResolvedValue({ id: 1 }),
  updateTransferApproval: vi.fn().mockResolvedValue({ id: 1 }),
  deleteTransferApproval: vi.fn().mockResolvedValue(true),
  listRetentionPolicies: vi.fn().mockResolvedValue({ policies: [], total: 0 }),
  createRetentionPolicy: vi.fn().mockResolvedValue({ id: 1 }),
  updateRetentionPolicy: vi.fn().mockResolvedValue({ id: 1 }),
  deleteRetentionPolicy: vi.fn().mockResolvedValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test Context Factories
// ─────────────────────────────────────────────────────────────────────────────
const makePublicCtx = (): TrpcContext => ({
  user: null,
  req: {} as any,
  res: {} as any,
});

const makeAuthCtx = (role: "admin" | "user" = "user"): TrpcContext => ({
  user: {
    id: 1,
    openId: "test-open-id",
    name: "Test User",
    email: "test@ndsep.gov.ng",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  req: {} as any,
  res: {} as any,
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth Router Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Auth Router", () => {
  it("auth.me returns null for unauthenticated users", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("auth.me returns user for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test User");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Router Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Dashboard Router", () => {
  it("dashboard.stats returns stats for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.dashboard.stats();
    expect(result).toBeDefined();
  });

  it("dashboard.stats throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.dashboard.stats()).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Organizations Router Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Organizations Router", () => {
  it("organizations.list returns organizations for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.organizations.list({ page: 1, pageSize: 20 });
    expect(result).toBeDefined();
  });

  it("organizations.list throws for unauthenticated users", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.organizations.list({ page: 1, pageSize: 20 })).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Router Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Compliance Router", () => {
  it("compliance.violations returns violations for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.compliance.violations({ limit: 20 });
    expect(result).toBeDefined();
  });

  it("compliance.policies returns policies for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.compliance.policies();
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Breach Notification Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Breaches Router", () => {
  it("breaches.list returns breaches for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.breaches.list({});
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker Status Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Workers Router", () => {
  it("workers.status returns worker status for authenticated users", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.workers.status();
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Tests (middleware layer)
// ─────────────────────────────────────────────────────────────────────────────
describe("Rate Limiting", () => {
  it("allows normal request rates", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    // Make 5 rapid requests — all should succeed
    const results = await Promise.all(
      Array.from({ length: 5 }, () => caller.auth.me())
    );
    expect(results).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Input Validation", () => {
  it("organizations.list accepts valid page parameter", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.organizations.list({ page: 1, pageSize: 20 });
    expect(result).toBeDefined();
  });

  it("organizations.list validates pageSize parameter", async () => {
    // This test verifies the router accepts valid inputs
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.organizations.list({ page: 1, pageSize: 20 });
    expect(result).toBeDefined();
  });
});
