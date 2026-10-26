/**
 * Copilot drafting tests (round 12, wave 7).
 *
 * Mocked: shared pg pool (fact queries + decision_feedback insert),
 * publishWithOutbox + appendLedger (Wave-1 feedback loop side effects), and
 * the LLM gateway fetch (setLlmFetch).
 *
 * Covers:
 *  - prompt construction embeds the server-pulled facts and the tone;
 *  - draft returns { predictionId, draft } and mints the feedback baseline
 *    under the template's surface (settlement_terms -> 'settlement_terms');
 *  - gateway failure surfaces a visible error (fail-closed, nothing minted);
 *  - empty model output is rejected.
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

import { copilotDraftRouter, buildDraftPrompt } from "../copilotDraft";
import { setLlmFetch, type FetchLike } from "../../services/llmGateway";

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
  category: "consent",
  subject: "Data sold to advertisers",
  status: "received",
  controller_id: 12,
  state: "Lagos",
  received_at: "2026-03-30T09:00:00Z",
  ack_sla_due_at: "2026-04-02T09:00:00Z",
};

const SETTLEMENT_ROW = {
  id: 5,
  settlement_ref: "STL-2026-0005",
  case_ref: "ENF-2026-0001",
  status: "proposal",
  original_amount: 2500000,
  respondent_name: "ExamplePay Ltd",
  created_at: "2026-03-01T00:00:00Z",
};

let lastFetchBody: Record<string, unknown> | null = null;

function fetchReturning(payload: unknown): FetchLike {
  return async (_url, init) => {
    lastFetchBody = JSON.parse(String((init as any)?.body ?? "{}"));
    return { ok: true, status: 200, json: async () => payload };
  };
}

function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/FROM public_complaints WHERE id/i.test(sql)) return { rows: [COMPLAINT_ROW] };
    if (/FROM settlements WHERE id/i.test(sql)) return { rows: [SETTLEMENT_ROW] };
    if (/FROM settlement_terms WHERE settlement_id/i.test(sql)) {
      return { rows: [{ version: 1, monetary_amount: 2000000, currency: "NGN", non_monetary_obligations: ["Publish remediation notice"], instalment_schedule: [], is_counter: false }] };
    }
    if (/INSERT INTO decision_feedback/i.test(sql)) return { rows: [{ id: "fb-1", created_at: "2026-04-01T00:00:00Z" }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPublish.mockClear();
  mockAppendLedger.mockClear();
  lastFetchBody = null;
  installQueryStub();
});

afterEach(() => setLlmFetch(null));

describe("copilotDraft prompt construction", () => {
  it("embeds facts, tone and task in the prompt", () => {
    const prompt = buildDraftPrompt("complaint_acknowledgment", "firm", {
      heading: "Complaint CMP-2026-0007",
      lines: ["Reference: CMP-2026-0007", "Category: consent"],
    }, "keep it short");
    expect(prompt).toContain("firm");
    expect(prompt).toContain("CMP-2026-0007");
    expect(prompt).toContain("acknowledgement");
    expect(prompt).toContain("keep it short");
  });
});

describe("copilotDraft.draft", () => {
  it("pulls complaint facts server-side, calls the gateway, mints the feedback baseline", async () => {
    setLlmFetch(fetchReturning({ answer: "Dear complainant, we acknowledge receipt of CMP-2026-0007…", model_version: "ollama:test-v1" }));
    const caller = copilotDraftRouter.createCaller(createUserContext());
    const out = await caller.draft({ template: "complaint_acknowledgment", entityId: 7, tone: "formal" });

    expect(out.predictionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.draft).toContain("CMP-2026-0007");
    expect(out.modelVersion).toBe("ollama:test-v1");

    // Facts reached the gateway prompt; no complainant PII column selected.
    const question = String((lastFetchBody as any)?.question ?? "");
    expect(question).toContain("CMP-2026-0007");
    expect(question).toContain("consent");
    expect(question).toContain("formal");
    const complaintQuery = mockQuery.mock.calls.find(([sql]) => /FROM public_complaints/i.test(String(sql)));
    expect(String(complaintQuery![0])).not.toMatch(/complainant_/i);

    // Wave-1 baseline minted under surface 'copilot_draft'.
    const mint = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(mint).toBeDefined();
    expect(mint![1][1]).toBe("copilot_draft");
    expect(mint![1][5]).toBe("ignore");
    expect(JSON.parse(String(mint![1][3]))).toMatchObject({ template: "complaint_acknowledgment" });
  });

  it("settlement_terms drafts use the 'settlement_terms' feedback surface", async () => {
    setLlmFetch(fetchReturning({ answer: "Proposed settlement terms…" }));
    const caller = copilotDraftRouter.createCaller(createUserContext());
    const out = await caller.draft({ template: "settlement_terms", entityId: 5 });
    expect(out.draft).toContain("settlement");
    const mint = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(mint![1][1]).toBe("settlement_terms");
    const question = String((lastFetchBody as any)?.question ?? "");
    expect(question).toContain("STL-2026-0005");
    expect(question).toContain("NGN 2000000");
  });

  it("gateway failure surfaces a visible error and mints nothing", async () => {
    setLlmFetch(async () => { throw new Error("ECONNREFUSED"); });
    const caller = copilotDraftRouter.createCaller(createUserContext());
    await expect(caller.draft({ template: "complaint_acknowledgment", entityId: 7 })).rejects.toThrow(/unavailable/i);
    expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)))).toBeUndefined();
  });

  it("empty model output is rejected", async () => {
    setLlmFetch(fetchReturning({ answer: "   " }));
    const caller = copilotDraftRouter.createCaller(createUserContext());
    await expect(caller.draft({ template: "complaint_acknowledgment", entityId: 7 })).rejects.toThrow(/empty draft/i);
  });
});
