/**
 * Round-10 NGN TigerBeetle wiring tests.
 *
 * Covers the middlewareExtensions multi-ledger bridge:
 *  - USD transfers keep the legacy amount_usd field and post to ledger 1;
 *  - NGN transfers post to the NGN ledger (TB_LEDGER_NGN, default id 2) with
 *    ledger_id set and amount_usd OMITTED (never coerced to USD);
 *  - unknown currencies are NOT written — they are persisted to
 *    ledger_reconciliation_queue (migration 0110) instead;
 *  - a bridge failure enqueues a 'ledger_write_failed' reconciliation item
 *    AND rethrows so callers record an explicit failure status.
 *
 * No network and no database: fetch is stubbed and ../db's getSharedPool is
 * mocked to capture the reconciliation-queue INSERT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Capture ledger_reconciliation_queue writes via a mocked pool.
const poolQueries: Array<{ sql: string; params: unknown[] }> = [];
vi.mock("../db", () => ({
  getSharedPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      poolQueries.push({ sql, params });
      if (/INSERT INTO ledger_reconciliation_queue/i.test(sql)) {
        return { rows: [{ id: 7 }] };
      }
      return { rows: [] };
    },
  }),
  getPool: () => null,
}));

function mockOk(body: object = { success: true }) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
  poolQueries.length = 0;
});

describe("tigerbeetleTransfer — multi-ledger (NGN wiring)", () => {
  it("posts USD to ledger 1 with the legacy amount_usd field", async () => {
    mockFetch.mockImplementation(mockOk);
    const { tigerbeetleTransfer } = await import("../middlewareExtensions");
    await tigerbeetleTransfer({
      debitAccountId: "org:1",
      creditAccountId: "ndpc-settlement-clearing",
      amount: 100,
      currency: "USD",
      reference: "NDPC-SET-2026-00001-INST-1",
      transferType: "settlement",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/transaction");
    const body = JSON.parse(String(init.body));
    expect(body.ledger_id).toBe(1);
    expect(body.amount_usd).toBe(100);
    expect(body.currency).toBe("USD");
    expect(body.type).toBe("settlement");
  });

  it("posts NGN to ledger 2 and OMITS amount_usd (no currency coercion)", async () => {
    mockFetch.mockImplementation(mockOk);
    const { tigerbeetleTransfer } = await import("../middlewareExtensions");
    await tigerbeetleTransfer({
      debitAccountId: "org:42",
      creditAccountId: "ndpc-settlement-clearing",
      amount: 250000,
      currency: "NGN",
      reference: "NDPC-SET-2026-00002-INST-1",
      transferType: "settlement",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.ledger_id).toBe(2);
    expect(body.currency).toBe("NGN");
    expect(body.amount).toBe(250000);
    expect("amount_usd" in body).toBe(false);
  });

  it("unknown currency: nothing posted, reconciliation row enqueued", async () => {
    const { tigerbeetleTransfer } = await import("../middlewareExtensions");
    await tigerbeetleTransfer({
      debitAccountId: "org:1",
      creditAccountId: "ndpc-settlement-clearing",
      amount: 50,
      currency: "EUR",
      reference: "NDPC-SET-2026-00003-INST-1",
      transferType: "settlement",
    });
    expect(mockFetch).not.toHaveBeenCalled();
    const insert = poolQueries.find((q) => /INSERT INTO ledger_reconciliation_queue/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe("non_usd_currency");
    expect(insert!.params[1]).toBe("EUR");
    expect(Number(insert!.params[2])).toBe(50);
  });

  it("bridge failure: enqueues ledger_write_failed AND rethrows", async () => {
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8240"));
    const { tigerbeetleTransfer } = await import("../middlewareExtensions");
    await expect(
      tigerbeetleTransfer({
        debitAccountId: "org:1",
        creditAccountId: "ndpc-fine-collections",
        amount: 5000,
        currency: "NGN",
        reference: "NDPC-RCT-2026-00042",
        transferType: "fine",
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    const insert = poolQueries.find((q) => /INSERT INTO ledger_reconciliation_queue/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe("ledger_write_failed");
    expect(insert!.params[1]).toBe("NGN");
    expect(insert!.params[3]).toBe(2); // resolved NGN ledger id recorded on the queue row
  });
});

describe("resolveTigerBeetleLedgerId", () => {
  it("maps USD->1, NGN->2 and throws for unmapped currencies (fail closed)", async () => {
    const { resolveTigerBeetleLedgerId } = await import("../middlewareExtensions");
    expect(resolveTigerBeetleLedgerId("USD")).toBe(1);
    expect(resolveTigerBeetleLedgerId("ngn")).toBe(2);
    expect(() => resolveTigerBeetleLedgerId("KES")).toThrow(/no ledger configured/);
  });
});
