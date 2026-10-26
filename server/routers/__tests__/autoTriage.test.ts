/**
 * Auto-triage tests (round 12, wave 7).
 *
 * No DB / no Kafka / no ledger: the shared pg pool is mocked with a
 * SQL-dispatching stub, publishWithOutbox + appendLedger are mocked (they
 * back the Wave-1 decisionFeedback loop), and the LLM gateway fetch is
 * swapped via services/llmGateway.setLlmFetch.
 *
 * Covers:
 *  - threshold gating: below AUTO_TRIAGE_CONFIDENCE -> manual_queue, no
 *    triage_suggestions insert; at/above -> pending row + minted baseline;
 *  - fail-closed: gateway network error / timeout / unusable output all
 *    leave the complaint in the manual queue;
 *  - env override of the threshold;
 *  - decide flow: pending -> accepted/edited/rejected updates the row AND
 *    appends the decision_feedback outcome via autoTriageRouter.decide.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { suggestTriage, decideTriage, autoTriageConfidenceThreshold } from "../../services/autoTriage";
import { setLlmFetch, type FetchLike } from "../../services/llmGateway";
import { autoTriageRouter } from "../autoTriage";
import { LlmGatewayError } from "../../services/llmGateway";

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

const COMPLAINT_ROW = {
  id: 7,
  reference_code: "CMP-2026-0007",
  subject: "My data was sold",
  description: "The controller sold my personal data to advertisers without consent.",
  category: null,
  status: "received",
};

function goodClassification(confidence: number) {
  return { category: "consent", severity: "high", team: "investigations", confidence, model_version: "ollama:test-v1" };
}

function fetchReturning(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM public_complaints WHERE id/i.test(sql)) return { rows: [COMPLAINT_ROW] };
    if (/INSERT INTO decision_feedback/i.test(sql)) return { rows: [{ id: "fb-1", created_at: "2026-04-01T00:00:00Z" }] };
    // decisionFeedback.record copies the minted suggestion when none is supplied.
    if (/SELECT suggestion FROM decision_feedback/i.test(sql)) {
      return { rows: [{ suggestion: { complaintRef: "CMP-2026-0007", category: "consent", severity: "high", suggestedTeam: "investigations", confidence: 0.9 } }] };
    }
    if (/INSERT INTO triage_suggestions/i.test(sql)) return { rows: [{ id: "11111111-2222-4333-8444-555555555555" }] };
    if (/SELECT id, prediction_id, status, category, severity, suggested_team FROM triage_suggestions/i.test(sql)) {
      return {
        rows: [{
          id: "11111111-2222-4333-8444-555555555555",
          prediction_id: "22222222-2222-4333-8444-555555555555",
          status: "pending",
          category: "consent",
          severity: "high",
          suggested_team: "investigations",
        }],
      };
    }
    if (/UPDATE triage_suggestions/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPublish.mockClear();
  mockAppendLedger.mockClear();
  installQueryStub();
  delete process.env.AUTO_TRIAGE_CONFIDENCE;
});

afterEach(() => {
  setLlmFetch(null);
});

describe("autoTriage thresholds", () => {
  it("defaults to 0.75 and honours AUTO_TRIAGE_CONFIDENCE", () => {
    expect(autoTriageConfidenceThreshold()).toBe(0.75);
    process.env.AUTO_TRIAGE_CONFIDENCE = "0.9";
    expect(autoTriageConfidenceThreshold()).toBe(0.9);
    process.env.AUTO_TRIAGE_CONFIDENCE = "bogus";
    expect(autoTriageConfidenceThreshold()).toBe(0.75);
  });

  it("below threshold -> manual_queue, no suggestion row written", async () => {
    setLlmFetch(fetchReturning(goodClassification(0.5)));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("manual_queue");
    if (out.outcome === "manual_queue") {
      expect(out.reason).toBe("below_threshold");
      expect(out.confidence).toBe(0.5);
    }
    const triageInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO triage_suggestions/i.test(String(sql)));
    expect(triageInsert).toBeUndefined();
  });

  it("at/above threshold -> pending suggestion row + minted feedback baseline", async () => {
    setLlmFetch(fetchReturning(goodClassification(0.9)));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("suggested");
    if (out.outcome !== "suggested") return;
    expect(out.predictionId).toMatch(/^[0-9a-f-]{36}$/);

    const triageInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO triage_suggestions/i.test(String(sql)));
    expect(triageInsert).toBeDefined();
    expect(triageInsert![1][0]).toBe(7); // complaint_id
    expect(triageInsert![1][1]).toBe(out.predictionId); // prediction_id link
    expect(triageInsert![1][2]).toBe("consent"); // category

    // Wave-1 baseline: mintPrediction inserted a decision_feedback 'ignore' row.
    const mint = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(mint).toBeDefined();
    expect(mint![1][1]).toBe("triage"); // surface
    expect(mint![1][5]).toBe("ignore"); // baseline action
  });

  it("custom env threshold admits a mid-confidence classification", async () => {
    process.env.AUTO_TRIAGE_CONFIDENCE = "0.5";
    setLlmFetch(fetchReturning(goodClassification(0.5)));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("suggested");
  });
});

describe("autoTriage fail-closed behaviour", () => {
  it("gateway network error -> manual_queue (gateway_network)", async () => {
    setLlmFetch(async () => { throw new Error("ECONNREFUSED"); });
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("manual_queue");
    if (out.outcome === "manual_queue") expect(out.reason).toBe("gateway_network");
    expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO triage_suggestions/i.test(String(sql)))).toBeUndefined();
  });

  it("gateway HTTP 500 -> manual_queue (gateway_http)", async () => {
    setLlmFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("manual_queue");
    if (out.outcome === "manual_queue") expect(out.reason).toBe("gateway_http");
  });

  it("out-of-vocabulary model output -> manual_queue (unusable_model_output)", async () => {
    setLlmFetch(fetchReturning({ category: "telepathy", severity: "high", team: "investigations", confidence: 0.99 }));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("manual_queue");
    if (out.outcome === "manual_queue") expect(out.reason).toBe("unusable_model_output");
  });

  it("JSON wrapped in prose is still parsed", async () => {
    setLlmFetch(fetchReturning({ response: `Here you go:\n${JSON.stringify(goodClassification(0.9))}\nDone.` }));
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("suggested");
  });
});

describe("autoTriage decide flow", () => {
  it("accept updates the row and appends an 'accept' decision_feedback outcome", async () => {
    const caller = autoTriageRouter.createCaller(createUserContext());
    const out = await caller.decide({ suggestionId: "11111111-2222-4333-8444-555555555555", action: "accepted" });
    expect(out.status).toBe("accepted");
    expect(out.feedback?.id).toBe("fb-1");

    const update = mockQuery.mock.calls.find(([sql]) => /UPDATE triage_suggestions/i.test(String(sql)));
    expect(update).toBeDefined();
    expect(update![1][1]).toBe("accepted");

    const outcomeRows = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(outcomeRows.length).toBe(1);
    expect(outcomeRows[0][1][0]).toBe("22222222-2222-4333-8444-555555555555"); // prediction_id
    expect(outcomeRows[0][1][5]).toBe("accept");
    expect(mockPublish).toHaveBeenCalled();
  });

  it("edit requires/validates finalValue and records an 'edit' outcome", async () => {
    const caller = autoTriageRouter.createCaller(createUserContext());
    const out = await caller.decide({
      suggestionId: "11111111-2222-4333-8444-555555555555",
      action: "edited",
      finalValue: { category: "breach", severity: "critical", suggestedTeam: "breach_response" },
    });
    expect(out.finalValue?.category).toBe("breach");
    const outcome = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(outcome[0][1][5]).toBe("edit");
    expect(JSON.parse(String(outcome[0][1][7]))).toMatchObject({ category: "breach", severity: "critical" });
  });

  it("edit with an out-of-vocabulary category is rejected before any write", async () => {
    await expect(
      decideTriage({
        suggestionId: "11111111-2222-4333-8444-555555555555",
        action: "edited",
        finalValue: { category: "nonsense" },
        decidedBy: "officer",
      }),
    ).rejects.toThrow(/category must be one of/i);
    expect(mockQuery.mock.calls.find(([sql]) => /UPDATE triage_suggestions/i.test(String(sql)))).toBeUndefined();
  });

  it("double-decide is rejected", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT id, prediction_id, status/i.test(sql)) {
        return { rows: [{ id: "x", prediction_id: null, status: "accepted", category: "consent", severity: "high", suggested_team: "legal" }] };
      }
      return { rows: [] };
    });
    await expect(
      decideTriage({ suggestionId: "11111111-2222-4333-8444-555555555555", action: "accepted", decidedBy: "officer" }),
    ).rejects.toThrow(/already decided/i);
  });
});

describe("llmGateway error taxonomy", () => {
  it("classifies aborts as timeouts", async () => {
    setLlmFetch(async () => { throw new Error("The operation was aborted due to timeout"); });
    const out = await suggestTriage(7, 42);
    expect(out.outcome).toBe("manual_queue");
    if (out.outcome === "manual_queue") expect(out.reason).toBe("gateway_timeout");
  });

  it("LlmGatewayError exposes its kind", () => {
    expect(new LlmGatewayError("parse", "x").kind).toBe("parse");
  });
});
