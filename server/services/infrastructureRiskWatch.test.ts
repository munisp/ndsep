/**
 * Round-13 P2.8 + P2.9 — infrastructure risk watch tests.
 * Feeds + db + ledger + outbox are fully mocked through the RiskWatchDeps seam.
 * Central invariants under test:
 *   - haversine sanity + proximity threshold matrix
 *   - vessel anomaly rule: slow/stationary AND near -> alert; fast transit -> none
 *   - acknowledge flow writes ledger + outbox and only transitions valid states
 *   - cable landing seed presence (6 points, provenance-stamped)
 *   - sweep degrades gracefully on missing tables / unavailable feeds
 */
import { describe, it, expect, vi } from "vitest";
import {
  haversineKm,
  earthquakeSeverity,
  fireSeverity,
  isCableWatchAnomaly,
  assessAvailabilityRisk,
  assessCableWatch,
  extractDeclarationLocations,
  acknowledgeInfrastructureRisk,
  runInfrastructureRiskSweep,
  CABLE_LANDING_SEED,
  CABLE_SEED_PROVENANCE,
  CABLE_ALERT_SIGNAL,
  INFRA_RISK_TOPIC,
  EARTHQUAKE_MIN_MAGNITUDE,
  EARTHQUAKE_RADIUS_KM,
  FIRE_RADIUS_KM,
  SEVERE_WEATHER_RADIUS_KM,
  CABLE_WATCH_RADIUS_KM,
  type RiskWatchDeps,
  type DeclaredLocation,
  type CablePoint,
} from "./infrastructureRiskWatch";
import type { OsirisVessel } from "../osiris/maritimeClient";

// ─── haversine ───────────────────────────────────────────────────────────────

describe("haversineKm", () => {
  it("computes known inter-city distances within tolerance", () => {
    // Lagos -> Abuja is ~536 km by great circle
    const d = haversineKm(6.5244, 3.3792, 9.0765, 7.3986);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(570);
  });
  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(6.44, 3.47, 6.44, 3.47)).toBe(0);
    expect(haversineKm(6.44, 3.47, 4.45, 7.17)).toBeCloseTo(haversineKm(4.45, 7.17, 6.44, 3.47), 10);
  });
  it("handles antimeridian and poles without NaN", () => {
    expect(Number.isFinite(haversineKm(0, 179.9, 0, -179.9))).toBe(true);
    expect(haversineKm(0, 179.9, 0, -179.9)).toBeLessThan(30);
    expect(Number.isFinite(haversineKm(89.9, 0, -89.9, 180))).toBe(true);
  });
});

// ─── threshold matrix (availability risk) ────────────────────────────────────

const LAGOS: DeclaredLocation = {
  declarationId: 1, entityRef: "RC-1", locationName: "Lagos DC",
  kind: "primary_dc", lat: 6.5244, lng: 3.3792,
  coordSource: "reference-map", coordProvenance: "test",
};

/** Offset a point roughly `km` east (valid near the equator-ish latitudes used here). */
function eastOf(lat: number, lng: number, km: number): { lat: number; lng: number } {
  return { lat, lng: lng + km / (111.32 * Math.cos((lat * Math.PI) / 180)) };
}

