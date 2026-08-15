import { describe, expect, it } from "vitest";

import { findMissionByParcel, findParcel, findWorkflowByParcel, legalWorkflows, missions, onboarding, parcels } from "../lib/mobile-data";

describe("mobile data layer", () => {
  it("provides seeded parcel records for native workflows", () => {
    expect(parcels.length).toBeGreaterThan(0);
    expect(findParcel(6)?.parcelNumber).toBe("LG-EPE-2026-006");
  });

  it("resolves mission and legal workflow context by parcel id", () => {
    expect(findMissionByParcel(6)?.id).toBe("mission-epe-6");
    expect(findWorkflowByParcel(6)?.registrationNumber).toBe("COFO-LA-EPE-2026-0006");
  });

  it("maintains onboarding and workflow coverage for the mobile shell", () => {
    expect(onboarding.readiness).toBeGreaterThan(0);
    expect(missions.some((mission) => mission.status !== "synced")).toBe(true);
    expect(legalWorkflows.some((workflow) => workflow.status === "registered")).toBe(true);
  });
});
