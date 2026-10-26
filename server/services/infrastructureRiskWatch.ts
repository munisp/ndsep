/**
 * Infrastructure Risk Watch (Round-13 P2.8 + P2.9)
 * ===================================================================
 * Two early-warning surfaces over OSIRIS physical-world feeds:
 *
 *   (a) AVAILABILITY RISK — disaster-driven availability risk for the
 *       data-center locations declared on hosting declarations
 *       (hosting_declarations, migration 0094). Coordinates are DERIVED
 *       from the declarations' declared location fields: explicit lat/lng
 *       keys on the JSONB location objects win; otherwise a small curated
 *       reference map of well-known Nigerian DC/city coordinates is used
 *       (KNOWN_LOCATION_COORDS, each entry provenance-noted). Geocoding is
 *       OUT OF SCOPE — declarations whose locations resolve to no
 *       coordinates are skipped and counted (never guessed).
 *
 *       Proximity thresholds (haversine):
 *         earthquake      M >= 4.5 within 100 km
 *         fire            FIRMS hotspot within 50 km
 *         severe_weather  EONET severe event within 150 km
 *       Persisted to availability_risk_events (migration 0148); repeat
 *       sweeps upsert (no duplicates).
 *
 *   (b) CABLE-LANDING WATCH — maritime anomaly watch near Nigeria's
 *       submarine cable landings (cable_landing_points seed, migration
 *       0148, provenance 'public-approx-2026-10'). A vessel within 2 km of
 *       a landing point AND (speed < 1 kt OR nav status anchoring/moored)
 *       raises a cable_watch_alerts row. This is an EARLY-WARNING signal
 *       only — "possible anchoring/trawling risk near cable landing —
 *       physical-layer resilience" — never an accusation. Repeat sightings
 *       update last_seen_at instead of duplicating.
 *
 * GRACEFUL DEGRADATION: any unavailable OSIRIS feed (null from the
 * clients) is recorded in the sweep summary as an outage — it never
 * produces phantom "all clear" state. Missing tables (migration not yet
 * applied) degrade to empty results with a note.
 *
 * Every NEW alert appends to the hash-chained audit_ledger
 * (server/antiwipe/ledger.ts) and publishes ndsep.sovereignty.infra_risk
 * via the durable outbox (server/kafka.ts publishWithOutbox).
 *
 * Scheduling: runInfrastructureRiskSweep() is a plain exported async
 * function — the integrator wires it into Temporal/scheduler of choice;
 * workers/temporal is NOT touched here.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { publishWithOutbox } from "../kafka";
import { appendLedger } from "../antiwipe/ledger";
import {
  fetchEarthquakes,
  fetchFires,
  fetchSevereWeather,
  type OsirisEarthquake,
  type OsirisFireHotspot,
  type OsirisSevereWeatherEvent,
} from "../osiris/disasterClient";
import { fetchVesselsInArea, type OsirisVessel } from "../osiris/maritimeClient";

// ─── Vocabulary / thresholds ─────────────────────────────────────────────────

export const AVAILABILITY_EVENT_TYPES = ["earthquake", "fire", "severe_weather"] as const;
export type AvailabilityEventType = (typeof AVAILABILITY_EVENT_TYPES)[number];

export const RISK_STATUSES = ["open", "acknowledged", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const EARTHQUAKE_MIN_MAGNITUDE = 4.5;
export const EARTHQUAKE_RADIUS_KM = 100;
export const FIRE_RADIUS_KM = 50;
export const SEVERE_WEATHER_RADIUS_KM = 150;

export const CABLE_WATCH_RADIUS_KM = 2;
export const CABLE_SLOW_SPEED_KNOTS = 1;
/** Nav statuses treated as stationary (OSIRIS narrows to lower-case). */
export const STATIONARY_VESSEL_STATUSES = ["anchored", "anchoring", "moored", "mooring", "at anchor"] as const;

export const INFRA_RISK_TOPIC = "ndsep.sovereignty.infra_risk";

/** Canonical early-warning copy — do not editorialize beyond this. */
export const CABLE_ALERT_SIGNAL =
  "possible anchoring/trawling risk near cable landing — physical-layer resilience";

