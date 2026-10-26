/**
 * Form copilot tests (round 12, wave 7).
 *
 * Mocked: shared pg pool (decision_feedback insert), publishWithOutbox +
 * appendLedger, and the LLM gateway fetch.
 *
 * Covers:
 *  - validateExtracted: valid fields pass through with per-field confidence;
 *    invalid fields (bad enum, bad ISO country, wrong type) are DROPPED and
 *    reported in `invalid` — never coerced past zod;
 *  - missing[] reports schema-required fields the model could not extract;
 *  - unknown keys are ignored;
 *  - router parse: JSON wrapped in prose is extracted; gateway failure and
 *    unparseable output fail closed with visible errors; the Wave-1 baseline
 *    is minted under surface 'form_copilot'.
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

import { formCopilotRouter, validateExtracted, buildExtractionPrompt } from "../formCopilot";
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

function fetchReturning(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPublish.mockClear();
  mockAppendLedger.mockClear();
  mockQuery.mockImplementation(async (sql: string) => {
    if (/INSERT INTO decision_feedback/i.test(sql)) return { rows: [{ id: "fb-1", created_at: "2026-04-01T00:00:00Z" }] };
    return { rows: [] };
  });
});

afterEach(() => setLlmFetch(null));

describe("validateExtracted — zod failure paths", () => {
  it("passes valid hosting fields through with confidence", () => {
    const out = validateExtracted("hosting_declaration", {
      entity_ref: "RC123456",
      entity_name: "ExamplePay Ltd",
      entity_type: "fintech",
      primary_dc_country: "ng", // uppercased by the schema
      cloud_regions: ["eu-west-1"],
      subprocessors: [{ name: "ExampleCloud Ltd", country: "IE", service: "hosting" }],
      _confidence: { entity_ref: 0.95 },
    });
    expect(out.fields.entity_ref).toBe("RC123456");
    expect(out.fields.primary_dc_country).toBe("NG");
    expect(out.fieldConfidence.entity_ref).toBe(0.95);
    expect(out.fieldConfidence.entity_name).toBe(0.8); // default
    expect(out.missing).toEqual([]);
    expect(out.invalid).toEqual([]);
  });

  it("drops invalid enum values and reports them", () => {
    const out = validateExtracted("cross_border_declaration", {
      organization_id: 12,
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      destination_country: "Ireland",
      legal_basis: "vibes", // invalid enum
      subject_count_band: "band_101_1000",
      volume_band: "vol_huge", // invalid enum
    });
    expect(out.fields.legal_basis).toBeUndefined();
    expect(out.fields.volume_band).toBeUndefined();
    expect(out.invalid.map((i) => i.field).sort()).toEqual(["legal_basis", "volume_band"]);
    expect(out.missing).toContain("legal_basis");
    expect(out.missing).toContain("volume_band");
  });

  it("drops wrong-typed and malformed fields (bad ISO country, negative volume)", () => {
    const out = validateExtracted("hosting_declaration", {
      entity_ref: "RC123456",
      entity_name: "ExamplePay Ltd",
      primary_dc_country: "NGA", // must be alpha-2
      in_scope: "yes", // must be boolean
      encryption_key_custody: { country: "Nigeria" }, // must be alpha-2
    });
    expect(out.fields.primary_dc_country).toBeUndefined();
    expect(out.fields.in_scope).toBeUndefined();
    expect(out.fields.encryption_key_custody).toBeUndefined();
    expect(out.invalid.map((i) => i.field).sort()).toEqual(["encryption_key_custody", "in_scope", "primary_dc_country"]);
  });

  it("ignores unknown keys entirely", () => {
    const out = validateExtracted("hosting_declaration", {
      entity_ref: "RC123456",
      entity_name: "ExamplePay Ltd",
      hacker_field: "drop table users;",
    } as Record<string, unknown>);
    expect(out.fields).not.toHaveProperty("hacker_field");
    expect(out.invalid).toEqual([]);
  });

  it("reports all required fields missing when nothing extractable", () => {
    const out = validateExtracted("cross_border_declaration", {});
    expect(out.missing.length).toBe(7);
    expect(out.confidence).toBe(0);
  });
});

describe("formCopilot.parse", () => {
  const TEXT = "RC123456 ExamplePay Ltd, a fintech. Primary DC in Lagos, Nigeria. AWS eu-west-1 for analytics. Keys in our own HSM in Nigeria.";

  it("extracts fields from prose-wrapped JSON and mints the feedback baseline", async () => {
    setLlmFetch(fetchReturning({
      answer: `Extracted:\n\`\`\`json\n${JSON.stringify({
        entity_ref: "RC123456",
        entity_name: "ExamplePay Ltd",
        entity_type: "fintech",
        primary_dc_country: "NG",
        encryption_key_custody: { country: "NG", custody_model: "own_hsm" },
      })}\n\`\`\``,
      model_version: "ollama:test-v1",
    }));
    const caller = formCopilotRouter.createCaller(createUserContext());
    const out = await caller.parse({ form: "hosting_declaration", text: TEXT });

    expect(out.predictionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.fields.entity_ref).toBe("RC123456");
    expect(out.fields.entity_type).toBe("fintech");
    expect(out.missing).toEqual([]);
    expect(out.confidence).toBeGreaterThan(0);

    const mint = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)));
    expect(mint).toBeDefined();
    expect(mint![1][1]).toBe("form_copilot");
    expect(JSON.parse(String(mint![1][3]))).toMatchObject({ form: "hosting_declaration" });
  });

  it("gateway failure fails closed with a visible error and mints nothing", async () => {
    setLlmFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const caller = formCopilotRouter.createCaller(createUserContext());
    await expect(caller.parse({ form: "hosting_declaration", text: TEXT })).rejects.toThrow(/unavailable/i);
    expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO decision_feedback/i.test(String(sql)))).toBeUndefined();
  });

  it("unparseable model output is rejected", async () => {
    setLlmFetch(fetchReturning({ answer: "I cannot help with that." }));
    const caller = formCopilotRouter.createCaller(createUserContext());
    await expect(caller.parse({ form: "hosting_declaration", text: TEXT })).rejects.toThrow(/could not extract/i);
  });

  it("extraction prompt constrains the model to the schema field list", () => {
    const prompt = buildExtractionPrompt("cross_border_declaration", "desc");
    expect(prompt).toContain("legal_basis");
    expect(prompt).toContain("adequacy_decision");
    expect(prompt).toContain("vol_small");
    expect(prompt).toContain("STRICT JSON");
  });
});
