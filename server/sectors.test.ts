/**
 * Sector Module Smoke Tests
 * Tests all 5 sector tRPC routers: Telecom, Healthcare, Energy, Insurance, Fintech
 */
import { describe, it, expect, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// Mock the authoritative authorization decision explicitly for isolated router behavior tests.
vi.mock("./middlewareIntegration", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  emitMutationEvent: vi.fn().mockResolvedValue(undefined),
  EVENTS: { COMPLIANCE_SCORE_UPDATED: "compliance.score.updated" },
}));

// Mock pg pool — return { count: "0" } so COUNT(*) queries don't crash
vi.mock("pg", () => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ count: "0" }], rowCount: 1 }),
      release: vi.fn(),
    }),
  };
  return { default: { Pool: vi.fn(() => mockPool) }, Pool: vi.fn(() => mockPool) };
});

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;
function ctx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1, openId: "test-admin-001", email: "admin@ndsep.gov.ng", name: "NDSEP Admin",
    loginMethod: "manus", role: "admin",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
}

// ─── Telecom ──────────────────────────────────────────────────────────────────
describe("telecom router", () => {
  it("listOperators resolves", async () => {
    const r = await appRouter.createCaller(ctx()).telecom.listOperators({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listSpectrumLicences resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).telecom.listSpectrumLicences({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listQosViolations resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).telecom.listQosViolations({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listInterconnectDisputes resolves", async () => {
    const r = await appRouter.createCaller(ctx()).telecom.listInterconnectDisputes({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listLawfulIntercepts resolves", async () => {
    const r = await appRouter.createCaller(ctx()).telecom.listLawfulIntercepts({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("getStats resolves without throwing", async () => {
    await expect(appRouter.createCaller(ctx()).telecom.getStats()).resolves.not.toThrow();
  });
});

// ─── Healthcare ───────────────────────────────────────────────────────────────
describe("healthcare router", () => {
  it("listFacilities resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).healthcare.listFacilities({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listDataChecks resolves", async () => {
    const r = await appRouter.createCaller(ctx()).healthcare.listDataChecks({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listClinicalTrials resolves", async () => {
    const r = await appRouter.createCaller(ctx()).healthcare.listClinicalTrials({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("getStats resolves without throwing", async () => {
    await expect(appRouter.createCaller(ctx()).healthcare.getStats()).resolves.not.toThrow();
  });
});

// ─── Energy ───────────────────────────────────────────────────────────────────
describe("energy router", () => {
  it("listCompanies resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).energy.listCompanies({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listLicences resolves", async () => {
    const r = await appRouter.createCaller(ctx()).energy.listLicences({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listGridEvents resolves", async () => {
    const r = await appRouter.createCaller(ctx()).energy.listGridEvents({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listOilGasReports resolves", async () => {
    const r = await appRouter.createCaller(ctx()).energy.listOilGasReports({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("getStats resolves without throwing", async () => {
    await expect(appRouter.createCaller(ctx()).energy.getStats()).resolves.not.toThrow();
  });
});

// ─── Insurance ────────────────────────────────────────────────────────────────
describe("insurance router", () => {
  it("listCompanies resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).insurance.listCompanies({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listPolicies resolves", async () => {
    const r = await appRouter.createCaller(ctx()).insurance.listPolicies({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listClaims resolves", async () => {
    const r = await appRouter.createCaller(ctx()).insurance.listClaims({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("getStats resolves without throwing", async () => {
    await expect(appRouter.createCaller(ctx()).insurance.getStats()).resolves.not.toThrow();
  });
});

// ─── Fintech ──────────────────────────────────────────────────────────────────
describe("fintech router", () => {
  it("listCompanies resolves with paginated result", async () => {
    const r = await appRouter.createCaller(ctx()).fintech.listCompanies({ page: 1 });
    expect(r).toHaveProperty("data");
    expect(Array.isArray(r.data)).toBe(true);
  });
  it("listDataEvents resolves", async () => {
    const r = await appRouter.createCaller(ctx()).fintech.listDataEvents({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("listOpenBankingConsents resolves", async () => {
    const r = await appRouter.createCaller(ctx()).fintech.listOpenBankingConsents({});
    expect(Array.isArray(r)).toBe(true);
  });
  it("getStats resolves without throwing", async () => {
    await expect(appRouter.createCaller(ctx()).fintech.getStats()).resolves.not.toThrow();
  });
  it("revokeConsent resolves without throwing", async () => {
    // Returns rows[0] which may be undefined when DB is mocked — just assert no throw
    await expect(appRouter.createCaller(ctx()).fintech.revokeConsent({ id: 1 })).resolves.not.toThrow();
  });
});
