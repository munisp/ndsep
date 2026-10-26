/**
 * OSIRIS Disaster client — natural-hazard feeds for infrastructure
 * availability risk (Round-13 P2.8).
 * ===================================================================
 * Sibling of server/osirisClient.ts (NOT modified): that client covers
 * sanctions/threat/conflict feeds; this one covers physical-world hazards
 * used to assess disaster-driven availability risk for registered
 * data-center regions (server/services/infrastructureRiskWatch.ts):
 *
 *   fetchEarthquakes()     OSIRIS GET /api/earthquakes  -> USGS M2.5+ events
 *   fetchFires()           OSIRIS GET /api/fires        -> NASA FIRMS hotspots
 *   fetchSevereWeather()   OSIRIS GET /api/weather      -> EONET severe events
 *
 * Design is defensive: OSIRIS response shapes are assumed
 * ({events:[{id,mag,lat,lng,place,ts}]} etc.) but every field is narrowed
 * tolerantly — missing/renamed fields drop the record instead of throwing,
 * and unknown extra fields are ignored (schema drift tolerance).
 *
 * GRACEFUL-DEGRADATION contract:
 *   Every function returns null (never throws, never fabricates) when the
 *   feed cannot be obtained. The risk-watch layer treats null as
 *   "feed unavailable" and records an outage — never a phantom "all clear".
 *
 * Conventions mirror osirisClient.ts: OSIRIS_URL env base URL, optional
 * X-Scanner-Key, 10s AbortSignal timeout, 15min in-memory cache.
 */
import pino from "pino";

const logger = pino({ name: "osiris-disaster-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
/** 'true' when NDSEP runs the OSIRIS sidecar (infra/osiris/docker-compose.osiris.yml). */
export const OSIRIS_SELF_HOSTED = (process.env.OSIRIS_SELF_HOSTED ?? "false") === "true";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min, matches osirisClient.ts
const HTTP_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

/** USGS M2.5+ earthquake, narrowed from GET /api/earthquakes. */
export interface OsirisEarthquake {
  id: string;
  mag: number;
  lat: number;
  lng: number;
  place: string;
  ts: string;
}

/** NASA FIRMS active-fire hotspot, narrowed from GET /api/fires. */
export interface OsirisFireHotspot {
  id: string;
  lat: number;
  lng: number;
  /** Fire radiative power (MW) when supplied — used as severity hint. */
  frp: number | null;
  brightness: number | null;
  ts: string;
}

/** EONET severe-weather event, narrowed from GET /api/weather. */
export interface OsirisSevereWeatherEvent {
  id: string;
  title: string;
  category: string;
  lat: number;
  lng: number;
  ts: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttl = CACHE_TTL_MS): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T, ttl = CACHE_TTL_MS): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}

/** Test hook: flush the in-memory cache between cases. */
export function _clearDisasterCache(): void {
  cache.clear();
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function osirisGet<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(path, OSIRIS_URL);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (OSIRIS_SCANNER_KEY) headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY;

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path, selfHosted: OSIRIS_SELF_HOSTED }, "OSIRIS disaster feed non-OK response");
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e), path, selfHosted: OSIRIS_SELF_HOSTED },
      "OSIRIS disaster feed unreachable — degrading gracefully",
    );
    return null;
  }
}

// ── Tolerant narrowing helpers ───────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Lat must be [-90,90], lng [-180,180]; reject nonsense coordinates. */
function asLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = asNum(lat);
  const ln = asNum(lng);
  if (la == null || ln == null) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/** Pull the event array out of a feed body; tolerates {events}, {results}, {data} or a bare array. */
function extractArray(body: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  const rec = asRecord(body);
  if (!rec) return [];
  for (const k of keys) {
    if (Array.isArray(rec[k])) return rec[k] as unknown[];
  }
  return [];
}

// ── Earthquakes (USGS M2.5+) ─────────────────────────────────────────────────

export async function fetchEarthquakes(): Promise<OsirisEarthquake[] | null> {
  const cacheKey = "disaster:earthquakes";
  const hit = cached<OsirisEarthquake[]>(cacheKey);
  if (hit) return hit;

  const body = await osirisGet<unknown>("/api/earthquakes");
  if (body == null) return null; // feed unavailable — caller records outage

  const events = extractArray(body, "events", "earthquakes", "results", "data");
  const out: OsirisEarthquake[] = [];
  for (const raw of events) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = asStr(rec.id) ?? asStr(rec.event_id) ?? asStr(rec.usgs_id);
    const mag = asNum(rec.mag ?? rec.magnitude);
    const ll = asLatLng(rec.lat ?? rec.latitude, rec.lng ?? rec.lon ?? rec.longitude);
    if (!id || mag == null || !ll) continue; // drop malformed records, tolerate drift
    out.push({
      id,
      mag,
      lat: ll.lat,
      lng: ll.lng,
      place: asStr(rec.place) ?? asStr(rec.title) ?? "unknown",
      ts: asStr(rec.ts) ?? asStr(rec.time) ?? asStr(rec.updated) ?? new Date().toISOString(),
    });
  }
  setCache(cacheKey, out);
  return out;
}

// ── Active fires (NASA FIRMS) ────────────────────────────────────────────────

export async function fetchFires(): Promise<OsirisFireHotspot[] | null> {
  const cacheKey = "disaster:fires";
  const hit = cached<OsirisFireHotspot[]>(cacheKey);
  if (hit) return hit;

  const body = await osirisGet<unknown>("/api/fires");
  if (body == null) return null;

  const events = extractArray(body, "events", "fires", "hotspots", "results", "data");
  const out: OsirisFireHotspot[] = [];
  for (const raw of events) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const ll = asLatLng(rec.lat ?? rec.latitude, rec.lng ?? rec.lon ?? rec.longitude);
    if (!ll) continue;
    const id = asStr(rec.id) ?? `firms:${ll.lat.toFixed(4)},${ll.lng.toFixed(4)}:${asStr(rec.ts) ?? asStr(rec.acq_date) ?? ""}`;
    out.push({
      id,
      lat: ll.lat,
      lng: ll.lng,
      frp: asNum(rec.frp),
      brightness: asNum(rec.brightness ?? rec.bright_ti4),
      ts: asStr(rec.ts) ?? asStr(rec.acq_date) ?? new Date().toISOString(),
    });
  }
  setCache(cacheKey, out);
  return out;
}

// ── Severe weather (EONET) ───────────────────────────────────────────────────

export async function fetchSevereWeather(): Promise<OsirisSevereWeatherEvent[] | null> {
  const cacheKey = "disaster:weather";
  const hit = cached<OsirisSevereWeatherEvent[]>(cacheKey);
  if (hit) return hit;

  const body = await osirisGet<unknown>("/api/weather");
  if (body == null) return null;

  const events = extractArray(body, "events", "weather", "results", "data");
  const out: OsirisSevereWeatherEvent[] = [];
  for (const raw of events) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = asStr(rec.id) ?? asStr(rec.event_id);
    const ll = asLatLng(rec.lat ?? rec.latitude, rec.lng ?? rec.lon ?? rec.longitude);
    if (!id || !ll) continue;
    out.push({
      id,
      title: asStr(rec.title) ?? asStr(rec.name) ?? "severe weather event",
      category: asStr(rec.category) ?? asStr(rec.type) ?? "severe",
      lat: ll.lat,
      lng: ll.lng,
      ts: asStr(rec.ts) ?? asStr(rec.time) ?? new Date().toISOString(),
    });
  }
  setCache(cacheKey, out);
  return out;
}