describe("assessAvailabilityRisk threshold matrix", () => {
  it(`earthquake M>=${EARTHQUAKE_MIN_MAGNITUDE} within ${EARTHQUAKE_RADIUS_KM}km -> risk; weaker/farther -> none`, () => {
    const near = eastOf(LAGOS.lat, LAGOS.lng, EARTHQUAKE_RADIUS_KM - 5);
    const far = eastOf(LAGOS.lat, LAGOS.lng, EARTHQUAKE_RADIUS_KM + 10);
    const feeds = {
      earthquakes: [
        { id: "q-near-strong", mag: 5.2, lat: near.lat, lng: near.lng, place: "x", ts: "t" },
        { id: "q-near-weak", mag: 4.4, lat: near.lat, lng: near.lng, place: "x", ts: "t" },
        { id: "q-far-strong", mag: 6.0, lat: far.lat, lng: far.lng, place: "x", ts: "t" },
        { id: "q-boundary", mag: EARTHQUAKE_MIN_MAGNITUDE, lat: near.lat, lng: near.lng, place: "x", ts: "t" },
      ],
      fires: [],
      weather: [],
    };
    const risks = assessAvailabilityRisk([LAGOS], feeds);
    const refs = risks.map((r) => r.eventRef).sort();
    expect(refs).toEqual(["q-boundary", "q-near-strong"]); // boundary magnitude inclusive
    const q = risks.find((r) => r.eventRef === "q-near-strong")!;
    expect(q.eventType).toBe("earthquake");
    expect(q.magnitude).toBe(5.2);
    expect(q.distanceKm).toBeLessThanOrEqual(EARTHQUAKE_RADIUS_KM);
  });

  it(`fire within ${FIRE_RADIUS_KM}km -> risk; beyond -> none`, () => {
    const near = eastOf(LAGOS.lat, LAGOS.lng, FIRE_RADIUS_KM - 2);
    const far = eastOf(LAGOS.lat, LAGOS.lng, FIRE_RADIUS_KM + 5);
    const risks = assessAvailabilityRisk([LAGOS], {
      earthquakes: [],
      fires: [
        { id: "f-near", lat: near.lat, lng: near.lng, frp: 120, brightness: null, ts: "t" },
        { id: "f-far", lat: far.lat, lng: far.lng, frp: 800, brightness: null, ts: "t" },
      ],
      weather: [],
    });
    expect(risks.map((r) => r.eventRef)).toEqual(["f-near"]);
    expect(risks[0].severity).toBe("high"); // 100 <= frp < 500
  });

  it(`severe weather within ${SEVERE_WEATHER_RADIUS_KM}km -> risk; beyond -> none`, () => {
    const near = eastOf(LAGOS.lat, LAGOS.lng, SEVERE_WEATHER_RADIUS_KM - 10);
    const far = eastOf(LAGOS.lat, LAGOS.lng, SEVERE_WEATHER_RADIUS_KM + 20);
    const risks = assessAvailabilityRisk([LAGOS], {
      earthquakes: [],
      fires: [],
      weather: [
        { id: "w-near", title: "Cyclone", category: "Tropical Cyclone", lat: near.lat, lng: near.lng, ts: "t" },
        { id: "w-far", title: "Storm", category: "Storm", lat: far.lat, lng: far.lng, ts: "t" },
      ],
    });
    expect(risks.map((r) => r.eventRef)).toEqual(["w-near"]);
    expect(risks[0].severity).toBe("Tropical Cyclone");
  });

  it("severity bands are sane", () => {
    expect(earthquakeSeverity(7.2)).toBe("critical");
    expect(earthquakeSeverity(6.1)).toBe("high");
    expect(earthquakeSeverity(5.0)).toBe("medium");
    expect(earthquakeSeverity(4.5)).toBe("low");
    expect(fireSeverity(null)).toBe("unknown");
    expect(fireSeverity(600)).toBe("critical");
    expect(fireSeverity(10)).toBe("low");
  });
});

// ─── vessel anomaly rules (cable watch) ──────────────────────────────────────

const LEKKI: CablePoint = { id: 1, cableSystem: "MainOne", name: "MainOne Cable Landing Station", lat: 6.4410, lng: 3.4730 };

function vessel(over: Partial<OsirisVessel>): OsirisVessel {
  return { mmsi: "123456789", name: "MV TEST", lat: 6.4411, lng: 3.4731, speed: 0.4, status: "anchored", ts: "t", ...over };
}

