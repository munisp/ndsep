import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  tigerbeetleTransfer: vi.fn(),
  mojaloopTransfer: vi.fn(),
  lookupTigerBeetleTransfer: vi.fn(),
  lookupMojaloopTransfer: vi.fn(),
}));
const {
  query,
  release,
  connect,
  tigerbeetleTransfer,
  mojaloopTransfer,
  lookupTigerBeetleTransfer,
  lookupMojaloopTransfer,
} = mocks;
const pool = { query, connect };

vi.mock("./db", () => ({
  getPool: () => pool,
}));

vi.mock("./middlewareExtensions", () => ({
  tigerbeetleTransfer: mocks.tigerbeetleTransfer,
  mojaloopTransfer: mocks.mojaloopTransfer,
  lookupTigerBeetleTransfer: mocks.lookupTigerBeetleTransfer,
  lookupMojaloopTransfer: mocks.lookupMojaloopTransfer,
}));

import {
  createFinancialIntentAtomically,
  dispatchNextFinancialTransfer,
  reconcileNextFinancialTransfer,
} from "./financialTransferOutbox";

const baseIntent = () => ({
  actorId: "actor-001",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  reference: "NIP-ATOMIC-001",
  kind: "NIP" as const,
  amountMinor: 250000,
  currency: "NGN",
  payload: {
    payerFsp: "payer-fsp",
    payeeFsp: "payee-fsp",
    narration: "test transfer",
    ledgerDebitAccount: "debit-account",
    ledgerCreditAccount: "credit-account",
  },
  request: {
    amountMinor: 250000,
    senderAccountNumber: "0100000000",
    receiverAccountNumber: "0200000000",
  },
  localTransaction: {
    kind: "NIP" as const,
    sessionId: "session-001",
    senderBankCode: "001",
    senderAccountNumber: "0100000000",
    senderAccountName: "Sender",
    receiverBankCode: "002",
    receiverAccountNumber: "0200000000",
    receiverAccountName: "Receiver",
    narration: "test transfer",
    nibssRef: "NIBSS-001",
    channelCode: "WEB",
    amlFlagged: false,
    fraudFlagged: false,
  },
});

function clientWith(rows: unknown[] = []): void {
  connect.mockResolvedValue({ query, release });
  query.mockImplementation(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
      return { rows: [], rowCount: 0 };
    if (sql.includes("FROM financial_transfer_outbox"))
      return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 1 };
  });
}

describe("financial outbox idempotency contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits one local instruction and one outbox row for the first request", async () => {
    clientWith();
    const result = await createFinancialIntentAtomically(baseIntent());
    expect(result).toEqual({ reference: "NIP-ATOMIC-001", duplicate: false });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      expect.stringContaining("FROM financial_transfer_outbox"),
      expect.stringContaining("INSERT INTO nip_transactions"),
      expect.stringContaining("INSERT INTO financial_transfer_outbox"),
      "COMMIT",
    ]);
    expect(query).not.toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns the original reference for a same-key, same-fingerprint retry", async () => {
    const first = baseIntent();
    clientWith([
      { transfer_reference: first.reference, request_fingerprint: "" },
    ]);
    const fingerprintQuery = query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
        return { rows: [], rowCount: 0 };
      if (sql.includes("FROM financial_transfer_outbox")) {
        // The test obtains the canonical fingerprint from the first call's SQL-independent behavior.
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    await createFinancialIntentAtomically(first);
    const insertFingerprint = String(
      fingerprintQuery.mock.calls.find(([sql]) =>
        String(sql).includes("INSERT INTO financial_transfer_outbox")
      )?.[1]?.[7] ?? ""
    );
    expect(insertFingerprint).toMatch(/^[a-f0-9]{64}$/);
    vi.clearAllMocks();
    clientWith([
      {
        transfer_reference: first.reference,
        request_fingerprint: insertFingerprint,
      },
    ]);
    await expect(createFinancialIntentAtomically(first)).resolves.toEqual({
      reference: first.reference,
      duplicate: true,
    });
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO nip_transactions")
      )
    ).toBe(false);
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back a same-key retry whose request fingerprint differs", async () => {
    const first = baseIntent();
    clientWith([
      { transfer_reference: first.reference, request_fingerprint: "different" },
    ]);
    await expect(
      createFinancialIntentAtomically({
        ...first,
        request: { ...first.request, amountMinor: 250001 },
      })
    ).rejects.toThrow("idempotency key was reused with a different request");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("financial outbox quarantine and reconciliation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tigerbeetleTransfer.mockReset();
    mojaloopTransfer.mockReset();
    lookupTigerBeetleTransfer.mockReset();
    lookupMojaloopTransfer.mockReset();
  });

  it("quarantines a provider timeout instead of retrying the transfer", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "outbox-1",
          transfer_reference: "NIP-AMBIG-001",
          transfer_kind: "NIP",
          amount_minor: "1000",
          currency: "NGN",
          payload: baseIntent().payload,
          attempts: 1,
          tigerbeetle_transfer_id: null,
          mojaloop_transfer_id: null,
        },
      ],
      rowCount: 1,
    });
    tigerbeetleTransfer.mockRejectedValue(new Error("upstream timeout"));
    const result = await dispatchNextFinancialTransfer("worker-1");
    expect(result).toBe(false);
    expect(tigerbeetleTransfer).toHaveBeenCalledTimes(1);
    expect(mojaloopTransfer).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("state = 'reconciliation_required'"),
      ["outbox-1", "upstream timeout"]
    );
  });

  it("releases an intent only when both authoritative providers report not-found", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "outbox-2",
          transfer_reference: "NIP-ABSENT-001",
          transfer_kind: "NIP",
          amount_minor: "1000",
          currency: "NGN",
          payload: baseIntent().payload,
          attempts: 1,
          tigerbeetle_transfer_id: null,
          mojaloop_transfer_id: null,
        },
      ],
      rowCount: 1,
    });
    lookupTigerBeetleTransfer.mockResolvedValue("not_found");
    lookupMojaloopTransfer.mockResolvedValue("not_found");
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await reconcileNextFinancialTransfer("worker-2")).toBe(true);
    expect(lookupTigerBeetleTransfer).toHaveBeenCalledWith("NIP-ABSENT-001");
    expect(lookupMojaloopTransfer).toHaveBeenCalledWith("NIP-ABSENT-001");
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("state = $2"))
    ).toBe(true);
  });

  it("dead-letters a pending TigerBeetle state when Mojaloop is absent", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "outbox-3",
          transfer_reference: "NIP-PENDING-001",
          transfer_kind: "NIP",
          amount_minor: "1000",
          currency: "NGN",
          payload: baseIntent().payload,
          attempts: 1,
          tigerbeetle_transfer_id: null,
          mojaloop_transfer_id: null,
        },
      ],
      rowCount: 1,
    });
    lookupTigerBeetleTransfer.mockResolvedValue("pending");
    lookupMojaloopTransfer.mockResolvedValue("not_found");
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await reconcileNextFinancialTransfer("worker-3")).toBe(true);
    expect(
      query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("state = $2") &&
          Array.isArray(params) &&
          params[1] === "dead_letter"
      )
    ).toBe(true);
    expect(mojaloopTransfer).not.toHaveBeenCalled();
  });
});
