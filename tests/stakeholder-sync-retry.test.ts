import { describe, expect, it } from "vitest";
import { describeStakeholderRetrySchedule, getNextStakeholderRetryAt, isStakeholderItemDueForAutomaticRetry } from "../lib/stakeholder-sync-retry";

const base = { id: "q1", idempotencyKey: "key", kind: "profile" as const, label: "Profile", queuedAt: "2026-08-18T00:00:00.000Z", status: "failed" as const, retryCount: 1, payloadPath: "file:///sealed" };
describe("stakeholder retry schedule", () => {
  it("uses bounded 5, 15, and 60 minute retry delays", () => { const now = Date.parse("2026-08-18T00:00:00.000Z"); expect(getNextStakeholderRetryAt(1, now)).toBe("2026-08-18T00:05:00.000Z"); expect(getNextStakeholderRetryAt(2, now)).toBe("2026-08-18T00:15:00.000Z"); expect(getNextStakeholderRetryAt(8, now)).toBe("2026-08-18T01:00:00.000Z"); });
  it("does not automatically replay before the scheduled time", () => expect(isStakeholderItemDueForAutomaticRetry({ ...base, nextRetryAt: "2026-08-18T00:05:00.000Z" }, Date.parse("2026-08-18T00:04:00.000Z"))).toBe(false));
  it("renders a visible backoff explanation", () => expect(describeStakeholderRetrySchedule({ ...base, nextRetryAt: "2026-08-18T00:05:00.000Z" }, Date.parse("2026-08-18T00:03:00.000Z"))).toContain("2 minutes"));
});
