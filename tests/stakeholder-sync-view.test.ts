import { describe, expect, it } from "vitest";
import { filterAndSortStakeholderSyncItems, getBulkRetryEligibleStakeholderItems } from "../lib/stakeholder-sync-view";
import { describeStakeholderSyncFailure } from "../lib/stakeholder-sync-error-details";

const items = [
  { id: "a", idempotencyKey: "a", kind: "profile" as const, label: "Profile", queuedAt: "2026-08-01T09:00:00.000Z", status: "failed" as const, retryCount: 1, payloadPath: "file:///a" },
  { id: "b", idempotencyKey: "b", kind: "business_document" as const, label: "Business", queuedAt: "2026-08-02T09:00:00.000Z", status: "dead_letter" as const, retryCount: 3, payloadPath: "file:///b" },
  { id: "c", idempotencyKey: "c", kind: "identity_document" as const, label: "Identity", queuedAt: "2026-08-03T09:00:00.000Z", status: "pending" as const, retryCount: 0, payloadPath: "file:///c" },
];
describe("stakeholder synchronization queue view", () => {
  it("filters each recoverable queue state", () => expect(filterAndSortStakeholderSyncItems(items, "dead_letter", "newest").map((item) => item.id)).toEqual(["b"]));
  it("sorts known queue records deterministically", () => expect(filterAndSortStakeholderSyncItems(items, "all", "oldest").map((item) => item.id)).toEqual(["a", "b", "c"]));
  it("filters paused items separately from recoverable failures", () => expect(filterAndSortStakeholderSyncItems([{ ...items[0], status: "paused" }, ...items.slice(1)], "paused", "newest").map((item) => item.id)).toEqual(["a"]));
  it("excludes quarantined items from bulk retry", () => expect(getBulkRetryEligibleStakeholderItems(items).map((item) => item.id)).toEqual(["a"]));
  it("explains the recorded failure category without concealing the server detail", () => expect(describeStakeholderSyncFailure({ ...items[0], lastErrorCode: "replay_rejected", lastErrorMessage: "CAC number format invalid" })).toContain("CAC number format invalid"));
});
