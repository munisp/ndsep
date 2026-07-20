import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { cloneSeedBundle } from "../lib/mobile-data";
import { getMobilePlatformBundle, updateLegalWorkflowStatus, updateMissionStatus } from "../server/mobilePlatformRepository";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "mobile-platform-store.json");

beforeEach(() => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    STORE_PATH,
    JSON.stringify(
      {
        ...cloneSeedBundle(),
        syncQueue: [],
      },
      null,
      2,
    ),
  );
});

describe("mobile platform repository", () => {
  it("returns a live-capable bundle with seeded legal workflow coverage", () => {
    const bundle = getMobilePlatformBundle();
    expect(bundle.parcels.length).toBeGreaterThan(0);
    expect(bundle.legalWorkflows[0]?.registrationNumber).toBe("COFO-LA-EPE-2026-0006");
    expect(bundle.syncMeta.offlineReady).toBe(true);
  });

  it("persists mission status changes through the sync store", () => {
    const mission = updateMissionStatus({ missionId: "mission-amac-11", status: "active" });
    const bundle = getMobilePlatformBundle();
    expect(mission.status).toBe("active");
    expect(bundle.missions.find((item) => item.id === "mission-amac-11")?.status).toBe("active");
    expect(bundle.syncMeta.pendingMutations).toBeGreaterThan(0);
  });

  it("assigns a registration number when a legal workflow is registered", () => {
    const workflow = updateLegalWorkflowStatus({ workflowId: "roo-amac-11", status: "registered", reviewedBy: "Mobile Registry Supervisor" });
    expect(workflow.registrationNumber).toBeTruthy();
    expect(workflow.timeline.find((item) => item.key === "registered")?.completed).toBe(true);
  });
});
