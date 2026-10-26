/**
 * ransomTrace router unit tests (round 13, W3).
 *
 * No database, no network: ../../db pool + addCaseTimelineEntry,
 * ../../antiwipe/ledger and ../../osiris/cryptoClient are mocked; procedures
 * are invoked via router.createCaller with a staff context (same pattern as
 * server/routers/__tests__/decisionFeedback.test.ts).
 *
 * Covers:
 *  - OFAC-sanctioned wallet → ofacAlert flag + audit_ledger entry +
 *    case-timeline attach when caseId is given;
 *  - unavailable upstream → reported as NOT traced, no ledger entry, never
 *    presented as clean;
 *  - malformed address → BAD_REQUEST (wallet never traced);
 *  - unknown caseId → NOT_FOUND before any trace call;
 *  - staff role enforcement;
 *  - listTraces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../../_core/context";

const mockQuery = vi.fn();
const mockTimeline = vi.fn().mockResolvedValue({});
const mockAppendLedger = vi.fn().mockResolvedValue({ seq: 42, entryHash: "ab".repeat(32) });
const mockTraceWallet = vi.fn();
const mockEmit = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db", () => ({
  getPool: () => ({ query: mockQuery }),
  getSharedPool: () => ({ query: mockQuery }),
  addCaseTimelineEntry: (...args: unknown[]) => mockTimeline(...args),
}));

vi.mock("../../encryptionMiddleware", () => ({
  autoDecryptRows: (_q: string, rows: unknown[]) => rows,
}));

vi.mock("../../antiwipe/ledger", () => ({
  appendLedger: (...args: unknown[]) => mockAppendLedger(...args),
}));

vi.mock("../../middlewareIntegration", () => ({
  emitMutationEvent: (...args: unknown[]) => mockEmit(...args),
  EVENTS: {},
}));

vi.mock("../../osiris/cryptoClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../osiris/cryptoClient")>();
  return {
    ...actual,
    traceWallet: (...args: unknown[]) => mockTraceWallet(...args),
  };
});

import { ransomTraceRouter } from "../ransomTrace";

const BTC_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const CASE_ID = 1234;

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createStaffContext(role: string = "government_staff"): TrpcContext {
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
  } as AuthenticatedUser;
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

function traceResult(overrides: Record<string, unknown> = {}) {
  return {
    address: BTC_ADDRESS,
    chain: "bitcoin",
    chainInferred: false,
    balance: 1.25,
    txCount: 3,
    recentTxs: [{ txid: "deadbeef".repeat(8), direction: "in", amount: 0.5, timestamp: "2026-04-01T00:00:00.000Z" }],
    ofacSanctioned: false,
    status: "ok",
    tracedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function installQueryStub() {
  mockQuery.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    if (/SELECT id, status, case_reference FROM enforcement_cases/i.test(sql)) {
      return { rows: [{ id: CASE_ID, status: "under_investigation", case_reference: "NDSEP-CASE-001234" }] };
    }
    if (/INSERT INTO ransom_traces/i.test(sql)) {
      return { rows: [{ id: 55, address: BTC_ADDRESS, chain: "bitcoin", ofac_sanctioned: true }] };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) return { rows: [] };
    if (/FROM ransom_traces rt/i.test(sql)) {
      return { rows: [{ id: 55, address: BTC_ADDRESS, ofac_sanctioned: true, case_reference: "NDSEP-CASE-001234" }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockTimeline.mockClear();
  mockAppendLedger.mockClear();
  mockTraceWallet.mockReset();
  mockEmit.mockClear();
  installQueryStub();
});

describe("ransomTrace.traceWallet — OFAC flagging", () => {
  it("flags an OFAC-sanctioned wallet prominently and writes the audit ledger", async () => {
    mockTraceWallet.mockResolvedValue(traceResult({ ofacSanctioned: true }));
    const caller = ransomTraceRouter.createCaller(createStaffContext());
    const out = await caller.traceWallet({ address: BTC_ADDRESS, caseId: CASE_ID });

    expect(out.ofacAlert).toBe(true);
    expect(out.unavailable).toBe(false);
    expect(out.ledgerSeq).toBe(42);

    // ransom_traces row persisted with the OFAC flag
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO ransom_traces/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert![1][0]).toBe(CASE_ID); // case_id
    expect(insert![1][1]).toBe(BTC_ADDRESS); // address
    expect(insert![1][3]).toBe(true); // ofac_sanctioned
    expect(insert![1][4]).toBe("ok"); // status

    // Hash-chained audit ledger entry
    expect(mockAppendLedger).toHaveBeenCalledTimes(1);
    expect(mockAppendLedger.mock.calls[0][0]).toBe("ransom_wallet_ofac_hit");
    expect(mockAppendLedger.mock.calls[0][1]).toMatchObject({ address: BTC_ADDRESS, case_id: CASE_ID });

    // Attached to the enforcement case timeline
    expect(mockTimeline).toHaveBeenCalledTimes(1);
    expect(mockTimeline.mock.calls[0][0]).toMatchObject({ caseId: CASE_ID, toStatus: "under_investigation" });
    expect(String(mockTimeline.mock.calls[0][0].note)).toMatch(/OFAC-SANCTIONED/);
  });

  it("does NOT flag a clean wallet and skips the ledger", async () => {
    mockTraceWallet.mockResolvedValue(traceResult());
    const caller = ransomTraceRouter.createCaller(createStaffContext());
    const out = await caller.traceWallet({ address: BTC_ADDRESS });
    expect(out.ofacAlert).toBe(false);
    expect(mockAppendLedger).not.toHaveBeenCalled();
    expect(mockTimeline).not.toHaveBeenCalled(); // no caseId → no attach
  });

  it("fail-closed: unavailable upstream is NOT reported as clean, no ledger", async () => {
    mockTraceWallet.mockResolvedValue(traceResult({
      status: "unavailable", reason: "crypto trace endpoint unreachable",
      ofacSanctioned: false, balance: null, txCount: null, recentTxs: [],
    }));
    const caller = ransomTraceRouter.createCaller(createStaffContext());
    const out = await caller.traceWallet({ address: BTC_ADDRESS, caseId: CASE_ID });
    expect(out.ofacAlert).toBe(false);
    expect(out.unavailable).toBe(true);
    expect(mockAppendLedger).not.toHaveBeenCalled();
    // Timeline note must say the wallet was NOT traced
    expect(String(mockTimeline.mock.calls[0][0].note)).toMatch(/TRACE UNAVAILABLE/);
  });

  it("rejects a malformed address without tracing", async () => {
    const caller = ransomTraceRouter.createCaller(createStaffContext());
    await expect(caller.traceWallet({ address: "bc1q NOT A WALLET !!!!" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockTraceWallet).not.toHaveBeenCalled();
  });

  it("rejects an unknown caseId before tracing", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM enforcement_cases/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const caller = ransomTraceRouter.createCaller(createStaffContext());
    await expect(caller.traceWallet({ address: BTC_ADDRESS, caseId: 999999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockTraceWallet).not.toHaveBeenCalled();
  });

  it("requires a staff role", async () => {
    mockTraceWallet.mockResolvedValue(traceResult());
    const caller = ransomTraceRouter.createCaller(createStaffContext("org_user"));
    await expect(caller.traceWallet({ address: BTC_ADDRESS })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ransomTrace.listTraces", () => {
  it("returns trace rows with case references", async () => {
    const caller = ransomTraceRouter.createCaller(createStaffContext("auditor"));
    const rows = await caller.listTraces({ caseId: CASE_ID });
    expect(rows).toHaveLength(1);
    expect((rows as any[])[0].case_reference).toBe("NDSEP-CASE-001234");
    const q = mockQuery.mock.calls.find(([sql]) => /FROM ransom_traces rt/i.test(String(sql)));
    expect(String(q![0])).toContain("rt.case_id = $1");
  });
});