describe("cable watch anomaly rules", () => {
  it("slow + near -> anomaly", () => {
    expect(isCableWatchAnomaly(1.2, 0.5, "under way")).toBe(true);
  });
  it("stationary status + near -> anomaly even without speed", () => {
    expect(isCableWatchAnomaly(0.5, null, "anchored")).toBe(true);
    expect(isCableWatchAnomaly(0.5, null, "Moored")).toBe(true);
  });
  it("fast transit near -> no anomaly", () => {
    expect(isCableWatchAnomaly(0.5, 12.3, "under way")).toBe(false);
  });
  it("slow but outside radius -> no anomaly", () => {
    expect(isCableWatchAnomaly(CABLE_WATCH_RADIUS_KM + 0.5, 0.2, "anchored")).toBe(false);
  });
  it("no speed AND no status -> unverifiable, no anomaly", () => {
    expect(isCableWatchAnomaly(0.5, null, null)).toBe(false);
  });

  it("assessCableWatch: slow anchored vessel near Lekki alerts; fast transit does not", () => {
    const anchored = vessel({ mmsi: "111", speed: 0.3, status: "anchored" });
    const fast = vessel({ mmsi: "222", speed: 14.0, status: "under way" });
    const farAway = vessel({ mmsi: "333", lat: 6.5, lng: 3.55, speed: 0.2, status: "anchored" }); // >2km away
    const alerts = assessCableWatch([LEKKI], [anchored, fast, farAway]);
    expect(alerts.map((a) => a.vesselMmsi)).toEqual(["111"]);
    expect(alerts[0].cablePointName).toBe("MainOne Cable Landing Station");
    expect(alerts[0].distanceKm).toBeLessThanOrEqual(CABLE_WATCH_RADIUS_KM);
  });

  it("dedupes per (point, vessel) keeping the closest observation", () => {
    const v1 = vessel({ mmsi: "111", lat: 6.4420, lng: 3.4740, speed: 0.5 });
    const v2 = vessel({ mmsi: "111", lat: 6.44105, lng: 3.47305, speed: 0.5 }); // closer
    const alerts = assessCableWatch([LEKKI], [v1, v2]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].lat).toBeCloseTo(6.44105, 4);
  });
});

// ─── location derivation ─────────────────────────────────────────────────────

describe("extractDeclarationLocations", () => {
  it("prefers explicit declared coordinates, falls back to reference map", () => {
    const rows = [{
      id: 7, entity_ref: "RC-7",
      primary_dc_name: "Rack Centre", primary_dc_city: "Oregun, Lagos", primary_dc_country: "NG",
      backup_locations: [{ name: "DR Site", city: "Abuja", country: "NG", lat: 9.05, lng: 7.49 }],
      dr_locations: [],
    }];
    const out = extractDeclarationLocations(rows as any);
    expect(out.locations).toHaveLength(2);
    const primary = out.locations.find((l) => l.kind === "primary_dc")!;
    expect(primary.coordSource).toBe("reference-map");
    expect(primary.lat).toBeCloseTo(6.61, 2); // Rack Centre, Oregun
    const backup = out.locations.find((l) => l.kind === "backup")!;
    expect(backup.coordSource).toBe("declared");
    expect(backup.lat).toBeCloseTo(9.05, 5);
    expect(out.skippedNoCoordinates).toBe(0);
  });

  it("skips and counts declarations whose locations have no resolvable coordinates", () => {
    const rows = [{
      id: 8, entity_ref: "RC-8",
      primary_dc_name: "Unknown DC", primary_dc_city: "Nowhereville", primary_dc_country: "NG",
      backup_locations: "not-json", dr_locations: [],
    }];
    const out = extractDeclarationLocations(rows as any);
    expect(out.locations).toHaveLength(0);
    expect(out.skippedNoCoordinates).toBe(1);
    expect(out.distinctLocationCount).toBe(0);
  });

  it("counts DISTINCT locations across declarations", () => {
    const mk = (id: number) => ({
      id, entity_ref: `RC-${id}`, primary_dc_name: "DC", primary_dc_city: "Lagos",
      primary_dc_country: "NG", backup_locations: [], dr_locations: [],
    });
    const out = extractDeclarationLocations([mk(1), mk(2)] as any);
    expect(out.locations).toHaveLength(2);
    expect(out.distinctLocationCount).toBe(1); // both resolve to Lagos centroid
  });
});

// ─── seed presence ───────────────────────────────────────────────────────────

describe("cable landing seed", () => {
  it("has exactly 6 provenance-stamped Nigerian landing points", () => {
    expect(CABLE_LANDING_SEED).toHaveLength(6);
    const systems = CABLE_LANDING_SEED.map((s) => s.cableSystem).sort();
    expect(systems).toEqual(["2Africa", "ACE", "Glo-1", "MainOne", "SAT-3", "WACS"]);
    for (const p of CABLE_LANDING_SEED) {
      expect(p.provenance).toBe(CABLE_SEED_PROVENANCE);
      expect(p.note).toContain("approximate");
      expect(p.country).toBe("NG");
      expect(p.lat).toBeGreaterThan(3.5);
      expect(p.lat).toBeLessThan(7.5);
      expect(p.lng).toBeGreaterThan(2.5);
      expect(p.lng).toBeLessThan(8.5);
    }
  });
  it("Lekki points cluster near 6.44N 3.47E; SAT-3 near Bonny 4.45N 7.17E", () => {
    const lekki = CABLE_LANDING_SEED.filter((p) => p.city.includes("Lagos"));
    expect(lekki).toHaveLength(5);
    for (const p of lekki) {
      expect(Math.abs(p.lat - 6.44)).toBeLessThan(0.05);
      expect(Math.abs(p.lng - 3.47)).toBeLessThan(0.05);
    }
    const sat3 = CABLE_LANDING_SEED.find((p) => p.cableSystem === "SAT-3")!;
    expect(Math.abs(sat3.lat - 4.45)).toBeLessThan(0.05);
    expect(Math.abs(sat3.lng - 7.17)).toBeLessThan(0.05);
  });
  it("early-warning signal copy is fixed", () => {
    expect(CABLE_ALERT_SIGNAL).toBe(
      "possible anchoring/trawling risk near cable landing — physical-layer resilience"
    );
  });
});

