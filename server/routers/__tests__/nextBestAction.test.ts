/**
 * Next-best-action tests (round 12, wave 7).
 *
 * The pure state machine is exercised exhaustively per entity type; the
 * router is tested with a mocked pool + mocked Wave-1 side effects to prove
 * state loading and prediction minting.
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

import { nextBestAction } from "../../services/nextBestAction";
import { nextBestActionRouter } from "../nextBestAction";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "test-officer-001",
    email: "officer@ndpc.gov.ng",
    name: "Test Officer",
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

describe("nextBestAction — complaint status machine", () => {
  it.each([
    ["received", "acknowledge"],
    ["under_review", "link_or_resolve"],
    ["linked_to_case", "resolve"],
    ["resolved", "close"],
  ] as const)("status %s -> %s", (status, action) => {
    expect(nextBestAction("complaint", { status })?.action).toBe(action);
  });

  it("acknowledged without an assignee -> assign_officer; with one -> start_review", () => {
    expect(nextBestAction("complaint", { status: "acknowledged", assigned: false })?.action).toBe("assign_officer");
    expect(nextBestAction("complaint", { status: "acknowledged", assigned: true })?.action).toBe("start_review");
  });

  it("closed complaints have no next action", () => {
    expect(nextBestAction("complaint", { status: "closed" })).toBeNull();
  });

  it("every suggestion carries label, mutationHint and rationale", () => {
    for (const status of ["received", "acknowledged", "under_review", "linked_to_case", "resolved"]) {
      const nba = nextBestAction("complaint", { status });
      expect(nba).not.toBeNull();
      expect(nba!.label.length).toBeGreaterThan(3);
      expect(nba!.mutationHint).toContain("publicComplaints.");
      expect(nba!.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe("nextBestAction — settlement lifecycle", () => {
  it.each([
    ["proposal", "await_or_counter"],
    ["counter", "decide_counter"],
    ["agreement", "submit_for_approval"],
    ["approval", "approve_or_reject"],
    ["active", "record_payment"],
    ["defaulted", "waive_or_escalate"],
  ] as const)("status %s -> %s", (status, action) => {
    expect(nextBestAction("settlement", { status })?.action).toBe(action);
  });

  it.each(["fulfilled", "void"] as const)("terminal status %s -> null", (status) => {
    expect(nextBestAction("settlement", { status })).toBeNull();
  });
});

describe("nextBestAction — publication workbench stages", () => {
  it.each([
    ["draft", "submit_redaction"],
    ["redaction", "complete_redaction"],
    ["approval", "publish"],
  ] as const)("stage %s -> %s", (status, action) => {
    expect(nextBestAction("publication", { status })?.action).toBe(action);
  });

  it("published with a pending correction -> process_correction", () => {
    expect(nextBestAction("publication", { status: "published", correctionPending: true })?.action).toBe("process_correction");
  });

  it("published without a pending correction -> null", () => {
    expect(nextBestAction("publication", { status: "published", correctionPending: false })).toBeNull();
  });
});

describe("nextBestAction — finding status machine", () => {
  it.each([
    ["open", "start_investigation"],
    ["referred", "await_enforcement"],
    ["under_investigation", "resolve_or_dismiss"],
  ] as const)("status %s -> %s", (status, action) => {
    expect(nextBestAction("finding", { status })?.action).toBe(action);
  });

  it.each(["resolved", "dismissed"] as const)("terminal status %s -> null", (status) => {
    expect(nextBestAction("finding", { status })).toBeNull();
  });
});

describe("nextBestActionRouter.forEntity", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPublish.mockClear();
    mockAppendLedger.mockClear();
  });

  it("loads complaint state, returns the action and mints the baseline", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM public_complaints WHERE id/i.test(sql)) {
        return { rows: [{ id: 7, reference_code: "CMP-2026-0007", status: "received", assigned_officer_id: null }] };
      }
      if (/INSERT INTO decision_feedback/i.test(sql)) return { rows: [{ id: "fb-1", created_at: "2026-04-01T00:00:00Z" }] };
      return { rows: [] };
    });
    const caller = nextBestActionRouter.createCaller(createUserContext());
    const out = await caller.forEntity({ entityType: "complaint", entityId: 7 });
    expect(out.action).toBe("acknowledge");
    expect(out.predictionId).toMatch(/^[0-9a-f-]{36}$/);

    const mint = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(mint).toBeDefined();
    expect(mint![1][1]).toBe("next_best_action");
    expect(mint![1][2]).toBe("rules:v1");
    expect(JSON.parse(String(mint![1][3]))).toMatchObject({ entityType: "complaint", action: "acknowledge" });
  });

  it("terminal states return action: null without minting", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM settlements WHERE id/i.test(sql)) return { rows: [{ id: 5, settlement_ref: "STL-1", status: "fulfilled" }] };
      return { rows: [] };
    });
    const caller = nextBestActionRouter.createCaller(createUserContext());
    const out = await caller.forEntity({ entityType: "settlement", entityId: 5 });
    expect(out.action).toBeNull();
    expect(out.predictionId).toBeNull();
    expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)))).toBeUndefined();
  });

  it("unknown entity id -> NOT_FOUND", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const caller = nextBestActionRouter.createCaller(createUserContext());
    await expect(caller.forEntity({ entityType: "finding", entityId: 999 })).rejects.toThrow(/not found/i);
  });
});
