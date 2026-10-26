/**
 * Autonomy governance tests (round 12, wave 9).
 *
 * No DB / no Kafka / no ledger: the shared pg pool is mocked with a
 * SQL-dispatching stub, publishWithOutbox + appendLedger are mocked, and
 * Permify/OPA are stubbed for adminProcedure (bulkOps.test.ts pattern).
 *
 * Covers:
 *  - tier gate math: promote 1→2 (≥85% over ≥500), 2→3 (≥95% over ≥2000 +
 *    30d stable), regression demotion (<70% over trailing 200), tier clamping;
 *  - fail-closed: any evaluation error → tier 1 (+ best-effort tier-1 write);
 *  - duplicate detection: controller normalization, 14-day window, subject
 *    similarity threshold, canonical selection;
 *  - confirm-rate math for false-finding suppression (<5% gate);
 *  - undo-window lifecycle: execute only after deadline, concurrent-state
 *    expiry, undo of pending (cancel) and executed (snapshot restore) actions;
 *  - dual-control enforcement on manual tier overrides (queue → approve →
 *    consume; unapproved request rejected; demote at tier 1 rejected).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../../_core/context";

const mockQuery = vi.fn();
const mockPublish = vi.fn().mockResolvedValue(true);
const mockAppendLedger = vi.fn().mockResolvedValue({});

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
}));
vi.mock("../../kafka", () => ({
  publishWithOutbox: (...args: unknown[]) => mockPublish(...args),
}));
vi.mock("../../antiwipe/ledger", () => ({
  appendLedger: (...args: unknown[]) => mockAppendLedger(...args),
}));
vi.mock("../../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../middlewareIntegration", () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  emitMutationEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../security/opa", () => ({
  requireOpaDecision: vi.fn().mockResolvedValue(undefined),
  buildOpaInput: vi.fn(() => ({})),
}));

import {
  decideTransition,
  evaluate,
  TIER_GATES,
  MIN_TIER,
} from "../../services/autonomyTiers";
import {
  normalizeControllerName,
  trigramSimilarity,
  ilikeShortlist,
  isDuplicatePair,
  findDuplicatePairs,
  MERGE_PROPOSAL_ACTION,
  type ComplaintLite,
} from "../../services/duplicateMerge";
import {
  confirmRateFromStatuses,
  confirmRateFromFeedback,
  isEligibleForAutoSuppress,
  CONFIRM_RATE_THRESHOLD,
} from "../../services/falseFindingSuppressor";
import {
  createAutonomyAction,
  executeDueAutonomyActions,
  undoAutonomyAction,
} from "../../services/autonomyActions";
import { autonomyGovernanceRouter } from "../autonomyGovernance";

// ─── Contexts ────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(role: string, id = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id,
    openId: `test-${role}-${id}`,
    email: `${role}@ndsep.gov.ng`,
    name: `Test ${role}`,
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Query stub plumbing ─────────────────────────────────────────────────────

let issuedQueries: string[] = [];

function installQueryStub(handler: (sql: string, params: unknown[]) => { rows: any[] }) {
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    issuedQueries.push(sql);
    return handler(sql, params);
  });
}

const EMPTY = { rows: [] };

beforeEach(() => {
  mockQuery.mockReset();
  mockPublish.mockClear();
  mockAppendLedger.mockClear();
  issuedQueries = [];
  mockQuery.mockResolvedValue(EMPTY);
});

// ─── Tier gate math ──────────────────────────────────────────────────────────

function stats(decided: number, acceptance: number | null, trailing: { count: number; acceptance: number | null } = { count: 0, acceptance: null }) {
  return { decided, acceptance, trailing: { ...trailing, window: 200 } };
}

describe("tier gate math", () => {
  it("promotes 1→2 at exactly 85% over exactly 500 decided", () => {
    const t = decideTransition({ tier: 1, promotedAt: null }, stats(500, 0.85));
    expect(t).toMatchObject({ action: "promote", toTier: 2 });
  });

  it("does not promote at 84.9% or at 499 decided", () => {
    expect(decideTransition({ tier: 1, promotedAt: null }, stats(500, 0.849)).action).toBe("none");
    expect(decideTransition({ tier: 1, promotedAt: null }, stats(499, 0.99)).action).toBe("none");
    expect(decideTransition({ tier: 1, promotedAt: null }, stats(600, null)).action).toBe("none");
  });

  it("promotes 2→3 at 95% over 2000 with 30 days stable in tier 2", () => {
    const promotedAt = new Date(Date.now() - 31 * 86_400_000);
    const t = decideTransition({ tier: 2, promotedAt }, stats(2000, 0.95));
    expect(t).toMatchObject({ action: "promote", toTier: 3 });
  });

  it("withholds 2→3 without the 30-day stability window", () => {
    const promotedAt = new Date(Date.now() - 10 * 86_400_000);
    expect(decideTransition({ tier: 2, promotedAt }, stats(3000, 0.99)).action).toBe("none");
    expect(decideTransition({ tier: 2, promotedAt: null }, stats(3000, 0.99)).action).toBe("none");
  });

  it("demotes on regression (<70% over a FULL trailing-200 window)", () => {
    const t2 = decideTransition({ tier: 2, promotedAt: null }, stats(100, 0.9, { count: 200, acceptance: 0.69 }));
    expect(t2).toMatchObject({ action: "demote", toTier: 1 });
    const t3 = decideTransition({ tier: 3, promotedAt: null }, stats(100, 0.9, { count: 200, acceptance: 0.5 }));
    expect(t3).toMatchObject({ action: "demote", toTier: 2 });
  });

  it("does not demote on a partial trailing window, at exactly 70%, or from tier 1", () => {
    expect(decideTransition({ tier: 2, promotedAt: null }, stats(100, 0.9, { count: 199, acceptance: 0.1 })).action).toBe("none");
    expect(decideTransition({ tier: 2, promotedAt: null }, stats(100, 0.9, { count: 200, acceptance: 0.7 })).action).toBe("none");
    expect(decideTransition({ tier: 1, promotedAt: null }, stats(100, 0.1, { count: 200, acceptance: 0.1 })).action).toBe("none");
  });

  it("regression beats an otherwise-met promotion gate", () => {
    const promotedAt = new Date(Date.now() - 40 * 86_400_000);
    const t = decideTransition({ tier: 2, promotedAt }, stats(3000, 0.99, { count: 200, acceptance: 0.2 }));
    expect(t).toMatchObject({ action: "demote", toTier: 1 });
  });

  it("clamps invalid stored tiers to the 1..3 band", () => {
    expect(decideTransition({ tier: 0, promotedAt: null }, stats(0, null)).toTier).toBe(MIN_TIER);
    expect(decideTransition({ tier: 99, promotedAt: null }, stats(0, null)).toTier).toBe(3);
  });

  it("exports the documented gate constants", () => {
    expect(TIER_GATES.windowDays).toBe(90);
    expect(TIER_GATES.promote["1->2"]).toEqual({ minAcceptance: 0.85, minSuggestions: 500 });
    expect(TIER_GATES.promote["2->3"].minStableDays).toBe(30);
    expect(TIER_GATES.demote).toEqual({ trailingCount: 200, belowAcceptance: 0.7 });
  });
});

describe("evaluate fail-closed", () => {
  it("returns tier 1 and attempts a tier-1 write when the DB errors", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      issuedQueries.push(sql);
      throw new Error("connection refused");
    });
    const res = await evaluate("duplicate_merge");
    expect(res.tier).toBe(1);
    expect(res.failedClosed).toBe(true);
    expect(issuedQueries.some((q) => /INSERT INTO autonomy_tiers/i.test(q))).toBe(true);
  });

  it("commit=false performs no writes", async () => {
    installQueryStub((sql) => {
      if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return { rows: [{ surface: "duplicate_merge", tier: 1, acceptance_rate: null, suggestion_count: null, promoted_at: null, demoted_at: null, updated_at: "" }] };
      return EMPTY;
    });
    const res = await evaluate("duplicate_merge", { commit: false });
    expect(res.tier).toBe(1);
    expect(issuedQueries.some((q) => /INSERT INTO autonomy_tiers/i.test(q))).toBe(false);
  });
});

// ─── Duplicate detection ─────────────────────────────────────────────────────

function complaint(over: Partial<ComplaintLite>): ComplaintLite {
  return {
    id: 1,
    reference_code: "NDPC-CMP-2026-000001",
    controller_name: "Acme Data Systems Ltd",
    category: "consent",
    subject: "Acme sold my personal data to advertisers without consent",
    received_at: "2026-04-01T00:00:00Z",
    ...over,
  };
}

describe("duplicate detection", () => {
  it("normalizes controller names (case, punctuation, legal suffixes)", () => {
    expect(normalizeControllerName("Acme Data Systems Ltd.")).toBe("acme data systems");
    expect(normalizeControllerName("ACME  DATA-SYSTEMS, LIMITED")).toBe("acme data systems");
    expect(normalizeControllerName("Globacom NG")).toBe("globacom");
    expect(normalizeControllerName("")).toBe("");
    expect(normalizeControllerName(null)).toBe("");
  });

  it("trigram similarity: identical = 1, unrelated ≈ 0", () => {
    expect(trigramSimilarity("sold my data", "sold my data")).toBe(1);
    expect(trigramSimilarity("sold my data to advertisers", "completely unrelated topic entirely")).toBeLessThan(0.2);
  });

  it("ilike shortlist: containment or shared long token", () => {
    expect(ilikeShortlist("acme sold my data", "acme sold my data to advertisers")).toBe(true);
    expect(ilikeShortlist("unrelated", "nothing alike")).toBe(false);
  });

  it("matches same controller + category within 14 days with similar subjects", () => {
    const a = complaint({ id: 1, received_at: "2026-04-01T00:00:00Z" });
    const b = complaint({ id: 2, received_at: "2026-04-10T00:00:00Z", subject: "Acme sold my personal data to advertisers without my consent" });
    expect(isDuplicatePair(a, b).match).toBe(true);
  });

  it("rejects category mismatch, >14 day gap, and different controllers", () => {
    const a = complaint({ id: 1, received_at: "2026-04-01T00:00:00Z" });
    expect(isDuplicatePair(a, complaint({ id: 2, category: "breach", received_at: "2026-04-02T00:00:00Z" })).match).toBe(false);
    expect(isDuplicatePair(a, complaint({ id: 2, received_at: "2026-04-20T00:00:00Z" })).match).toBe(false);
    expect(isDuplicatePair(a, complaint({ id: 2, controller_name: "Other Corp", received_at: "2026-04-02T00:00:00Z" })).match).toBe(false);
    expect(isDuplicatePair(a, complaint({ id: 2, received_at: "2026-04-02T00:00:00Z", subject: "totally different matter about billing" })).match).toBe(false);
  });

  it("findDuplicatePairs picks the earliest complaint as canonical", () => {
    const rows = [
      complaint({ id: 9, received_at: "2026-04-05T00:00:00Z" }),
      complaint({ id: 3, received_at: "2026-04-02T00:00:00Z", subject: "Acme sold my personal data to advertisers without consent!" }),
    ];
    const pairs = findDuplicatePairs(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].canonical.id).toBe(3);
    expect(pairs[0].duplicate.id).toBe(9);
  });

  it("each complaint appears in at most one pair per sweep", () => {
    const rows = [1, 2, 3].map((id) =>
      complaint({ id, received_at: `2026-04-0${id}T00:00:00Z`, subject: "Acme sold my personal data to advertisers without consent" }),
    );
    const pairs = findDuplicatePairs(rows);
    const ids = pairs.flatMap((p) => [p.canonical.id, p.duplicate.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── False-finding confirm-rate math ─────────────────────────────────────────

describe("false-finding confirm rate", () => {
  it("computes confirm-rate from status history; open carries no signal", () => {
    expect(confirmRateFromStatuses(["dismissed", "dismissed", "dismissed", "dismissed", "acknowledged"])).toBeCloseTo(0.2);
    expect(confirmRateFromStatuses(["open", "open"])).toBeNull();
    expect(confirmRateFromStatuses([])).toBeNull();
  });

  it("computes confirm-rate from feedback outcomes; ignores are undecided", () => {
    expect(confirmRateFromFeedback(["accept", "reject", "reject", "ignore"])).toBeCloseTo(1 / 3);
    expect(confirmRateFromFeedback(["ignore"])).toBeNull();
  });

  it("eligibility gate: strictly below 5% with decided history", () => {
    expect(isEligibleForAutoSuppress(0.049)).toBe(true);
    expect(isEligibleForAutoSuppress(CONFIRM_RATE_THRESHOLD)).toBe(false);
    expect(isEligibleForAutoSuppress(0.5)).toBe(false);
    expect(isEligibleForAutoSuppress(null)).toBe(false);
  });
});

// ─── Undo-window lifecycle ───────────────────────────────────────────────────

const MERGE_ACTION_ROW = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  surface: "duplicate_merge",
  action_type: MERGE_PROPOSAL_ACTION,
  payload: {
    kind: MERGE_PROPOSAL_ACTION,
    canonical_id: 1,
    duplicate_id: 2,
    reason: "near-duplicate",
    snapshot: { duplicate: { id: 2, status: "under_review", merged_into_id: null, closed_at: null } },
  },
  undo_deadline: new Date(Date.now() - 1000).toISOString(), // already due
  status: "pending_undo",
  executed_at: null,
  undone_by: null,
  created_at: new Date().toISOString(),
};

function mergeExecutionStub(duplicateOverrides: Record<string, unknown> = {}) {
  return (sql: string) => {
    if (/FROM autonomy_actions[\s\S]*undo_deadline <= now\(\)/i.test(sql)) return { rows: [MERGE_ACTION_ROW] };
    if (/FROM public_complaints WHERE id = \$1/i.test(sql)) {
      // canonical first (Promise.all order), then duplicate
      return { rows: [{ id: 1, reference_code: "R1", status: "under_review", merged_into_id: null }] };
    }
    if (/UPDATE public_complaints[\s\S]*RETURNING id/i.test(sql)) return { rows: [{ id: 2 }] };
    if (/UPDATE autonomy_actions SET status = 'executed'/i.test(sql)) return { rows: [{ id: MERGE_ACTION_ROW.id }] };
    return EMPTY;
  };
}

describe("undo-window lifecycle", () => {
  it("parks a proposal with a 24h undo deadline and ledgers it", async () => {
    installQueryStub((sql) => {
      if (/INSERT INTO autonomy_actions/i.test(sql)) return { rows: [MERGE_ACTION_ROW] };
      return EMPTY;
    });
    const row = await createAutonomyAction({ surface: "duplicate_merge", actionType: MERGE_PROPOSAL_ACTION, payload: { kind: "x" } });
    expect(row.status).toBe("pending_undo");
    const insert = issuedQueries.find((q) => /INSERT INTO autonomy_actions/i.test(q));
    expect(insert).toMatch(/make_interval\(hours =>/);
    expect(mockAppendLedger).toHaveBeenCalledWith("autonomy.action_proposed", expect.objectContaining({ actionId: row.id }), "autonomy-engine");
  });

  it("does not execute proposals whose deadline has not passed", async () => {
    installQueryStub(() => EMPTY); // due-query returns nothing
    const res = await executeDueAutonomyActions();
    expect(res.executed).toBe(0);
    expect(issuedQueries.some((q) => /UPDATE public_complaints/i.test(q))).toBe(false);
  });

  it("executes a due merge proposal and marks it executed", async () => {
    installQueryStub(mergeExecutionStub());
    const res = await executeDueAutonomyActions();
    expect(res.executed).toBe(1);
    expect(issuedQueries.some((q) => /SET merged_into_id/i.test(q))).toBe(true);
    expect(issuedQueries.some((q) => /UPDATE complaint_attachments/i.test(q))).toBe(true);
    expect(mockAppendLedger).toHaveBeenCalledWith("autonomy.action_executed", expect.objectContaining({ actionId: MERGE_ACTION_ROW.id }), "autonomy-engine");
  });

  it("expires (fails closed) when the duplicate was already merged by a human", async () => {
    installQueryStub((sql) => {
      if (/FROM autonomy_actions[\s\S]*undo_deadline <= now\(\)/i.test(sql)) return { rows: [MERGE_ACTION_ROW] };
      if (/FROM public_complaints WHERE id = \$1/i.test(sql)) {
        return { rows: [{ id: 2, reference_code: "R2", status: "closed", merged_into_id: 7 }] };
      }
      return EMPTY;
    });
    const res = await executeDueAutonomyActions();
    expect(res.failed).toBe(1);
    expect(res.executed).toBe(0);
    expect(issuedQueries.some((q) => /UPDATE autonomy_actions SET status = 'expired'/i.test(q))).toBe(true);
  });

  it("undo of a pending proposal cancels it WITHOUT touching complaints", async () => {
    installQueryStub((sql) => {
      if (/SELECT \* FROM autonomy_actions WHERE id/i.test(sql)) return { rows: [MERGE_ACTION_ROW] };
      if (/UPDATE autonomy_actions SET status = 'undone'/i.test(sql)) return { rows: [{ ...MERGE_ACTION_ROW, status: "undone", undone_by: "1" }] };
      return EMPTY;
    });
    const row = await undoAutonomyAction(MERGE_ACTION_ROW.id, "1");
    expect(row.status).toBe("undone");
    expect(issuedQueries.some((q) => /UPDATE public_complaints/i.test(q))).toBe(false);
    expect(mockAppendLedger).toHaveBeenCalledWith("autonomy.action_undone", expect.objectContaining({ actionId: MERGE_ACTION_ROW.id, wasExecuted: false }), "1");
  });

  it("undo of an executed merge restores the snapshot state", async () => {
    const executedRow = { ...MERGE_ACTION_ROW, status: "executed", executed_at: new Date().toISOString() };
    installQueryStub((sql) => {
      if (/SELECT \* FROM autonomy_actions WHERE id/i.test(sql)) return { rows: [executedRow] };
      if (/UPDATE public_complaints[\s\S]*RETURNING id/i.test(sql)) return { rows: [{ id: 2 }] };
      if (/UPDATE autonomy_actions SET status = 'undone'/i.test(sql)) return { rows: [{ ...executedRow, status: "undone", undone_by: "1" }] };
      return EMPTY;
    });
    const row = await undoAutonomyAction(MERGE_ACTION_ROW.id, "1");
    expect(row.status).toBe("undone");
    const restore = issuedQueries.find((q) => /SET merged_into_id = NULL/i.test(q));
    expect(restore).toBeDefined();
    expect(restore).toMatch(/status = \$2/); // snapshot status ('under_review') restored via param
  });

  it("refuses to undo a terminal action", async () => {
    installQueryStub((sql) => {
      if (/SELECT \* FROM autonomy_actions WHERE id/i.test(sql)) return { rows: [{ ...MERGE_ACTION_ROW, status: "expired" }] };
      return EMPTY;
    });
    await expect(undoAutonomyAction(MERGE_ACTION_ROW.id, "1")).rejects.toThrow(/expired/);
  });
});

// ─── Dual-control enforcement on manual tier overrides ───────────────────────

const TIER_CHANGE_REQUEST = {
  id: 77,
  action_type: "autonomy_tier_change",
  payload: { kind: "autonomy_tier_change", surface: "duplicate_merge", target_tier: 2, reason: "sustained high acceptance" },
  requested_by: "99",
  first_approver: "5",
  second_approver: "6",
  status: "approved",
  expires_at: new Date(Date.now() + 3600e3).toISOString(),
};

function tierPreviewStub(tierRow: any | null) {
  return (sql: string) => {
    if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return { rows: tierRow ? [tierRow] : [] };
    return EMPTY;
  };
}

describe("dual-control enforcement on tier overrides", () => {
  it("promote without a requestId QUEUES a dual-control request and writes no tier change", async () => {
    installQueryStub((sql) => {
      if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return EMPTY;
      if (/FROM dual_control_requests/i.test(sql) && /SELECT id/i.test(sql)) return EMPTY;
      if (/INSERT INTO dual_control_requests/i.test(sql)) return { rows: [{ id: 321 }] };
      return EMPTY;
    });
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("admin"));
    const res = await caller.promote({ surface: "duplicate_merge", reason: "sustained acceptance above gate" });
    expect(res).toMatchObject({ queued: true, requestId: 321, status: "pending" });
    expect(issuedQueries.some((q) => /INSERT INTO dual_control_requests/i.test(q))).toBe(true);
    expect(issuedQueries.some((q) => /INSERT INTO autonomy_tiers/i.test(q))).toBe(false);
  });

  it("promote with a PENDING requestId is rejected (two distinct approvers required)", async () => {
    installQueryStub((sql) => {
      if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return EMPTY;
      if (/FROM dual_control_requests WHERE id/i.test(sql)) return { rows: [{ ...TIER_CHANGE_REQUEST, status: "pending", first_approver: "5", second_approver: null }] };
      return EMPTY;
    });
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("admin"));
    await expect(
      caller.promote({ surface: "duplicate_merge", reason: "sustained acceptance above gate", dualControlRequestId: 77 }),
    ).rejects.toThrow(/approved request/);
    expect(issuedQueries.some((q) => /INSERT INTO autonomy_tiers/i.test(q))).toBe(false);
  });

  it("promote with an APPROVED requestId consumes the request and applies the tier change", async () => {
    const tierRow = { surface: "duplicate_merge", tier: 1, acceptance_rate: null, suggestion_count: null, promoted_at: null, demoted_at: null, updated_at: "" };
    installQueryStub((sql) => {
      if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return { rows: [tierRow] };
      if (/FROM dual_control_requests WHERE id/i.test(sql)) return { rows: [TIER_CHANGE_REQUEST] };
      if (/UPDATE dual_control_requests SET status = 'consumed'/i.test(sql)) return { rows: [{ id: 77 }] };
      return EMPTY;
    });
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("admin"));
    const res = await caller.promote({ surface: "duplicate_merge", reason: "sustained acceptance above gate", dualControlRequestId: 77 });
    expect(res).toMatchObject({ queued: false, applied: true, dualControlRequestId: 77, firstApprover: "5", secondApprover: "6" });
    expect(issuedQueries.some((q) => /INSERT INTO autonomy_tiers/i.test(q))).toBe(true);
    expect(issuedQueries.some((q) => /status = 'consumed'/i.test(q))).toBe(true);
    expect(mockAppendLedger).toHaveBeenCalledWith("autonomy.tier_override", expect.objectContaining({ surface: "duplicate_merge", toTier: 2, dualControlRequestId: 77 }), "1");
  });

  it("demote at tier 1 is rejected before any dual-control write", async () => {
    installQueryStub(tierPreviewStub(null));
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("admin"));
    await expect(
      caller.demote({ surface: "duplicate_merge", reason: "already at the floor" }),
    ).rejects.toThrow(/already at tier 1/);
    expect(issuedQueries.some((q) => /dual_control_requests/i.test(q))).toBe(false);
  });

  it("a requestId referring to a different surface/tier is rejected", async () => {
    installQueryStub((sql) => {
      if (/FROM autonomy_tiers WHERE surface/i.test(sql)) return EMPTY;
      if (/FROM dual_control_requests WHERE id/i.test(sql)) {
        return { rows: [{ ...TIER_CHANGE_REQUEST, payload: { ...TIER_CHANGE_REQUEST.payload, target_tier: 3 } }] };
      }
      return EMPTY;
    });
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("admin"));
    await expect(
      caller.promote({ surface: "duplicate_merge", reason: "sustained acceptance above gate", dualControlRequestId: 77 }),
    ).rejects.toThrow(/does not refer/);
  });

  it("non-admin users cannot request tier overrides", async () => {
    installQueryStub(() => EMPTY);
    const caller = autonomyGovernanceRouter.createCaller(makeCtx("user"));
    await expect(
      caller.promote({ surface: "duplicate_merge", reason: "sustained acceptance above gate" }),
    ).rejects.toThrow();
  });
});