// ─── acknowledge flow + audit write ──────────────────────────────────────────

function makeDeps(over: Partial<RiskWatchDeps> = {}): RiskWatchDeps & { calls: { ledger: any[]; publish: any[]; sql: string[] } } {
  const calls = { ledger: [] as any[], publish: [] as any[], sql: [] as string[] };
  return {
    calls,
    exec: vi.fn(async (q: string) => { calls.sql.push(q); return []; }) as any,
    fetchEarthquakes: vi.fn(async () => []),
    fetchFires: vi.fn(async () => []),
    fetchSevereWeather: vi.fn(async () => []),
    fetchVesselsInArea: vi.fn(async () => []),
    publish: vi.fn(async (t: string, k: string | null, v: any) => { calls.publish.push({ t, k, v }); return true; }),
    ledger: vi.fn(async (a: string, p: any, actor: string | null) => { calls.ledger.push({ a, p, actor }); return {}; }),
    now: () => new Date("2026-10-20T00:00:00Z"),
    ...over,
  };
}

describe("acknowledgeInfrastructureRisk", () => {
  it("transitions open -> acknowledged, writes ledger + outbox", async () => {
    const deps = makeDeps({
      exec: vi.fn(async (q: string) => q.includes("UPDATE availability_risk_events")
        ? [{ id: "uuid-1", status: "acknowledged" }] : []) as any,
    });
    const res = await acknowledgeInfrastructureRisk(
      { kind: "availability", id: "uuid-1", actor: "officer-9" }, deps);
    expect(res?.status).toBe("acknowledged");
    expect(deps.calls.ledger).toHaveLength(1);
    expect(deps.calls.ledger[0].a).toBe("infrastructure_risk_availability_acknowledged");
    expect(deps.calls.ledger[0].actor).toBe("officer-9");
    expect(deps.calls.publish).toHaveLength(1);
    expect(deps.calls.publish[0].t).toBe(INFRA_RISK_TOPIC);
    expect(deps.calls.publish[0].v.event).toBe("infra_risk.availability.acknowledged");
  });

  it("acknowledged -> closed works; terminal re-acknowledge returns null", async () => {
    const deps = makeDeps({
      exec: vi.fn(async (q: string, params?: any[]) =>
        q.includes("UPDATE cable_watch_alerts") && params![1] === "closed"
          ? [{ id: "uuid-2", status: "closed" }] : []) as any,
    });
    const closed = await acknowledgeInfrastructureRisk(
      { kind: "cable", id: "uuid-2", targetStatus: "closed", actor: "officer-9" }, deps);
    expect(closed?.status).toBe("closed");
    const again = await acknowledgeInfrastructureRisk(
      { kind: "cable", id: "uuid-2", targetStatus: "acknowledged", actor: "officer-9" }, deps);
    expect(again).toBeNull(); // no row matched the FROM-status filter
  });

  it("degrades to null when migration 0148 is missing (42P01)", async () => {
    const deps = makeDeps({
      exec: vi.fn(async () => { const e: any = new Error("missing"); e.code = "42P01"; throw e; }) as any,
    });
    const res = await acknowledgeInfrastructureRisk({ kind: "availability", id: "x", actor: "a" }, deps);
    expect(res).toBeNull();
    expect(deps.calls.ledger).toHaveLength(0);
  });
});

// ─── sweep orchestration (mocked feeds + db) ─────────────────────────────────

