import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__ as mojaloop } from "./mojaloopCallback";
import { KafkaDeliveryError, kafkaProduceRequired, checkKafkaHealth } from "./kafka";
import { __test__ as tigerbeetle, createTigerBeetleTransaction } from "./tigerbeetle";

describe("financial integration hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MOJALOOP_CALLBACK_HMAC_SECRET;
  });

  it("accepts only a fresh HMAC over the exact Mojaloop callback bytes", () => {
    process.env.MOJALOOP_CALLBACK_HMAC_SECRET = "a".repeat(32);
    const raw = Buffer.from('{"transferId":"transfer-123","transferState":"COMMITTED"}', "utf8");
    const timestamp = String(Date.now());
    const input = Buffer.concat([Buffer.from(`ndsep-mojaloop-callback-v1.${timestamp}.`), raw]);
    const signature = createHmac("sha256", process.env.MOJALOOP_CALLBACK_HMAC_SECRET).update(input).digest("hex");
    const req = {
      get: (name: string) => name === "x-ndsep-mojaloop-timestamp" ? timestamp : name === "x-ndsep-mojaloop-signature" ? signature : undefined,
      rawMojaloopCallbackBody: raw,
    };
    expect(mojaloop.verifyCallback(req as any).ok).toBe(true);
    (req as any).rawMojaloopCallbackBody = Buffer.from('{"transferId":"transfer-123","transferState":"ABORTED"}', "utf8");
    expect(mojaloop.verifyCallback(req as any).ok).toBe(false);
  });

  it("allows idempotent redelivery but never reverses a terminal Mojaloop state", () => {
    expect(mojaloop.legalTransition("pending", "completed")).toBe(true);
    expect(mojaloop.legalTransition("completed", "completed")).toBe(true);
    expect(mojaloop.legalTransition("completed", "failed")).toBe(false);
    expect(mojaloop.legalTransition("failed", "completed")).toBe(false);
  });

  it("creates a stable TigerBeetle idempotency key and rejects invalid money", () => {
    const base = { orgId: "org-1", penaltyId: "penalty-1", amount: 12.5, type: "penalty" as const };
    expect(tigerbeetle.idempotencyKey(base)).toEqual(tigerbeetle.idempotencyKey({ ...base }));
    expect(() => tigerbeetle.validateTransaction({ ...base, amount: 0 })).toThrow("positive");
  });

  it("requires a durable TigerBeetle acknowledgement identifier pair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ transaction_id: "only-one" }), { status: 200 })));
    await expect(createTigerBeetleTransaction({ orgId: "org-1", penaltyId: "p-1", amount: 5, type: "penalty" })).rejects.toThrow("missing durable transaction identifiers");
  });

  it("throws for Kafka required delivery when the broker health check cannot establish delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("broker unavailable")));
    await checkKafkaHealth();
    await expect(kafkaProduceRequired("ndsep.audit.events", "key-1", { event: "audit.action" })).rejects.toBeInstanceOf(KafkaDeliveryError);
  });
});
