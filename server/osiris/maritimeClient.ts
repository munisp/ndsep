/**
 * OSIRIS Maritime client — vessel traffic near Nigerian submarine cable
 * landings (Round-13 P2.9).
 * ===================================================================
 * Sibling of server/osirisClient.ts (NOT modified): that client covers
 * sanctions/threat/conflict feeds; this one covers the maritime surface
 * used by the cable-landing watch in
 * server/services/infrastructureRiskWatch.ts:
 *
 *   fetchVesselsInArea(lat, lng, radiusKm)
 *     OSIRIS GET /api/maritime?lat=&lng=&radius_km= -> vessels in the box
 *
 * Design is defensive: the response is assumed to be
 * {vessels:[{mmsi,name,lat,lng,speed,status,ts}]} but every field is
 * narrowed tolerantly (mmsi may arrive as a number, speed as a string,
 * status vocabulary may drift) — malformed records are dropped, never
 * thrown on.
 *
 * GRACEFUL-DEGRADATION contract:
 *   Returns null (never throws, never fabricates) when the feed cannot be
 *   obtained. The cable-watch layer treats null as "feed unavailable" and
 *   records an outage — never a phantom "no vessels".
 *
 * Conventions mirror osirisClient.ts: OSIRIS_URL env base URL, optional
 * X-Scanner-Key, 10s AbortSignal timeout, 15min in-memory cache (keyed by
 * rounded area so adjacent sweeps share a cache entry).
 */
import pino from "pino";

const logger = pino({ name: "osiris-maritime-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
/** 'true' when NDSEP runs the OSIRIS sidecar (infra/osiris/docker-compose.osiris.yml). */
export const OSIRIS_SELF_HOSTED = (process.env.OSIRIS_SELF_HOSTED ?? "false") === "true";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min, matches osirisClient.ts
const HTTP_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

/** Vessel position report, narrowed from GET /api/maritime. */
export interface OsirisVessel {
  mmsi: string;
  name: string | null;
  lat: number;
  lng: number;
  /** Speed over ground in knots; null when not reported. */
  speed: number | null;
  /** Raw nav status, lower-cased (e.g. 'under way', 'anchored', 'moored'). */
  status: string | null;
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
export function _clearMaritimeCache(): void {
  cache.clear();
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
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v); // MMSI often arrives numeric
  return null;
}

function asLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = asNum(lat);
  const ln = asNum(lng);
  if (la == null || ln == null) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

// ── Vessels in area ──────────────────────────────────────────────────────────

/**
 * Fetch vessels within radiusKm of (lat, lng). Returns null when the feed
 * is unavailable; returns [] when the feed is up but the area is empty.
 */
export async function fetchVesselsInArea(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<OsirisVessel[] | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return null;
  }
  // Round the key so nearby sweep coordinates share a cache entry.
  const cacheKey = `maritime:${lat.toFixed(2)}:${lng.toFixed(2)}:${Math.round(radiusKm)}`;
  const hit = cached<OsirisVessel[]>(cacheKey);
  if (hit) return hit;

  let body: unknown;
  try {
    const url = new URL("/api/maritime", OSIRIS_URL);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    url.searchParams.set("radius_km", String(radiusKm));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (OSIRIS_SCANNER_KEY) headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY;

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, selfHosted: OSIRIS_SELF_HOSTED }, "OSIRIS maritime feed non-OK response");
      return null;
    }
    body = await res.json();
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e), selfHosted: OSIRIS_SELF_HOSTED },
      "OSIRIS maritime feed unreachable — degrading gracefully",
    );
    return null;
  }

  const list = Array.isArray(body)
    ? body
    : (() => {
        const rec = asRecord(body);
        if (!rec) return [];
        for (const k of ["vessels", "results", "ships", "data"]) {
          if (Array.isArray(rec[k])) return rec[k] as unknown[];
        }
        return [];
      })();

  const out: OsirisVessel[] = [];
  for (const raw of list) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const mmsi = asStr(rec.mmsi) ?? asStr(rec.id);
    const ll = asLatLng(rec.lat ?? rec.latitude, rec.lng ?? rec.lon ?? rec.longitude);
    if (!mmsi || !ll) continue; // drop malformed records, tolerate drift
    const status = asStr(rec.status ?? rec.nav_status ?? rec.navigational_status);
    out.push({
      mmsi,
      name: asStr(rec.name) ?? asStr(rec.ship_name) ?? asStr(rec.vessel_name),
      lat: ll.lat,
      lng: ll.lng,
      speed: asNum(rec.speed ?? rec.sog ?? rec.speed_knots),
      status: status ? status.toLowerCase() : null,
      ts: asStr(rec.ts) ?? asStr(rec.timestamp) ?? asStr(rec.last_seen) ?? new Date().toISOString(),
    });
  }
  setCache(cacheKey, out);
  return out;
}
