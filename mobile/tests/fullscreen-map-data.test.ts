import { describe, expect, it } from "vitest";

import { countTitleMix, filterParcelsForState, filterSupportedStateParcels, overlayDefinitions, stateDefinitions, stateKeyFromParcel, toggleLayer, toggleOverlay } from "../lib/fullscreen-map-data";
import type { ParcelRecord } from "../lib/mobile-data";

const parcels: ParcelRecord[] = [
  {
    id: 6,
    parcelNumber: "LG-EPE-2026-006",
    owner: "Amina Yusuf",
    state: "Lagos",
    lga: "Epe",
    areaHectares: 1.42,
    titleStatus: "registered",
    workflowStage: "registered",
    latitude: 6.583,
    longitude: 3.983,
    riskScore: 18,
    lastAction: "Registered",
    geolibreReady: true,
  },
  {
    id: 11,
    parcelNumber: "FC-AMAC-2026-011",
    owner: "Crest Meridian Housing Cooperative",
    state: "FCT",
    lga: "AMAC",
    areaHectares: 12.8,
    titleStatus: "pending",
    workflowStage: "issuance",
    latitude: 9.0765,
    longitude: 7.3986,
    riskScore: 46,
    lastAction: "Pending review",
    geolibreReady: true,
  },
  {
    id: 15,
    parcelNumber: "KN-NASS-2026-015",
    owner: "Musa Garba",
    state: "Kano",
    lga: "Nassarawa",
    areaHectares: 0.88,
    titleStatus: "under_review",
    workflowStage: "verification",
    latitude: 11.988,
    longitude: 8.525,
    riskScore: 27,
    lastAction: "Queued field evidence",
    geolibreReady: false,
  },
  {
    id: 22,
    parcelNumber: "OG-IFO-2026-022",
    owner: "TransitWorks Consortium",
    state: "Ogun",
    lga: "Ifo",
    areaHectares: 47.3,
    titleStatus: "under_review",
    workflowStage: "verification",
    latitude: 6.815,
    longitude: 3.195,
    riskScore: 62,
    lastAction: "Out of scope for state map",
    geolibreReady: true,
  },
];

describe("fullscreen map state data helpers", () => {
  it("defines the three state-specific map datasets", () => {
    expect(stateDefinitions.map((state) => state.key)).toEqual(["lagos", "fct", "kano"]);
    expect(stateDefinitions.every((state) => state.boundary.length >= 4)).toBe(true);
    expect(stateDefinitions.every((state) => state.districtLines.length >= 1)).toBe(true);
  });

  it("maps parcels to supported state keys", () => {
    expect(stateKeyFromParcel(parcels[0])).toBe("lagos");
    expect(stateKeyFromParcel(parcels[1])).toBe("fct");
    expect(stateKeyFromParcel(parcels[2])).toBe("kano");
    expect(stateKeyFromParcel(parcels[3])).toBeNull();
  });

  it("filters supported parcels and parcels for each state", () => {
    expect(filterSupportedStateParcels(parcels).map((parcel) => parcel.id)).toEqual([6, 11, 15]);
    expect(filterParcelsForState(parcels, "lagos").map((parcel) => parcel.id)).toEqual([6]);
    expect(filterParcelsForState(parcels, "fct").map((parcel) => parcel.id)).toEqual([11]);
    expect(filterParcelsForState(parcels, "kano").map((parcel) => parcel.id)).toEqual([15]);
  });

  it("counts title mix correctly for a selected state dataset", () => {
    expect(countTitleMix(filterSupportedStateParcels(parcels))).toEqual({
      registered: 1,
      pending: 1,
      under_review: 1,
    });
  });

  it("toggles overlays and layers without duplicating entries", () => {
    expect(toggleOverlay(["housing", "row"], "row")).toEqual(["housing"]);
    expect(toggleOverlay(["housing"], "mining")).toEqual(["housing", "mining"]);
    expect(toggleLayer(["parcels", "boundaries"], "boundaries")).toEqual(["parcels"]);
    expect(toggleLayer(["parcels"], "districts")).toEqual(["parcels", "districts"]);
  });

  it("keeps the required corridor overlay definitions for stakeholder map review", () => {
    expect(overlayDefinitions.map((overlay) => overlay.key)).toEqual([
      "housing",
      "row",
      "mining",
      "infrastructure",
    ]);
  });
});
