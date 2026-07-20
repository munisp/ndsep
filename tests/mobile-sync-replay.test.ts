import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
const mutateMock = vi.fn();
const scheduleNotificationMock = vi.fn();

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
        mutate: mutateMock,
      },
    },
  }),
}));

vi.mock("../lib/mobile-notifications", () => ({
  scheduleFieldUpdateNotification: scheduleNotificationMock,
}));

describe("mobile sync replay", () => {
  beforeEach(() => {
    storage.clear();
    mutateMock.mockReset();
    scheduleNotificationMock.mockReset();
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
    expect(queued[0]?.missionId).toBe("mission-1");
    expect(queued[0]?.status).toBe("active");
  });

  it("replays queued mission updates and clears them when the API succeeds", async () => {
    mutateMock.mockResolvedValue({ ok: true });
    const module = await import("../lib/mobile-sync-replay");

    await module.queueMissionStatusMutation({
      type: "mission_status",
      missionId: "mission-2",
      status: "synced",
    });

    const result = await module.replayQueuedFieldMutations();
    const queued = await module.getQueuedFieldMutations();

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(queued).toHaveLength(0);
    expect(mutateMock).toHaveBeenCalledWith({ missionId: "mission-2", status: "synced" });
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("keeps queued mission updates when replay fails", async () => {
    mutateMock.mockRejectedValue(new Error("network unavailable"));
    const module = await import("../lib/mobile-sync-replay");

    await module.queueMissionStatusMutation({
      type: "mission_status",
      missionId: "mission-3",
      status: "active",
    });

    const result = await module.replayQueuedFieldMutations();
    const queued = await module.getQueuedFieldMutations();

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(queued).toHaveLength(1);
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });
});
