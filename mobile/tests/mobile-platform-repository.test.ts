import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { cloneSeedBundle } from "../lib/mobile-data";
import { approveIdentityDocument, completeLivenessSession, getMobilePlatformBundle, reconcileParcelGeofenceReplay, startLivenessSession, updateLegalWorkflowStatus, updateMissionStatus, updateParcelGeofencePreference } from "../server/mobilePlatformRepository";

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

  it("requires an official registry reference before recording an unregistered workflow as registered", () => {
    expect(() => updateLegalWorkflowStatus({ workflowId: "roo-amac-11", status: "registered", reviewedBy: "Mobile Registry Supervisor" })).toThrow("official registry reference");
    const workflow = updateLegalWorkflowStatus({ workflowId: "roo-amac-11", status: "registered", reviewedBy: "Mobile Registry Supervisor", registryReference: "FCT-ROO-2026-0011" });
    expect(workflow.registrationNumber).toBe("FCT-ROO-2026-0011");
    expect(workflow.timeline.find((item) => item.key === "registered")?.completed).toBe(true);
  });

  it("does not allow a single-image session to mark liveness as verified", () => {
    const session = startLivenessSession();
    expect(() =>
      completeLivenessSession({
        sessionId: session.sessionId,
        status: "verified",
        framesAnalyzed: 1,
        motionScore: 99,
        faceQualityScore: 99,
        faceMatchScore: 99,
        confidence: 99,
        spoofDetected: false,
        verificationMethod: "single_image_screening",
      }),
    ).toThrow("challenge-video");
  });

  it("routes inbox KYC actions to manual review rather than silently verifying the document", () => {
    const result = approveIdentityDocument({ documentId: "kyc-seed-11" });
    expect(result.document.status).toBe("requires_review");
    expect(result.document.analysisProvenance).toBe("manual_review");
    expect(result.document.analysisReason).toContain("does not verify");
  });

  it("persists parcel geofence subscription changes through the notification preference store", () => {
    const preferences = updateParcelGeofencePreference({ parcelId: 11, enabled: true, radiusMeters: 250, transition: "exit" });
    const subscription = preferences.geofenceSubscriptions.find((item) => item.parcelId === 11);
    expect(subscription?.enabled).toBe(true);
    expect(subscription?.radiusMeters).toBe(250);
    expect(subscription?.transition).toBe("exit");
  });

  it("accepts newer offline geofence transitions and rejects stale or duplicate replay events", () => {
    const accepted = reconcileParcelGeofenceReplay({
      parcelId: 6,
      transition: "enter",
      radiusMeters: 150,
      latitude: 6.456,
      longitude: 3.601,
      triggeredAt: "2026-07-20T13:30:00Z",
    });
    expect(accepted.status).toBe("accepted");

    const duplicate = reconcileParcelGeofenceReplay({
      parcelId: 6,
      transition: "enter",
      radiusMeters: 150,
      latitude: 6.456,
      longitude: 3.601,
      triggeredAt: "2026-07-20T13:30:30Z",
    });
    expect(duplicate.status).toBe("duplicate");

    const stale = reconcileParcelGeofenceReplay({
      parcelId: 6,
      transition: "exit",
      radiusMeters: 150,
      latitude: 6.456,
      longitude: 3.601,
      triggeredAt: "2026-07-20T13:29:00Z",
    });
    expect(stale.status).toBe("stale");
  });
});
