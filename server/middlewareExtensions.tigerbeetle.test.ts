import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTigerBeetleTransaction } = vi.hoisted(() => ({
  createTigerBeetleTransaction: vi.fn(),
}));

vi.mock("./tigerbeetle", () => ({
  createTigerBeetleTransaction,
}));

import { tigerbeetleTransfer } from "./middlewareExtensions";

describe("TigerBeetle middleware bridge", () => {
  beforeEach(() => {
    createTigerBeetleTransaction.mockReset();
    createTigerBeetleTransaction.mockResolvedValue({ success: true });
  });

  it("submits an explicit, account-bound transfer through the validated ledger client", async () => {
    await tigerbeetleTransfer({
      debitAccountId: "bank-000001",
      creditAccountId: "bank-000002",
      amount: 100.25,
      currency: "NGN",
      reference: "NIP-001",
      transferType: "NIP_TRANSFER",
    });

    expect(createTigerBeetleTransaction).toHaveBeenCalledTimes(1);
    expect(createTigerBeetleTransaction).toHaveBeenCalledWith({
      orgId: "bank-000001",
      penaltyId: "NIP-001",
      amount: 100.25,
      currency: "NGN",
      type: "transfer",
      debitAccountId: "bank-000001",
      creditAccountId: "bank-000002",
      description: "NIP_TRANSFER",
    });
  });

  it("propagates a durable-ledger rejection instead of reporting a local success", async () => {
    createTigerBeetleTransaction.mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(tigerbeetleTransfer({
      debitAccountId: "bank-000001",
      creditAccountId: "bank-000002",
      amount: 1,
      currency: "NGN",
      reference: "NIP-002",
    })).rejects.toThrow("ledger unavailable");
  });
});
