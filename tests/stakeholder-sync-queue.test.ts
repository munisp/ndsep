import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: dependencies.getItem } }));

import { readStakeholderSyncIndex } from "../lib/stakeholder-sync-index";

describe("stakeholder offline synchronization queue", () => {
  beforeEach(() => dependencies.getItem.mockReset());

  it("reports no items when no stakeholder payloads have been queued", async () => {
    dependencies.getItem.mockResolvedValue(null);
    await expect(readStakeholderSyncIndex()).resolves.toEqual([]);
  });

  it("returns only recognizable encrypted queue records", async () => {
    dependencies.getItem.mockResolvedValue(JSON.stringify([
      { id: "profile-1", idempotencyKey: "0a4fa0d9-94e1-43cb-8a41-cbed538c3e50", kind: "profile", label: "Stakeholder profile submission", queuedAt: "2026-08-17T12:00:00.000Z", status: "pending", retryCount: 0, payloadPath: "file:///test/profile-1.sealed", payloadHash: "a".repeat(64) },
      { ignored: true },
    ]));
    await expect(readStakeholderSyncIndex()).resolves.toEqual([
      { id: "profile-1", idempotencyKey: "0a4fa0d9-94e1-43cb-8a41-cbed538c3e50", kind: "profile", label: "Stakeholder profile submission", queuedAt: "2026-08-17T12:00:00.000Z", status: "pending", retryCount: 0, payloadPath: "file:///test/profile-1.sealed", payloadHash: "a".repeat(64) },
    ]);
  });

  it("fails closed to an empty display state for malformed local queue data", async () => {
    dependencies.getItem.mockResolvedValue("not-json");
    await expect(readStakeholderSyncIndex()).resolves.toEqual([]);
  });
});
