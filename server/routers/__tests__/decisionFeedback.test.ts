/**
 * decisionFeedback router unit tests (round 12, wave 1).
 *
 * No database, no Kafka, no ledger: the shared pg pool (../../db getPool) is
 * mocked with a SQL-dispatching stub, publishWithOutbox and appendLedger are
 * mocked, and procedures are invoked via router.createCaller with a synthetic
 * authenticated context (same pattern as server/banking.test.ts).
 *
 * Covers:
 *  - record appends an outcome row, emits ndsep.feedback.recorded via
 *    publishWithOutbox, and appends to the audit ledger;
 *  - record copies the prior suggestion when none is supplied;
 *  - record rejects payloads carrying raw data-subject identifier keys
 *    (HMAC pseudonymization constraint);
 *  - record requires finalValue for action='edit';
 *  - acceptanceRate computes latest-outcome-per-prediction rates;
 *  - listRecent maps snake_case rows to camelCase;
 *  - mintPrediction inserts a baseline 'ignore' row and returns a uuid;
 *  - actorUuid is deterministic and uuid-shaped.
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

import { decisionFeedbackRouter, mintPrediction, actorUuid } from "../decisionFeedback";

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

const PID = "11111111-2222-4333-8444-555555555555";

/** Dispatch canned rows by SQL shape. */
function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO decision_feedback/i.test(sql)) {
      return { rows: [{ id: "fb-row-1", created_at: "2026-04-01T00:00:00.000Z" }] };
    }
    if (/SELECT suggestion FROM decision_feedback/i.test(sql)) {
      return { rows: [{ suggestion: { answer: "cached suggestion" } }] };
    }
    if (/AVG\(edit_distance\)/i.test(sql)) {
      return { rows: [{ avg_ed: 0.25 }] };
    }
    if (/DISTINCT ON \(prediction_id\) action/i.test(sql)) {
      return { rows: [
        { action: "accept", n: 3 },
        { action: "edit", n: 1 },
        { action: "reject", n: 1 },
        { action: "ignore", n: 5 },
      ] };
    }
    if (/SELECT COUNT\(\*\)::int AS n FROM decision_feedback/i.test(sql)) {
      return { rows: [{ n: 1 }] };
    }
    if (/SELECT id, prediction_id, surface/i.test(sql)) {
      return { rows: [{
        id: "fb-row-1",
        prediction_id: PID,
        surface: "dpiagen",
        model_version: "ollama:llama3.2",
        action: "accept",
        edit_distance: null,
        actor_id: actorUuid(42),
        suggestion: { answer: "x" },
        final_value: null,
        created_at: "2026-04-01T00:00:00.000Z",
      }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPublish.mockClear();
  mockAppendLedger.mockClear();
  installQueryStub();
});

describe("decisionFeedback.record", () => {
  it("appends an outcome row, publishes ndsep.feedback.recorded and writes the audit ledger", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    const out = await caller.record({
      predictionId: PID,
      surface: "dpiagen",
      action: "accept",
      suggestion: { answer: "dpia draft" },
    });
    expect(out.id).toBe("fb-row-1");
    expect(out.predictionId).toBe(PID);
    expect(out.action).toBe("accept");

    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert![1][0]).toBe(PID); // prediction_id param
    expect(insert![1][1]).toBe("dpiagen"); // surface param
    expect(insert![1][5]).toBe("accept"); // action param
    expect(String(insert![1][4])).toMatch(/^[0-9a-f-]{36}$/); // actor uuid

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0]).toBe("ndsep.feedback.recorded");
    expect(mockPublish.mock.calls[0][1]).toBe(PID);
    expect(mockAppendLedger).toHaveBeenCalledTimes(1);
    expect(mockAppendLedger.mock.calls[0][0]).toBe("feedback.recorded");
  });

  it("copies the prior suggestion when none is supplied", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    await caller.record({ predictionId: PID, surface: "dpiagen", action: "reject" });
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(insert).toBeDefined();
    // suggestion param ($4) is the JSON-stringified prior suggestion
    expect(JSON.parse(String(insert![1][3]))).toEqual({ answer: "cached suggestion" });
  });

  it("rejects suggestion payloads carrying raw data-subject identifier keys", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    await expect(
      caller.record({ predictionId: PID, surface: "triage", action: "accept", suggestion: { subject: { nin: "12345678901" } } }),
    ).rejects.toThrow(/raw data-subject identifier/i);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)))).toHaveLength(0);
  });

  it("requires finalValue when action is 'edit'", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    await expect(
      caller.record({ predictionId: PID, surface: "form_copilot", action: "edit", suggestion: { v: 1 } }),
    ).rejects.toThrow(/finalValue/);
  });
});

describe("decisionFeedback.acceptanceRate", () => {
  it("computes latest-outcome rates per surface/window", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    const out = await caller.acceptanceRate({ surface: "dpiagen", windowDays: 30 });
    expect(out.counts).toEqual({ accept: 3, edit: 1, reject: 1, ignore: 5 });
    expect(out.total).toBe(10);
    expect(out.acceptanceRate).toBeCloseTo(0.3);
    expect(out.decidedAcceptanceRate).toBeCloseTo(0.6);
    expect(out.avgEditDistance).toBeCloseTo(0.25);
    const q = String(mockQuery.mock.calls[0][0]);
    expect(q).toContain("DISTINCT ON (prediction_id)");
  });
});

describe("decisionFeedback.listRecent", () => {
  it("maps snake_case rows to camelCase with pagination", async () => {
    const caller = decisionFeedbackRouter.createCaller(createUserContext());
    const out = await caller.listRecent({ surface: "dpiagen", limit: 10, offset: 0 });
    expect(out.total).toBe(1);
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0];
    expect(row.predictionId).toBe(PID);
    expect(row.modelVersion).toBe("ollama:llama3.2");
    expect(row.action).toBe("accept");
    expect(row.editDistance).toBeNull();
  });
});

describe("mintPrediction", () => {
  it("inserts a baseline 'ignore' row and returns a uuid predictionId", async () => {
    const predictionId = await mintPrediction({ surface: "compliance_qa", suggestion: { answer: "a" }, actorId: 42 });
    expect(predictionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert![1][0]).toBe(predictionId);
    expect(insert![1][5]).toBe("ignore");
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("still returns a predictionId when the insert fails (best-effort)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const predictionId = await mintPrediction({ surface: "triage", suggestion: { v: 1 }, actorId: 42 });
    expect(predictionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("actorUuid", () => {
  it("is deterministic and uuid-shaped", () => {
    const a = actorUuid(42);
    expect(a).toBe(actorUuid("42"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(actorUuid(43));
  });
});
