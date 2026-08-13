import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTigerBeetleTransaction,
  getTigerBeetleBalance,
  tigerBeetleSmokeTest,
} from "./tigerbeetle";

describe("TigerBeetle fail-closed contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a financial transaction when the durable proxy rejects it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ledger validation failure", { status: 422 })));
    await expect(createTigerBeetleTransaction({
      orgId: "org-1",
      penaltyId: "penalty-1",
      amountUsd: 10,
      type: "penalty",
    })).rejects.toThrow("TigerBeetle proxy rejected transaction");
  });

  it("rejects a financial transaction when the durable proxy is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    await expect(createTigerBeetleTransaction({
      orgId: "org-1",
      penaltyId: "penalty-2",
      amountUsd: 10,
      type: "penalty",
    })).rejects.toThrow("ECONNREFUSED");
  });

  it("does not convert an unavailable balance lookup into a null balance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(getTigerBeetleBalance("org-1")).rejects.toThrow("TigerBeetle balance lookup failed");
  });

  it("reports a failed health smoke test without creating a zero-value transaction", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await tigerBeetleSmokeTest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/health");
  });
});