// ─── Cable landing seed (mirrors migration 0148 seed — reference data) ──────

export interface CableLandingSeed {
  cableSystem: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  provenance: string;
  note: string;
}

export const CABLE_SEED_PROVENANCE = "public-approx-2026-10";
export const CABLE_SEED_NOTE = "approximate — public sources";

/**
 * The six Nigerian submarine-cable landing points seeded by migration 0148.
 * Coordinates are APPROXIMATE, compiled from public sources — watch anchors,
 * not engineering survey data.
 */
export const CABLE_LANDING_SEED: CableLandingSeed[] = [
  { cableSystem: "MainOne", name: "MainOne Cable Landing Station", city: "Lekki, Lagos", country: "NG", lat: 6.4410, lng: 3.4730, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
  { cableSystem: "Glo-1", name: "Glo-1 Landing Station", city: "Alpha Beach, Lagos", country: "NG", lat: 6.4300, lng: 3.4400, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
  { cableSystem: "WACS", name: "WACS Landing Station", city: "Lekki, Lagos", country: "NG", lat: 6.4400, lng: 3.4700, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
  { cableSystem: "ACE", name: "ACE Landing Station", city: "Lekki, Lagos", country: "NG", lat: 6.4415, lng: 3.4725, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
  { cableSystem: "2Africa", name: "2Africa Landing Station", city: "Lekki, Lagos", country: "NG", lat: 6.4405, lng: 3.4735, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
  { cableSystem: "SAT-3", name: "SAT-3 Landing Station", city: "Bonny Island", country: "NG", lat: 4.4520, lng: 7.1680, provenance: CABLE_SEED_PROVENANCE, note: CABLE_SEED_NOTE },
];

// ─── Curated coordinate reference (geocoding is OUT OF SCOPE) ───────────────

interface KnownCoordinate {
  lat: number;
  lng: number;
  provenance: string;
}

/**
 * Small curated map of well-known Nigerian locations → approximate
 * coordinates. ONLY entries with publicly well-known coordinates are
 * listed; anything else is skipped (and counted) rather than guessed.
 * Matching is case-insensitive substring against the declared
 * location name, then city.
 */
export const KNOWN_LOCATION_COORDS: Record<string, KnownCoordinate> = {
  "rack centre": { lat: 6.6100, lng: 3.3600, provenance: "public-approx — Rack Centre, Oregun, Lagos" },
  "mdxi": { lat: 6.4470, lng: 3.4720, provenance: "public-approx — MDXi Lekki data center" },
  "lekki": { lat: 6.4400, lng: 3.4700, provenance: "public-approx — Lekki, Lagos" },
  "lagos": { lat: 6.5244, lng: 3.3792, provenance: "public — Lagos city centroid" },
  "abuja": { lat: 9.0765, lng: 7.3986, provenance: "public — Abuja city centroid" },
  "ibadan": { lat: 7.3775, lng: 3.9470, provenance: "public — Ibadan city centroid" },
  "port harcourt": { lat: 4.8156, lng: 7.0498, provenance: "public — Port Harcourt city centroid" },
  "kano": { lat: 12.0022, lng: 8.5920, provenance: "public — Kano city centroid" },
  "bonny": { lat: 4.4520, lng: 7.1680, provenance: "public-approx — Bonny Island" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

/** A declared hosting location with derived coordinates. */
export interface DeclaredLocation {
  declarationId: number;
  entityRef: string;
  locationName: string;
  kind: "primary_dc" | "backup" | "dr";
  lat: number;
  lng: number;
  /** Where the coordinates came from — never silent. */
  coordSource: "declared" | "reference-map";
  coordProvenance: string;
}

export interface DisasterFeeds {
  earthquakes: OsirisEarthquake[];
  fires: OsirisFireHotspot[];
  weather: OsirisSevereWeatherEvent[];
}

export interface AvailabilityRisk {
  declarationId: number;
  entityRef: string;
  locationName: string;
  lat: number;
  lng: number;
  eventType: AvailabilityEventType;
  eventRef: string;
  magnitude: number | null;
  severity: string;
  distanceKm: number;
}

export interface CablePoint {
  id: number;
  cableSystem: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CableAlert {
  cablePointId: number;
  cablePointName: string;
  cableSystem: string;
  vesselMmsi: string;
  vesselName: string | null;
  lat: number;
  lng: number;
  speedKnots: number | null;
  vesselStatus: string | null;
  distanceKm: number;
}

// ─── Pure helpers (unit-tested directly) ─────────────────────────────────────

/** Great-circle distance in km (haversine, mean earth radius 6371 km). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Magnitude → severity band for earthquake availability risks. */
export function earthquakeSeverity(mag: number): string {
  if (mag >= 7) return "critical";
  if (mag >= 6) return "high";
  if (mag >= 5) return "medium";
  return "low";
}

/** Fire radiative power → severity band (null FRP → 'unknown'). */
export function fireSeverity(frp: number | null): string {
  if (frp == null) return "unknown";
  if (frp >= 500) return "critical";
  if (frp >= 100) return "high";
  if (frp >= 20) return "medium";
  return "low";
}

/**
 * Vessel anomaly rule for the cable-landing watch:
 * within CABLE_WATCH_RADIUS_KM of the point AND
 * (speed < CABLE_SLOW_SPEED_KNOTS OR nav status is stationary).
 * Both signals absent (null speed AND null status) → no alert (unverifiable).
 */
export function isCableWatchAnomaly(distanceKm: number, speedKnots: number | null, status: string | null): boolean {
  if (distanceKm > CABLE_WATCH_RADIUS_KM) return false;
  const slow = speedKnots != null && speedKnots < CABLE_SLOW_SPEED_KNOTS;
  const stationary = status != null &&
    (STATIONARY_VESSEL_STATUSES as readonly string[]).includes(status.toLowerCase());
  return slow || stationary;
}

// ─── Pure core (a): availability risk triangulation ─────────────────────────

export function assessAvailabilityRisk(
  locations: DeclaredLocation[],
  feeds: DisasterFeeds,
): AvailabilityRisk[] {
  const risks: AvailabilityRisk[] = [];
  for (const loc of locations) {
    for (const q of feeds.earthquakes) {
      if (q.mag < EARTHQUAKE_MIN_MAGNITUDE) continue;
      const d = haversineKm(loc.lat, loc.lng, q.lat, q.lng);
      if (d > EARTHQUAKE_RADIUS_KM) continue;
      risks.push({
        declarationId: loc.declarationId,
        entityRef: loc.entityRef,
        locationName: loc.locationName,
        lat: loc.lat,
        lng: loc.lng,
        eventType: "earthquake",
        eventRef: q.id,
        magnitude: q.mag,
        severity: earthquakeSeverity(q.mag),
        distanceKm: Math.round(d * 100) / 100,
      });
    }
    for (const f of feeds.fires) {
      const d = haversineKm(loc.lat, loc.lng, f.lat, f.lng);
      if (d > FIRE_RADIUS_KM) continue;
      risks.push({
        declarationId: loc.declarationId,
        entityRef: loc.entityRef,
        locationName: loc.locationName,
        lat: loc.lat,
        lng: loc.lng,
        eventType: "fire",
        eventRef: f.id,
        magnitude: null,
        severity: fireSeverity(f.frp),
        distanceKm: Math.round(d * 100) / 100,
      });
    }
    for (const w of feeds.weather) {
      const d = haversineKm(loc.lat, loc.lng, w.lat, w.lng);
      if (d > SEVERE_WEATHER_RADIUS_KM) continue;
      risks.push({
        declarationId: loc.declarationId,
        entityRef: loc.entityRef,
        locationName: loc.locationName,
        lat: loc.lat,
        lng: loc.lng,
        eventType: "severe_weather",
        eventRef: w.id,
        magnitude: null,
        severity: w.category || "severe",
        distanceKm: Math.round(d * 100) / 100,
      });
    }
  }
  return risks;
}

// ─── Pure core (b): cable-landing watch ──────────────────────────────────────

export function assessCableWatch(points: CablePoint[], vessels: OsirisVessel[]): CableAlert[] {
  /** Keep the closest observation per (point, vessel). */
  const best = new Map<string, CableAlert>();
  for (const point of points) {
    for (const v of vessels) {
      const d = haversineKm(point.lat, point.lng, v.lat, v.lng);
      if (!isCableWatchAnomaly(d, v.speed, v.status)) continue;
      const key = `${point.id}:${v.mmsi}`;
      const existing = best.get(key);
      if (existing && existing.distanceKm <= d) continue;
      best.set(key, {
        cablePointId: point.id,
        cablePointName: point.name,
        cableSystem: point.cableSystem,
        vesselMmsi: v.mmsi,
        vesselName: v.name,
        lat: v.lat,
        lng: v.lng,
        speedKnots: v.speed,
        vesselStatus: v.status,
        distanceKm: Math.round(d * 1000) / 1000,
      });
    }
  }
  return Array.from(best.values());
}

// ─── Location derivation (declared fields → coordinates) ────────────────────

interface RawDeclarationRow {
  id: number;
  entity_ref: string;
  primary_dc_name: string | null;
  primary_dc_city: string | null;
  primary_dc_country: string | null;
  backup_locations: unknown;
  dr_locations: unknown;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function validLatLng(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function lookupKnown(name: string | null, city: string | null): KnownCoordinate | null {
  for (const candidate of [name, city]) {
    if (!candidate) continue;
    const norm = candidate.toLowerCase();
    for (const [key, coord] of Object.entries(KNOWN_LOCATION_COORDS)) {
      if (norm.includes(key)) return coord;
    }
  }
  return null;
}

interface RawLocation {
  kind: "primary_dc" | "backup" | "dr";
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

function parseLocationArray(v: unknown, kind: "backup" | "dr"): RawLocation[] {
  const arr = typeof v === "string" ? safeParse(v) : v;
  if (!Array.isArray(arr)) return [];
  const out: RawLocation[] = [];
  for (const item of arr) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    out.push({
      kind,
      name: typeof rec.name === "string" ? rec.name : null,
      city: typeof rec.city === "string" ? rec.city : null,
      country: typeof rec.country === "string" ? rec.country : null,
      lat: num(rec.lat ?? rec.latitude),
      lng: num(rec.lng ?? rec.lon ?? rec.longitude),
    });
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export interface LocationExtraction {
  locations: DeclaredLocation[];
  /** Declarations with at least one location field but zero resolvable coordinates. */
  skippedNoCoordinates: number;
  /** DISTINCT coordinate keys actually assessed (dedup across declarations). */
  distinctLocationCount: number;
}

/**
 * Derive coordinates for every location declared on a hosting declaration.
 * Explicit lat/lng on the location object wins; otherwise the curated
 * reference map; otherwise the declaration location is skipped (counted).
 */
export function extractDeclarationLocations(rows: RawDeclarationRow[]): LocationExtraction {
  const locations: DeclaredLocation[] = [];
  let skippedNoCoordinates = 0;

  for (const row of rows) {
    const all: RawLocation[] = [
      {
        kind: "primary_dc",
        name: row.primary_dc_name,
        city: row.primary_dc_city,
        country: row.primary_dc_country,
        lat: null,
        lng: null,
      },
      ...parseLocationArray(row.backup_locations, "backup"),
      ...parseLocationArray(row.dr_locations, "dr"),
    ];
    const raws = all.filter((l) => l.name || l.city);

    let resolved = 0;
    for (const raw of raws) {
      const explicit = validLatLng(raw.lat, raw.lng);
      const known = explicit ? null : lookupKnown(raw.name, raw.city);
      if (!explicit && !known) continue;
      const lat = explicit ? explicit.lat : known!.lat;
      const lng = explicit ? explicit.lng : known!.lng;
      locations.push({
        declarationId: Number(row.id),
        entityRef: String(row.entity_ref),
        locationName: raw.name ?? raw.city ?? "unnamed location",
        kind: raw.kind,
        lat,
        lng,
        coordSource: explicit ? "declared" : "reference-map",
        coordProvenance: explicit ? "declared on hosting declaration" : known!.provenance,
      });
      resolved++;
    }
    if (raws.length > 0 && resolved === 0) skippedNoCoordinates++;
  }

  const distinct = new Set(locations.map((l) => `${l.lat.toFixed(3)}:${l.lng.toFixed(3)}`));
  return { locations, skippedNoCoordinates, distinctLocationCount: distinct.size };
}

// ─── Dependency injection (tests mock feeds + db through this seam) ─────────

export interface RiskWatchDeps {
  exec: (query: string, params?: unknown[]) => Promise<any[]>;
  fetchEarthquakes: () => Promise<OsirisEarthquake[] | null>;
  fetchFires: () => Promise<OsirisFireHotspot[] | null>;
  fetchSevereWeather: () => Promise<OsirisSevereWeatherEvent[] | null>;
  fetchVesselsInArea: (lat: number, lng: number, radiusKm: number) => Promise<OsirisVessel[] | null>;
  publish: (topic: string, key: string | null, value: Record<string, unknown>) => Promise<unknown>;
  ledger: (action: string, payload: unknown, actor: string | null) => Promise<unknown>;
  now: () => Date;
}

export function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function defaultExec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const result = await pool.query(query, params);
  return result.rows ?? [];
}

function defaultDeps(): RiskWatchDeps {
  return {
    exec: defaultExec,
    fetchEarthquakes,
    fetchFires,
    fetchSevereWeather,
    fetchVesselsInArea,
    publish: (t, k, v) => publishWithOutbox(t, k, v),
    ledger: (a, p, actor) => appendLedger(a, p, actor),
    now: () => new Date(),
  };
}

// ─── Sweep orchestration ─────────────────────────────────────────────────────

export interface SweepSummary {
  declarationsConsidered: number;
  declarationsSkippedNoCoordinates: number;
  distinctLocationsAssessed: number;
  feeds: {
    earthquakes: number | null; // null = feed unavailable (recorded, never phantom-clear)
    fires: number | null;
    severeWeather: number | null;
    maritime: number | null;
  };
  cablePointsWatched: number;
  newAvailabilityRisks: number;
  refreshedAvailabilityRisks: number;
  newCableAlerts: number;
  refreshedCableAlerts: number;
  tableMissing: boolean;
  sweptAt: string;
}

/**
 * Run one full infrastructure-risk sweep. Plainly-named async function —
 * the integrator wires scheduling (Temporal) separately.
 */
export async function runInfrastructureRiskSweep(
  deps: RiskWatchDeps = defaultDeps(),
): Promise<SweepSummary> {
  const sweptAt = deps.now().toISOString();
  const summary: SweepSummary = {
    declarationsConsidered: 0,
    declarationsSkippedNoCoordinates: 0,
    distinctLocationsAssessed: 0,
    feeds: { earthquakes: null, fires: null, severeWeather: null, maritime: null },
    cablePointsWatched: 0,
    newAvailabilityRisks: 0,
    refreshedAvailabilityRisks: 0,
    newCableAlerts: 0,
    refreshedCableAlerts: 0,
    tableMissing: false,
    sweptAt,
  };

  // ── Load declarations + cable points (degrade on missing tables) ────────
  let declarationRows: RawDeclarationRow[] = [];
  let cablePointRows: Array<Record<string, unknown>> = [];
  try {
    declarationRows = await deps.exec(
      `SELECT id, entity_ref, primary_dc_name, primary_dc_city, primary_dc_country,
              backup_locations, dr_locations
         FROM hosting_declarations
        WHERE in_scope = TRUE AND declaration_status <> 'rejected'`,
    );
    cablePointRows = await deps.exec(
      `SELECT id, cable_system, name, latitude, longitude FROM cable_landing_points WHERE active = TRUE`,
    );
  } catch (err) {
    if (isMissingTable(err)) {
      logger.warn("[infraRiskWatch] migration 0148 (or 0094) not applied — sweep degraded to no-op");
      summary.tableMissing = true;
      return summary;
    }
    throw err;
  }

  summary.declarationsConsidered = declarationRows.length;
  const extraction = extractDeclarationLocations(declarationRows);
  summary.declarationsSkippedNoCoordinates = extraction.skippedNoCoordinates;
  summary.distinctLocationsAssessed = extraction.distinctLocationCount;

  const cablePoints: CablePoint[] = cablePointRows.map((r) => ({
    id: Number(r.id),
    cableSystem: String(r.cable_system),
    name: String(r.name),
    lat: Number(r.latitude),
    lng: Number(r.longitude),
  }));
  summary.cablePointsWatched = cablePoints.length;

  // ── Fetch OSIRIS feeds (null = outage, recorded — never phantom-clear) ──
  const [earthquakes, fires, weather] = await Promise.all([
    deps.fetchEarthquakes(),
    deps.fetchFires(),
    deps.fetchSevereWeather(),
  ]);
  summary.feeds.earthquakes = earthquakes ? earthquakes.length : null;
  summary.feeds.fires = fires ? fires.length : null;
  summary.feeds.severeWeather = weather ? weather.length : null;

  // Maritime: one area fetch per DISTINCT cable-point neighbourhood (the
  // client cache collapses identical rounded coordinates, e.g. Lekki).
  const vesselsByArea = new Map<string, OsirisVessel[] | null>();
  const seenAreas = new Set<string>();
  let maritimeTotal = 0;
  let maritimeUnavailable = false;
  for (const point of cablePoints) {
    const areaKey = `${point.lat.toFixed(2)}:${point.lng.toFixed(2)}`;
    if (seenAreas.has(areaKey)) continue;
    seenAreas.add(areaKey);
    const vessels = await deps.fetchVesselsInArea(point.lat, point.lng, CABLE_WATCH_RADIUS_KM);
    vesselsByArea.set(areaKey, vessels);
    if (vessels == null) maritimeUnavailable = true;
    else maritimeTotal += vessels.length;
  }
  summary.feeds.maritime = maritimeUnavailable && maritimeTotal === 0 ? null : maritimeTotal;

  // ── (a) availability risk ────────────────────────────────────────────────
  if (extraction.locations.length > 0 && (earthquakes || fires || weather)) {
    const risks = assessAvailabilityRisk(extraction.locations, {
      earthquakes: earthquakes ?? [],
      fires: fires ?? [],
      weather: weather ?? [],
    });
    for (const risk of risks) {
      const inserted = await deps.exec(
        `INSERT INTO availability_risk_events
           (declaration_id, location_name, latitude, longitude, event_type, event_ref,
            magnitude, severity, distance_km, assessed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (declaration_id, location_name, event_type, event_ref)
         DO UPDATE SET distance_km = EXCLUDED.distance_km,
                       magnitude = EXCLUDED.magnitude,
                       severity = EXCLUDED.severity,
                       assessed_at = EXCLUDED.assessed_at
         RETURNING id, (xmax = 0) AS is_new`,
        [
          risk.declarationId, risk.locationName, risk.lat, risk.lng,
          risk.eventType, risk.eventRef, risk.magnitude, risk.severity,
          risk.distanceKm, sweptAt,
        ],
      );
      const row = inserted[0];
      if (row?.is_new) {
        summary.newAvailabilityRisks++;
        await alert(deps, "availability_risk", String(row.id), {
          kind: "availability_risk",
          id: row.id,
          declaration_id: risk.declarationId,
          entity_ref: risk.entityRef,
          location_name: risk.locationName,
          event_type: risk.eventType,
          event_ref: risk.eventRef,
          magnitude: risk.magnitude,
          severity: risk.severity,
          distance_km: risk.distanceKm,
          signal: "disaster-driven availability risk for a declared data-center location",
          assessed_at: sweptAt,
        });
      } else {
        summary.refreshedAvailabilityRisks++;
      }
    }
  }

  // ── (b) cable-landing watch ──────────────────────────────────────────────
  for (const point of cablePoints) {
    const areaKey = `${point.lat.toFixed(2)}:${point.lng.toFixed(2)}`;
    const vessels = vesselsByArea.get(areaKey);
    if (!vessels) continue; // feed unavailable for this area — recorded in summary
    const alerts = assessCableWatch([point], vessels);
    for (const a of alerts) {
      const inserted = await deps.exec(
        `INSERT INTO cable_watch_alerts
           (cable_point_id, cable_point_name, cable_system, vessel_mmsi, vessel_name,
            latitude, longitude, speed_knots, vessel_status, distance_km, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (cable_point_id, vessel_mmsi)
         DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at,
                       latitude = EXCLUDED.latitude,
                       longitude = EXCLUDED.longitude,
                       speed_knots = EXCLUDED.speed_knots,
                       vessel_status = EXCLUDED.vessel_status,
                       distance_km = LEAST(cable_watch_alerts.distance_km, EXCLUDED.distance_km)
         RETURNING id, (xmax = 0) AS is_new`,
        [
          a.cablePointId, a.cablePointName, a.cableSystem, a.vesselMmsi, a.vesselName,
          a.lat, a.lng, a.speedKnots, a.vesselStatus, a.distanceKm, sweptAt,
        ],
      );
      const row = inserted[0];
      if (row?.is_new) {
        summary.newCableAlerts++;
        await alert(deps, "cable_watch", String(row.id), {
          kind: "cable_watch",
          id: row.id,
          cable_point_id: a.cablePointId,
          cable_point_name: a.cablePointName,
          cable_system: a.cableSystem,
          vessel_mmsi: a.vesselMmsi,
          vessel_name: a.vesselName,
          speed_knots: a.speedKnots,
          vessel_status: a.vesselStatus,
          distance_km: a.distanceKm,
          signal: CABLE_ALERT_SIGNAL,
          assessed_at: sweptAt,
        });
      } else {
        summary.refreshedCableAlerts++;
      }
    }
  }

  logger.info({ ...summary }, "[infraRiskWatch] sweep complete");
  return summary;
}

/** Every NEW alert: hash-chained audit ledger + durable outbox event. */
async function alert(
  deps: RiskWatchDeps,
  kind: "availability_risk" | "cable_watch",
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.ledger(`infrastructure_risk_${kind}_raised`, payload, null);
  } catch (err) {
    logger.error({ err, kind, id }, "[infraRiskWatch] audit ledger append failed");
  }
  try {
    await deps.publish(INFRA_RISK_TOPIC, id, { event: `infra_risk.${kind}.raised`, ...payload });
  } catch (err) {
    logger.error({ err, kind, id }, "[infraRiskWatch] outbox publish failed");
  }
}

// ─── Acknowledge flow (router calls this; audit_logs written by router) ─────

export interface AcknowledgeResult {
  id: string;
  kind: "availability" | "cable";
  status: RiskStatus;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

/**
 * Mark an alert acknowledged (open -> acknowledged) or closed
 * (open/acknowledged -> closed). Returns null when no row transitioned
 * (unknown id, or already in a terminal state for the requested target).
 * Appends to the audit ledger and publishes the outbox event.
 */
export async function acknowledgeInfrastructureRisk(
  input: { kind: "availability" | "cable"; id: string; targetStatus?: "acknowledged" | "closed"; actor: string },
  deps: Pick<RiskWatchDeps, "exec" | "publish" | "ledger" | "now"> = defaultDeps(),
): Promise<AcknowledgeResult | null> {
  const target = input.targetStatus ?? "acknowledged";
  const table = input.kind === "availability" ? "availability_risk_events" : "cable_watch_alerts";
  const fromStatuses = target === "acknowledged" ? ["open"] : ["open", "acknowledged"];
  const now = deps.now().toISOString();

  let rows: any[];
  try {
    rows = await deps.exec(
      `UPDATE ${table}
          SET status = $2,
              acknowledged_by = $3,
              acknowledged_at = $4
        WHERE id = $1 AND status = ANY($5::text[])
        RETURNING id, status`,
      [input.id, target, input.actor, now, fromStatuses],
    );
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
  const row = rows[0];
  if (!row) return null;

  const payload = {
    kind: input.kind,
    id: input.id,
    target_status: target,
    actor: input.actor,
    at: now,
  };
  try {
    await deps.ledger(`infrastructure_risk_${input.kind}_${target}`, payload, input.actor);
  } catch (err) {
    logger.error({ err, id: input.id }, "[infraRiskWatch] acknowledge ledger append failed");
  }
  try {
    await deps.publish(INFRA_RISK_TOPIC, input.id, {
      event: `infra_risk.${input.kind}.${target}`,
      ...payload,
    });
  } catch (err) {
    logger.error({ err, id: input.id }, "[infraRiskWatch] acknowledge outbox publish failed");
  }

  return {
    id: String(row.id),
    kind: input.kind,
    status: target,
    acknowledgedBy: input.actor,
    acknowledgedAt: now,
  };
}