describe("runInfrastructureRiskSweep", () => {
  const declRow = {
    id: 42, entity_ref: "RC-42",
    primary_dc_name: "Lagos DC", primary_dc_city: "Lagos", primary_dc_country: "NG",
    backup_locations: [], dr_locations: [],
  };
  const pointRow = { id: 1, cable_system: "MainOne", name: "MainOne Cable Landing Station", latitude: 6.4410, longitude: 3.4730 };

  function sweepDeps(over: Partial<RiskWatchDeps>) {
    const deps = makeDeps({
      exec: vi.fn(async (q: string) => {
        if (q.includes("FROM hosting_declarations")) return [declRow];
        if (q.includes("FROM cable_landing_points")) return [pointRow];
        if (q.includes("INSERT INTO availability_risk_events")) return [{ id: "are-1", is_new: true }];
        if (q.includes("INSERT INTO cable_watch_alerts")) return [{ id: "cwa-1", is_new: true }];
        return [];
      }) as any,
      ...over,
    });
    return deps;
  }

  it("persists availability risks + cable alerts, ledger+outbox per new alert", async () => {
    const nearQuake = { id: "q1", mag: 5.5, lat: 6.6, lng: 3.45, place: "offshore Lagos", ts: "t" };
    const anchoredVessel = vessel({ mmsi: "999", speed: 0.2, status: "anchored" });
    const deps = sweepDeps({
      fetchEarthquakes: vi.fn(async () => [nearQuake]),
      fetchFires: vi.fn(async () => []),
      fetchSevereWeather: vi.fn(async () => []),
      fetchVesselsInArea: vi.fn(async () => [anchoredVessel]),
    });
    const summary = await runInfrastructureRiskSweep(deps);
    expect(summary.declarationsConsidered).toBe(1);
    expect(summary.distinctLocationsAssessed).toBe(1);
    expect(summary.newAvailabilityRisks).toBe(1);
    expect(summary.newCableAlerts).toBe(1);
    expect(summary.feeds.earthquakes).toBe(1);
    expect(summary.feeds.maritime).toBe(1);
    // one ledger + outbox per new alert (2 alerts total)
    expect(deps.calls.ledger).toHaveLength(2);
    expect(deps.calls.publish).toHaveLength(2);
    expect(deps.calls.publish.every((c) => c.t === INFRA_RISK_TOPIC)).toBe(true);
    const cablePayload = deps.calls.publish.find((c) => c.v.kind === "cable_watch");
    expect(cablePayload.v.signal).toBe(CABLE_ALERT_SIGNAL);
  });

  it("feed outage -> null counts, no rows, no phantom all-clear", async () => {
    const deps = sweepDeps({
      fetchEarthquakes: vi.fn(async () => null),
      fetchFires: vi.fn(async () => null),
      fetchSevereWeather: vi.fn(async () => null),
      fetchVesselsInArea: vi.fn(async () => null),
    });
    const summary = await runInfrastructureRiskSweep(deps);
    expect(summary.feeds.earthquakes).toBeNull();
    expect(summary.feeds.maritime).toBeNull();
    expect(summary.newAvailabilityRisks).toBe(0);
    expect(summary.newCableAlerts).toBe(0);
    expect(deps.calls.ledger).toHaveLength(0);
  });

  it("missing tables -> tableMissing no-op", async () => {
    const deps = sweepDeps({
      exec: vi.fn(async () => { const e: any = new Error("missing"); e.code = "42P01"; throw e; }) as any,
    });
    const summary = await runInfrastructureRiskSweep(deps);
    expect(summary.tableMissing).toBe(true);
    expect(summary.newAvailabilityRisks).toBe(0);
  });

  it("declaration without resolvable coordinates is counted, not guessed", async () => {
    const deps = sweepDeps({
      exec: vi.fn(async (q: string) => {
        if (q.includes("FROM hosting_declarations")) return [{
          id: 43, entity_ref: "RC-43", primary_dc_name: "Mystery DC",
          primary_dc_city: "Nowhereville", primary_dc_country: "NG",
          backup_locations: [], dr_locations: [],
        }];
        if (q.includes("FROM cable_landing_points")) return [pointRow];
        return [];
      }) as any,
      fetchVesselsInArea: vi.fn(async () => []),
    });
    const summary = await runInfrastructureRiskSweep(deps);
    expect(summary.declarationsSkippedNoCoordinates).toBe(1);
    expect(summary.distinctLocationsAssessed).toBe(0);
  });
});
