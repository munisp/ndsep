import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./errorMonitoring", () => ({ captureError: vi.fn() }));

import { createSettlement, executeTransfer } from "./mojaloop";

afterEach(() => {
  fetchMock.mockReset();
});

describe("Mojaloop receipt integrity", () => {
  it("reports submission acceptance rather than fabricating a committed transfer state", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));

    await expect(
      executeTransfer("transfer-0001", "ndsep", "recipient", { amount: "42.50", currency: "NGN" })
    ).resolves.toEqual({ ok: true, transferId: "transfer-0001", state: "ACCEPTED" });
  });

  it("does not report settlement success without a durable hub settlement identifier", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));

    await expect(createSettlement("model-0001", "period close")).resolves.toEqual({
      ok: false,
      settlementId: undefined,
      data: undefined,
    });
  });

  it("preserves a hub-provided transfer state without treating it as callback-confirmed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ transferState: "PENDING" }), { status: 202 }));

    await expect(
      executeTransfer("transfer-0002", "ndsep", "recipient", { amount: "1.00", currency: "NGN" })
    ).resolves.toEqual({ ok: true, transferId: "transfer-0002", state: "PENDING" });
  });
});
