import { describe, expect, it } from "vitest";
import { createWorkerEventSignature, validateWorkerEventShape, verifyWorkerEventSignature, workerEventNonceKey } from "./workerEventAuth";

const secret = "a-test-only-secret-that-is-longer-than-thirty-two-characters";
const timestamp = "1760000000000";
const nonce = "0123456789abcdefghijklmnop";
const body = Buffer.from(JSON.stringify({ event: "security.alert", data: { severity: "high" } }));

describe("worker event authentication", () => {
  it("accepts a current, correctly signed event", () => {
    const signature = createWorkerEventSignature(secret, "siem-correlator", timestamp, nonce, body);
    expect(verifyWorkerEventSignature(secret, { workerId: "siem-correlator", timestamp, nonce, signature, rawBody: body }, Number(timestamp))).toBeUndefined();
  });

  it("rejects an altered payload even when identity metadata is unchanged", () => {
    const signature = createWorkerEventSignature(secret, "siem-correlator", timestamp, nonce, body);
    const altered = Buffer.from(JSON.stringify({ event: "security.alert", data: { severity: "critical" } }));
    expect(verifyWorkerEventSignature(secret, { workerId: "siem-correlator", timestamp, nonce, signature, rawBody: altered }, Number(timestamp))).toContain("signature");
  });

  it("rejects a stale replay window", () => {
    const signature = createWorkerEventSignature(secret, "siem-correlator", timestamp, nonce, body);
    expect(verifyWorkerEventSignature(secret, { workerId: "siem-correlator", timestamp, nonce, signature, rawBody: body }, Number(timestamp) + 300_001)).toContain("freshness");
  });

  it("validates names, event data and a stable nonce storage key", () => {
    expect(validateWorkerEventShape("siem-correlator", "security.alert", { severity: "high" })).toBeUndefined();
    expect(validateWorkerEventShape("", "security.alert", {})).toContain("identity");
    expect(validateWorkerEventShape("siem-correlator", "x", {})).toContain("event");
    expect(validateWorkerEventShape("siem-correlator", "security.alert", [])).toContain("object");
    expect(workerEventNonceKey("siem-correlator", nonce)).toBe(`ndsep:worker-event:nonce:siem-correlator:${nonce}`);
  });
});
