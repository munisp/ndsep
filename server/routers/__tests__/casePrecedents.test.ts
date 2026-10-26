/**
 * casePrecedents router unit tests (round 12, wave 6 — roadmap §4.3).
 *
 * No database, no Qdrant, no vector worker: the shared pg pool (../../db
 * getPool) is mocked with a SQL-dispatching stub, the decisionFeedback
 * module is mocked (mintPrediction + decisionFeedbackRouter.createCaller),
 * and global fetch is stubbed to emulate the vector worker's /search
 * endpoint. Procedures are invoked via router.createCaller with a synthetic
 * staff context (same pattern as decisionFeedback.test.ts).
 *
 * Covers:
 *  - similarCases maps worker hits to scored precedent cards and mints a
 *    decision_feedback prediction (surface='precedents');
 *  - caseType filter narrows results post-hoc;
 *  - fail-closed degradation: worker unreachable → empty results +
 *    degraded flag + no prediction minted;
 *  - complaintId path loads the complaint and 404s on unknown ids;
 *  - AuthZ: non-staff roles are rejected (staffProcedure);
 *  - logPrecedentOutcome delegates helpful→accept / not-helpful→reject to
 *    decisionFeedback.record with a PII-free verdict payload;
 *  - redactQueryText strips email / MSISDN / NIN before the text leaves
 *    the server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../../_core/context";

const mockQuery = vi.fn();
const mockMint = vi.fn().mockResolvedValue("11111111-2222-4333-8444-555555555555");
const mockRecord = vi.fn().mockResolvedValue({
  id: "fb-row-1",
  predictionId: "11111111-2222-4333-8444-555555555555",
  action: "accept",
  createdAt: "2026-04-01T00:00:00.000Z",
});
const mockFetch = vi.fn();

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
}));

vi.mock("../decisionFeedback", () => ({
  mintPrediction: (...args: unknown[]) => mockMint(...args),
  decisionFeedbackRouter: {
    createCaller: () => ({ record: (...args: unknown[]) => mockRecord(...args) }),
  },
}));

vi.stubGlobal("fetch", mockFetch);

import { casePrecedentsRouter, redactQueryText, PRECEDENTS_SURFACE } from "../casePrecedents";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createStaffContext(role = "government_staff"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "test-officer-001",
    email: "officer@ndpc.gov.ng",
    name: "Test Officer",
    loginMethod: "manus",
    role,
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

function workerResponse(results: unknown[]) {
  return { ok: true, json: async () => ({ results, query: "q" }) };
}

const HIT_COMPLAINT = {
  score: 0.91,
  payload: {
    case_type: "complaint", case_id: "77", reference: "NDPC-CMP-2025-000077",
    category: "breach", sector: "fintech", outcome: "resolved",
    penalty_band: "none", decided_at: "2025-11-02",
  },
};
const HIT_SETTLEMENT = {
  score: 0.83,
  payload: {
    case_type: "settlement", case_id: "12", reference: "NDPC-SET-2025-00012",
    category: "settlement", sector: "fintech", outcome: "fulfilled",
    penalty_band: "2m_10m", decided_at: "2025-12-14",
  },
};

beforeEach(() => {
  mockQuery.mockReset();
  mockMint.mockClear();
  mockRecord.mockClear();
  mockFetch.mockReset();
});

describe("similarCases", () => {
  it("maps worker hits to precedent cards and mints a prediction", async () => {
    mockFetch.mockResolvedValue(workerResponse([HIT_COMPLAINT, HIT_SETTLEMENT]));
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.similarCases({ queryText: "fintech breach of consent" });

    expect(res.degraded).toBe(false);
    expect(res.predictionId).toBe(PID);
    expect(res.collection).toBe("ndsep_cases");
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({
      caseType: "complaint", caseId: "77", reference: "NDPC-CMP-2025-000077",
      outcome: "resolved", penaltyBand: "none", score: 0.91,
    });

    // Worker called against the ndsep_cases collection.
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/search?q=");
    expect(url).toContain("collection=ndsep_cases");

    // Prediction minted on the precedents surface with card metadata only.
    expect(mockMint).toHaveBeenCalledTimes(1);
    const mintArgs = mockMint.mock.calls[0][0] as any;
    expect(mintArgs.surface).toBe(PRECEDENTS_SURFACE);
    expect(mintArgs.suggestion.results).toHaveLength(2);
    expect(JSON.stringify(mintArgs.suggestion)).not.toMatch(/@/);
  });

  it("filters results by caseType", async () => {
    mockFetch.mockResolvedValue(workerResponse([HIT_COMPLAINT, HIT_SETTLEMENT]));
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.similarCases({ queryText: "breach", caseType: "settlement" });
    expect(res.results).toHaveLength(1);
    expect(res.results[0].caseType).toBe("settlement");
  });

  it("fails closed with degraded flag when the vector worker is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.similarCases({ queryText: "anything at all" });
    expect(res.results).toEqual([]);
    expect(res.degraded).toBe(true);
    expect(res.predictionId).toBeNull();
    expect(res.reason).toMatch(/unavailable/i);
    expect(mockMint).not.toHaveBeenCalled();
  });

  it("fails closed on non-OK worker responses", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.similarCases({ queryText: "anything at all" });
    expect(res.degraded).toBe(true);
    expect(res.results).toEqual([]);
  });

  it("builds the query from a complaint when complaintId is given", async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: 5, category: "consent",
        subject: "Marketing without consent",
        description: "They keep texting me on 08031234567 after I opted out",
        status: "under_review",
      }],
    });
    mockFetch.mockResolvedValue(workerResponse([HIT_COMPLAINT]));
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.similarCases({ complaintId: 5 });
    expect(res.results).toHaveLength(1);
    // The PII in the description must be scrubbed before leaving the server.
    const url = decodeURIComponent(String(mockFetch.mock.calls[0][0]));
    expect(url).toContain("Marketing without consent");
    expect(url).not.toContain("08031234567");
  });

  it("rejects an unknown complaintId", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    await expect(caller.similarCases({ complaintId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires queryText or complaintId", async () => {
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    await expect(caller.similarCases({} as any)).rejects.toThrow();
  });

  it("rejects non-staff roles", async () => {
    mockFetch.mockResolvedValue(workerResponse([]));
    const caller = casePrecedentsRouter.createCaller(createStaffContext("user"));
    await expect(caller.similarCases({ queryText: "breach" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("logPrecedentOutcome", () => {
  it("maps helpful → accept on decisionFeedback.record", async () => {
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    const res = await caller.logPrecedentOutcome({
      predictionId: PID, helpful: true, caseType: "complaint", caseId: "77",
    });
    expect(res.recorded).toBe(true);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const args = mockRecord.mock.calls[0][0] as any;
    expect(args.predictionId).toBe(PID);
    expect(args.surface).toBe(PRECEDENTS_SURFACE);
    expect(args.action).toBe("accept");
    expect(args.finalValue.verdict).toBe("helpful");
  });

  it("maps not-helpful → reject", async () => {
    mockRecord.mockResolvedValueOnce({
      id: "fb-row-2", predictionId: PID, action: "reject", createdAt: "2026-04-01T00:00:00.000Z",
    });
    const caller = casePrecedentsRouter.createCaller(createStaffContext());
    await caller.logPrecedentOutcome({ predictionId: PID, helpful: false });
    expect((mockRecord.mock.calls[0][0] as any).action).toBe("reject");
    expect((mockRecord.mock.calls[0][0] as any).finalValue.verdict).toBe("not_helpful");
  });

  it("rejects non-staff roles", async () => {
    const caller = casePrecedentsRouter.createCaller(createStaffContext("org_admin"));
    await expect(caller.logPrecedentOutcome({ predictionId: PID, helpful: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("redactQueryText", () => {
  it("strips emails, MSISDN and NIN", () => {
    const out = redactQueryText(
      "Contact amina.bello@example.com or +234 803 123 4567, NIN 12345678901, alt 08031234567",
    );
    expect(out).not.toContain("amina.bello@example.com");
    expect(out).not.toContain("803 123 4567");
    expect(out).not.toContain("12345678901");
    expect(out).not.toContain("08031234567");
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[nin]");
  });
});
