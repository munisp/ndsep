/**
 * OSIRIS GDELT Events Layer — NDSEP client (round 13, P1.5)
 * =========================================================
 * Consumes OSIRIS's GDELT layer: geocoded global events exposed via
 * GET {OSIRIS_URL}/api/gdelt ({events:[{id,title,url,source,ts,lat,lng,
 * country,actors[],tone}]} — schema assumed, parsing is defensive). NDSEP
 * wires these events into the adverse-media pipeline as an adverse-media
 * candidate source (workers/python/gdelt_adverse_media_worker.py +
 * osirisIntelFeed router).
 *
 * Defensive conventions (same as server/osirisClient.ts — kept in a separate
 * module per round-13 ownership rules):
 *   - 10s AbortSignal timeout per request;
 *   - 15-minute in-memory cache;
 *   - graceful `null` on any failure (network, non-OK, schema drift) — never
 *     throws, never blocks the caller's primary path;
 *   - response is type-narrowed field-by-field; unknown/missing fields
 *     degrade to null/defaults instead of failing the whole batch.
 *
 * Env:
 *   OSIRIS_URL           base URL (default https://osirisai.live)
 *   OSIRIS_SCANNER_KEY   optional API key header (X-Scanner-Key)
 */
import pino from "pino";

const logger = pino({ name: "osiris-gdelt-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache

// ── Types ────────────────────────────────────────────────────────────────────

export interface OsirisGdeltEvent {
  /** OSIRIS/GDELT-native event id (dedupe key). */
  id: string;
  /** Event headline / title. */
  title: string;
  /** Provenance URL (source article); "" when absent. */
  url: string;
  /** Originating news source name; "" when absent. */
  source: string;
  /** Event timestamp (ISO-8601 string as returned; caller parses defensively). */
  ts: string;
  /** Geocode; null when OSIRIS could not geolocate the event. */
  lat: number | null;
  lng: number | null;
  /** Country name/code as reported; "" when absent. */
  country: string;
  /** Named actors (persons/orgs) attached to the event. */
  actors: string[];
  /** GDELT tone score; null when absent/unparseable. */
  tone: number | null;
}

export interface GdeltEventsResult {
  events: OsirisGdeltEvent[];
  /** True when the payload parsed but carried schema-drift warnings. */
  degraded: boolean;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

/** Test hook: clear the in-memory cache. */
export function _clearGdeltCache(): void {
  cache.clear();
}

// ── Defensive narrowing ──────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Narrow one raw event object; returns null when the irreducible fields
 *  (id, title) are unusable. Tolerates missing geo / ts / url / source /
 *  country / actors / tone (schema drift). */
export function narrowGdeltEvent(raw: unknown): OsirisGdeltEvent | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id) ?? (typeof r.id === "number" ? String(r.id) : null)
    ?? asString(r.event_id) ?? asString(r.guid);
  const title = asString(r.title) ?? asString(r.headline) ?? asString(r.name);
  if (!id || !title) return null;

  const actors: string[] = Array.isArray(r.actors)
    ? r.actors.filter((a): a is string => typeof a === "string" && a.length > 0)
    : [];

  return {
    id,
    title,
    url: asString(r.url) ?? asString(r.link) ?? "",
    source: asString(r.source) ?? asString(r.domain) ?? "",
    ts: asString(r.ts) ?? asString(r.timestamp) ?? asString(r.date) ?? "",
    lat: asNumber(r.lat) ?? asNumber(r.latitude),
    lng: asNumber(r.lng) ?? asNumber(r.lon) ?? asNumber(r.longitude),
    country: asString(r.country) ?? asString(r.country_code) ?? "",
    actors,
    tone: asNumber(r.tone),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the OSIRIS GDELT events layer. Returns null on ANY failure
 * (unreachable, timeout, non-OK, unparseable payload) — callers treat null
 * as "no event data this cycle", never as an exception.
 */
export async function fetchGdeltEvents(opts?: {
  /** Country filter (name or ISO code, resolved server-side). */
  country?: string;
  /** Free-text query filter (resolved server-side). */
  query?: string;
  /** ISO-8601 lower bound; older events are excluded server-side. */
  since?: string;
}): Promise<GdeltEventsResult | null> {
  const cacheKey = `gdelt:${opts?.country ?? ""}:${opts?.query ?? ""}:${opts?.since ?? ""}`;
  const hit = cached<GdeltEventsResult>(cacheKey);
  if (hit) return hit;

  const url = new URL("/api/gdelt", OSIRIS_URL);
  if (opts?.country) url.searchParams.set("country", opts.country);
  if (opts?.query) url.searchParams.set("query", opts.query);
  if (opts?.since) url.searchParams.set("since", opts.since);

  let raw: unknown;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (OSIRIS_SCANNER_KEY) headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY;
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "OSIRIS gdelt non-OK response");
      return null;
    }
    raw = await res.json();
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e) },
      "OSIRIS gdelt unreachable — degrading gracefully",
    );
    return null;
  }

  // Tolerate both {events: [...]} and a bare array (schema drift).
  let rawEvents: unknown[];
  if (Array.isArray(raw)) {
    rawEvents = raw;
  } else if (raw !== null && typeof raw === "object"
    && Array.isArray((raw as Record<string, unknown>).events)) {
    rawEvents = (raw as Record<string, unknown>).events as unknown[];
  } else {
    logger.warn("OSIRIS gdelt payload missing events array — schema drift");
    return null;
  }

  let dropped = 0;
  const events: OsirisGdeltEvent[] = [];
  for (const ev of rawEvents) {
    const narrowed = narrowGdeltEvent(ev);
    if (narrowed) events.push(narrowed);
    else dropped += 1;
  }
  if (dropped > 0) {
    logger.warn({ dropped, received: rawEvents.length }, "OSIRIS gdelt: dropped unparseable events");
  }

  const result: GdeltEventsResult = { events, degraded: dropped > 0 };
  setCache(cacheKey, result);
  return result;
}
