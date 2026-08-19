import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));

import { getPendingStakeholderSyncItems } from "../lib/stakeholder-sync-index";

describe("stakeholder offline synchronization queue", () => {
  beforeEach(() => storage.getItem.mockReset());
  it("reports no items when no stakeholder payloads have been queued", async () => { storage.getItem.mockResolvedValue(null); await expect(getPendingStakeholderSyncItems()).resolves.toEqual([]); });
  it("returns only recognizable profile or document queue records", async () => {
    const profile = { id: "profile-1", idempotencyKey: "idempotency-1", payloadPath: "file://profile-1.sealed", kind: "profile", label: "Amina Bello Enterprises", queuedAt: "2026-08-17T12:00:00.000Z", status: "pending", retryCount: 0 };
    storage.getItem.mockResolvedValue(JSON.stringify([profile, { ignored: true }]));
    await expect(getPendingStakeholderSyncItems()).resolves.toEqual([profile]);
  });
  it("fails closed to an empty display state for malformed local queue data", async () => { storage.getItem.mockResolvedValue("not-json"); await expect(getPendingStakeholderSyncItems()).resolves.toEqual([]); });
});
