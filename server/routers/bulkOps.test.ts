/**
 * Bulk Ops Router Tests (round 12, wave 2)
 * =========================================
 * Verifies the new queue bulk operations against a mocked pg pool:
 * per-item guard enforcement, batch partial-failure semantics, auth gating,
 * and dual-control preservation for scan-finding suppression.
 *
 * Follows the existing pattern (banking.test.ts / sectors.test.ts): mock pg +
 * middlewareIntegration + OPA, then exercise procedures via createCaller.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// Controllable mock pool (vi.hoisted so it exists before mock factories run)
const queryMock = vi.hoisted(() => vi.fn<(q: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>>());

vi.mock("pg", () => {
  const mockPool = {
    query: (...args: any[]) => queryMock(...(args as [string, unknown[]])),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  };
  return { default: { Pool: vi.fn(() => mockPool) }, Pool: vi.fn(() => mockPool) };
});

vi.mock("../middlewareIntegration", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  emitMutationEvent: vi.fn().mockResolvedValue(undefined),
  EVENTS: { COMPLIANCE_SCORE_UPDATED: "compliance.score.updated" },
}));

vi.mock("../security/opa", () => ({
  requireOpaDecision: vi.fn().mockResolvedValue(undefined),
  buildOpaInput: vi.fn(() => ({})),
}));

import { getDb } from "../db";
import { bulkOpsRouter } from "./bulkOps";

beforeAll(async () => {
  await getDb(); // initialise the mocked pool so getPool() is non-null
});

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── Contexts ────────────────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(role: string, id = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id,
    openId: `test-${role}-${id}`,
    email: `${role}@ndsep.gov.ng`,
    name: `Test ${role}`,
    loginMethod: "manus",
    role: role as AuthenticatedUser["role"],
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

const adminCtx = () => makeCtx("admin");
const staffCtx = () => makeCtx("government_staff", 7);
const userCtx = () => makeCtx("user", 9);

/** Route mock responses by SQL fragment. */
function route(routes: Array<[string, any[] | ((q: string, p: any[]) => any[])]>) {
  queryMock.mockImplementation(async (q: string, p: any[] = []) => {
    for (const [frag, rows] of routes) {
      if (q.includes(frag)) {
        return { rows: typeof rows === "function" ? rows(q, p) : rows, rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  });
}

// ─── searchOfficers / searchCases ────────────────────────────────────────────
describe("bulkOps picker searches", () => {
  it("searchOfficers queries active staff users with the search term", async () => {
    route([["FROM users", [{ id: 3, name: "Ada Obi", email: "ada@ndsep.gov.ng", role: "government_staff" }]]]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).searchOfficers({ query: "ada" });
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Ada Obi");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("role IN ('admin', 'government_staff', 'auditor', 'regulator')");
    expect(params[0]).toBe("ada");
  });

  it("searchCases is denied for plain users", async () => {
    await expect(bulkOpsRouter.createCaller(userCtx()).searchCases({ query: "NDP" }))
      .rejects.toThrowError(/Staff access required/);
  });

  it("searchCases searches case reference and organisation", async () => {
    route([["FROM enforcement_cases", [{ id: 11, case_reference: "NDSEP-CASE-000011", status: "open", organization_name: "First Bank" }]]]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).searchCases({ query: "000011" });
    expect(res[0].case_reference).toBe("NDSEP-CASE-000011");
  });
});

// ─── bulkAssignComplaints ────────────────────────────────────────────────────
describe("bulkOps.bulkAssignComplaints", () => {
  it("assigns all found complaints and records per-item events", async () => {
    route([
      ["SELECT id, name FROM users", [{ id: 5, name: "Officer Five" }]],
      ["UPDATE public_complaints", [{ id: 1 }]],
      ["INSERT INTO complaint_events", []],
      ["INSERT INTO bulk_operations", []],
      ["UPDATE bulk_operations", []],
      ["INSERT INTO audit_logs", []],
    ]);
    const res = await bulkOpsRouter.createCaller(adminCtx()).bulkAssignComplaints({ complaintIds: [1, 2], officerId: 5 });
    expect(res.total).toBe(2);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toEqual([]);
    // officer param is $1 of each complaint UPDATE
    const updates = queryMock.mock.calls.filter(([q]) => q.includes("UPDATE public_complaints"));
    expect(updates).toHaveLength(2);
    expect(updates[0][1]![0]).toBe(5);
  });

  it("rejects when the officer does not exist", async () => {
    route([["SELECT id, name FROM users", []]]);
    await expect(bulkOpsRouter.createCaller(adminCtx()).bulkAssignComplaints({ complaintIds: [1], officerId: 999 }))
      .rejects.toThrowError(/Officer user not found/);
  });

  it("records per-item failures without failing the batch", async () => {
    route([
      ["SELECT id, name FROM users", [{ id: 5, name: "Officer Five" }]],
      // id 1 updates fine, id 2 matches no row (deleted between check & write)
      ["UPDATE public_complaints", (q, p) => (p[1] === 1 ? [{ id: 1 }] : [])],
    ]);
    const res = await bulkOpsRouter.createCaller(adminCtx()).bulkAssignComplaints({ complaintIds: [1, 2], officerId: 5 });
    expect(res.succeeded).toBe(1);
    expect(res.failed).toEqual([{ id: 2, reason: "Complaint not found" }]);
  });

  it("requires admin role", async () => {
    await expect(bulkOpsRouter.createCaller(staffCtx()).bulkAssignComplaints({ complaintIds: [1], officerId: 5 }))
      .rejects.toThrowError();
  });
});

// ─── bulkSetComplaintStatus ──────────────────────────────────────────────────
describe("bulkOps.bulkSetComplaintStatus", () => {
  it("moves valid transitions and skips invalid ones per item", async () => {
    route([
      // id 1: received → acknowledged (valid); id 2: received → resolved (invalid)
      ["SELECT id, status, enforcement_case_id, merged_into_id FROM public_complaints", (q, p) =>
        p[0] === 1
          ? [{ id: 1, status: "received", enforcement_case_id: null, merged_into_id: null }]
          : [{ id: 2, status: "received", enforcement_case_id: null, merged_into_id: null }]],
      ["UPDATE public_complaints", [{ id: 1 }]],
    ]);
    const caller = bulkOpsRouter.createCaller(adminCtx());
    const ok = await caller.bulkSetComplaintStatus({ complaintIds: [1], status: "acknowledged" });
    expect(ok.succeeded).toBe(1);

    const bad = await caller.bulkSetComplaintStatus({ complaintIds: [2], status: "resolved" });
    expect(bad.succeeded).toBe(0);
    expect(bad.failed[0].reason).toMatch(/Invalid transition received → resolved/);
  });

  it("refuses linked_to_case without a linked enforcement case", async () => {
    route([
      ["SELECT id, status, enforcement_case_id, merged_into_id FROM public_complaints",
        [{ id: 1, status: "under_review", enforcement_case_id: null, merged_into_id: null }]],
    ]);
    const res = await bulkOpsRouter.createCaller(adminCtx()).bulkSetComplaintStatus({ complaintIds: [1], status: "linked_to_case" });
    expect(res.succeeded).toBe(0);
    expect(res.failed[0].reason).toMatch(/Link an enforcement case/);
  });

  it("skips merged duplicates", async () => {
    route([
      ["SELECT id, status, enforcement_case_id, merged_into_id FROM public_complaints",
        [{ id: 4, status: "closed", enforcement_case_id: null, merged_into_id: 9 }]],
    ]);
    const res = await bulkOpsRouter.createCaller(adminCtx()).bulkSetComplaintStatus({ complaintIds: [4], status: "acknowledged" });
    expect(res.failed[0].reason).toMatch(/Merged duplicate/);
  });
});

// ─── bulkSetFindingStatus ────────────────────────────────────────────────────
describe("bulkOps.bulkSetFindingStatus", () => {
  it("applies the same closed-state guard as the single-item procedure", async () => {
    // The guarded UPDATE returns a row only when the finding was in a
    // transitionable state — closed findings return nothing.
    route([["UPDATE scan_findings", (q, p) => (p[0] === 1 ? [{ id: 1 }] : [])]]);
    const res = await bulkOpsRouter.createCaller(adminCtx()).bulkSetFindingStatus({ findingIds: [1, 2], status: "resolved" });
    expect(res.succeeded).toBe(1);
    expect(res.failed).toEqual([{ id: 2, reason: "Finding not found or already closed" }]);
    const [sql] = queryMock.mock.calls.find(([q]) => q.includes("UPDATE scan_findings"))!;
    expect(sql).toContain("status IN ('open', 'acknowledged')");
    expect(sql).toContain("status = 'referred' AND $2 = 'resolved'");
  });
});

// ─── bulkSuppressFindings (dual control) ─────────────────────────────────────
describe("bulkOps.bulkSuppressFindings", () => {
  it("creates PENDING suppression requests only — never flips findings to suppressed", async () => {
    route([
      ["SELECT id, status FROM scan_findings", [{ id: 1, status: "open" }]],
      ["SELECT id FROM scan_suppressions", []],
      ["INSERT INTO scan_suppressions", []],
    ]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkSuppressFindings({
      findingIds: [1],
      reason: "Tracker signature is a known false positive on gov.ng sites",
    });
    expect(res.succeeded).toBe(1);
    const insert = queryMock.mock.calls.find(([q]) => q.includes("INSERT INTO scan_suppressions"));
    expect(insert).toBeDefined();
    expect(insert![0]).toContain("scope, finding_id, reason, requested_by");
    // No direct status mutation must have been issued
    expect(queryMock.mock.calls.some(([q]) => q.includes("UPDATE scan_findings"))).toBe(false);
  });

  it("skips findings that already have a pending request", async () => {
    route([
      ["SELECT id, status FROM scan_findings", [{ id: 1, status: "open" }]],
      ["SELECT id FROM scan_suppressions", [{ id: 42 }]],
    ]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkSuppressFindings({
      findingIds: [1],
      reason: "Tracker signature is a known false positive on gov.ng sites",
    });
    expect(res.succeeded).toBe(0);
    expect(res.failed[0].reason).toMatch(/already exists/);
  });

  it("rejects non-open findings", async () => {
    route([["SELECT id, status FROM scan_findings", [{ id: 1, status: "resolved" }]]]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkSuppressFindings({
      findingIds: [1],
      reason: "Tracker signature is a known false positive on gov.ng sites",
    });
    expect(res.failed[0].reason).toMatch(/only open\/acknowledged/);
  });
});

// ─── bulkConfirmAdverseMedia / bulkRejectAdverseMedia ────────────────────────
describe("bulkOps adverse media", () => {
  it("confirms pending items and promotes confirmed matches to signals", async () => {
    route([
      ["UPDATE adverse_media_items", [{ id: 1, severity: "high", title: "Bank fined", summary: null }]],
      ["FROM adverse_media_entity_matches WHERE item_id", [{ id: 7, item_id: 1, organization_id: 21, status: "confirmed" }]],
      ["INSERT INTO supervision_risk_signals", [{ id: 100 }]],
    ]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkConfirmAdverseMedia({ itemIds: [1] });
    expect(res.succeeded).toBe(1);
    expect(res.signals_promoted).toBe(1);
    const signalInsert = queryMock.mock.calls.find(([q]) => q.includes("INSERT INTO supervision_risk_signals"));
    expect(signalInsert![1]).toContain(21);
  });

  it("confirms only pending items — already-reviewed items are skipped", async () => {
    route([["UPDATE adverse_media_items", []]]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkConfirmAdverseMedia({ itemIds: [1] });
    expect(res.failed).toEqual([{ id: 1, reason: "Item not found or already reviewed" }]);
  });

  it("bulk reject requires a note (min 3 chars)", async () => {
    await expect(
      bulkOpsRouter.createCaller(staffCtx()).bulkRejectAdverseMedia({ itemIds: [1], note: "no" }),
    ).rejects.toThrowError();
  });

  it("rejects pending items with the shared note", async () => {
    route([["UPDATE adverse_media_items", [{ id: 1 }]]]);
    const res = await bulkOpsRouter.createCaller(staffCtx()).bulkRejectAdverseMedia({ itemIds: [1], note: "Unrelated entity" });
    expect(res.succeeded).toBe(1);
    const upd = queryMock.mock.calls.find(([q]) => q.includes("UPDATE adverse_media_items"));
    expect(upd![1]).toContain("Unrelated entity");
  });

  it("adverse media bulk review is denied for plain users", async () => {
    await expect(bulkOpsRouter.createCaller(userCtx()).bulkConfirmAdverseMedia({ itemIds: [1] }))
      .rejects.toThrowError(/Staff access required/);
  });
});
