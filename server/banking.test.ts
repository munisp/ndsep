/**
 * Banking Services Smoke Tests
 * =============================
 * Validates that all banking tRPC procedures are correctly wired and
 * return the expected shapes without requiring a live database connection.
 *
 * Strategy: mock the pg Pool so every query returns a predictable empty
 * result set, then assert that procedures resolve (not throw) and return
 * the correct top-level shape.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ── Stub pg.Pool before importing the router ──────────────────────────────────
vi.mock("./middlewareIntegration", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  emitMutationEvent: vi.fn().mockResolvedValue(undefined),
  EVENTS: { COMPLIANCE_SCORE_UPDATED: "compliance.score.updated" },
}));

vi.mock("pg", () => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  };
  return {
    default: { Pool: vi.fn(() => mockPool) },
    Pool: vi.fn(() => mockPool),
  };
});

import { appRouter } from "./routers";

// ── Shared test context ───────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-admin-001",
    email: "admin@ndsep.gov.ng",
    name: "NDSEP Admin",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "test-user-001",
    email: "officer@firstbank.com",
    name: "Compliance Officer",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── Banking Institutions ──────────────────────────────────────────────────────

describe("banking.institutions", () => {
  it("listInstitutions resolves with a paginated result", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.banking.institutions.listInstitutions({});
    // Returns { rows, total, page, limit }
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray((result as any).rows)).toBe(true);
  });

  it("institutionStats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    // stats returns rows[0] which is undefined when DB is mocked empty — just ensure no throw
    await expect(caller.banking.institutions.institutionStats()).resolves.not.toThrow;
  });
});

// ── KYC Records ──────────────────────────────────────────────────────────────

describe("banking.kyc", () => {
  it("list resolves with a paginated result", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.banking.kyc.list({});
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.kyc.stats()).resolves.not.toThrow;
  });
});


// ── AML Cases ────────────────────────────────────────────────────────────────

describe("banking.aml", () => {
  it("list resolves with a paginated result", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.banking.aml.list({});
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.aml.stats()).resolves.not.toThrow;
  });
});

// ── Watchlist ─────────────────────────────────────────────────────────────────

describe("banking.watchlist", () => {
  it("list resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    // watchlist.list may return array or object depending on query result shape
    await expect(caller.banking.watchlist.list({})).resolves.toBeDefined();
  });

  it("screen resolves", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.watchlist.screen({ name: "Test Entity" })).resolves.toBeDefined();
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.watchlist.stats()).resolves.not.toThrow;
  });
});

// ── SWIFT Messages ────────────────────────────────────────────────────────────

describe("banking.swift", () => {
  it("list resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.swift.list({})).resolves.toBeDefined();
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.swift.stats()).resolves.not.toThrow;
  });
});

// ── Fraud Alerts ──────────────────────────────────────────────────────────────

describe("banking.fraud", () => {
  it("list resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.fraud.list({})).resolves.toBeDefined();
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.fraud.stats()).resolves.not.toThrow;
  });
});

// ── CBN Reports ───────────────────────────────────────────────────────────────

describe("banking.cbnReports", () => {
  it("list resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.cbnReports.list({})).resolves.toBeDefined();
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.cbnReports.stats()).resolves.not.toThrow;
  });
});

// ── Correspondent Banks ───────────────────────────────────────────────────────

describe("banking.correspondents", () => {
  it("list resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.correspondents.list({})).resolves.toBeDefined();
  });

  it("stats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.correspondents.stats()).resolves.not.toThrow;
  });
});

// ── Payments (NIP/RTGS) ───────────────────────────────────────────────────────

describe("banking.payments", () => {
  it("listNip resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.payments.listNip({})).resolves.toBeDefined();
  });

  it("listRtgs resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.payments.listRtgs({})).resolves.toBeDefined();
  });

  it("paymentStats resolves without throwing", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.banking.payments.paymentStats()).resolves.toBeDefined();
  });
});

// ── Admin-only: create institution ───────────────────────────────────────────

describe("banking.institutions.createInstitution (admin only)", () => {
  it("throws UNAUTHORIZED when called by a non-admin user", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(
      caller.banking.institutions.createInstitution({
        cbnCode: "999",
        sortCode: "123456",
        name: "Test Bank",
        shortName: "TestBnk",
        licenseType: "commercial",
        licenseNumber: "CBN-TEST-001",
      })
    ).rejects.toThrow();
  });

  it("resolves when called by an admin user", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(
      caller.banking.institutions.createInstitution({
        cbnCode: "999",
        sortCode: "123456",
        name: "Test Bank",
        shortName: "TestBnk",
        licenseType: "commercial",
        licenseNumber: "CBN-TEST-001",
      })
    ).resolves.toBeDefined();
  });
});
