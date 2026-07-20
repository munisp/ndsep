import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
const missionMutateMock = vi.fn();
const geofenceReplayMock = vi.fn();
const scheduleNotificationMock = vi.fn();
const appendActivityAuditMock = vi.fn();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

vi.mock("../lib/trpc", () => ({
  createTRPCClient: () => ({
    sync: {
      updateMissionStatus: {
        mutate: missionMutateMock,
      },
    },
    notifications: {
      replayGeofenceEvent: {
        mutate: geofenceReplayMock,
      },
    },
  }),
}));

vi.mock("../lib/mobile-notifications", () => ({
  scheduleFieldUpdateNotification: scheduleNotificationMock,
}));

vi.mock("../lib/mobile-activity", () => ({
  appendActivityAudit: appendActivityAuditMock,
}));

describe("mobile sync replay", () => {
  beforeEach(() => {
    storage.clear();
    missionMutateMock.mockReset();
    geofenceReplayMock.mockReset();
    scheduleNotificationMock.mockReset();
    appendActivityAuditMock.mockReset();
  });

  it("queues mission status updates for offline replay", async () => {
    const module = await import("../lib/mobile-sync-replay");

    await module.queueMissionStatusMutation({
      type: "mission_status",
      missionId: "mission-1",
      status: "active",
    });

    const queued = await module.getQueuedFieldMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.type).toBe("mission_status");
    if (queued[0]?.type === "mission_status") {
      expect(queued[0].missionId).toBe("mission-1");
      expect(queued[0].status).toBe("active");
    }
  });

  it("replays queued mission updates and clears them when the API succeeds", async () => {
    missionMutateMock.mockResolvedValue({ ok: true });
    const module = await import("../lib/mobile-sync-replay");

    await module.queueMissionStatusMutation({
      type: "mission_status",
      missionId: "mission-2",
      status: "synced",
    });

    const result = await module.replayQueuedFieldMutations();
    const queued = await module.getQueuedFieldMutations();

    expect(result).toEqual({ replayed: 1, failed: 0, reconciled: 0 });
    expect(queued).toHaveLength(0);
    expect(missionMutateMock).toHaveBeenCalledWith({ missionId: "mission-2", status: "synced" });
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("keeps queued mission updates when replay fails", async () => {
    missionMutateMock.mockRejectedValue(new Error("network unavailable"));
    const module = await import("../lib/mobile-sync-replay");

    await module.queueMissionStatusMutation({
      type: "mission_status",
      missionId: "mission-3",
      status: "active",
    });

    const result = await module.replayQueuedFieldMutations();
    const queued = await module.getQueuedFieldMutations();

    expect(result).toEqual({ replayed: 0, failed: 1, reconciled: 0 });
    expect(queued).toHaveLength(1);
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it("replays queued geofence events and records reconciliation audit when the server rejects them as duplicates", async () => {
    geofenceReplayMock.mockResolvedValue({ status: "duplicate" });
    const module = await import("../lib/mobile-sync-replay");

    await module.queueGeofenceEventMutation({
      type: "geofence_event",
      parcelId: 6,
      transition: "enter",
      radiusMeters: 150,
      latitude: 6.451,
      longitude: 3.601,
      triggeredAt: "2026-07-20T13:00:00Z",
      activityId: "activity-geofence-1",
    });

    const result = await module.replayQueuedFieldMutations();
    expect(result).toEqual({ replayed: 0, failed: 0, reconciled: 1 });
    expect(geofenceReplayMock).toHaveBeenCalledWith({
      parcelId: 6,
      transition: "enter",
      radiusMeters: 150,
      latitude: 6.451,
      longitude: 3.601,
      triggeredAt: "2026-07-20T13:00:00Z",
    });
    expect(appendActivityAuditMock).toHaveBeenCalledTimes(1);
  });
});
