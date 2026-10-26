/**
 * OSIRIS Live-News Layer (23 broadcasters) — NDSEP client (round 13, P1.5)
 * ========================================================================
 * Consumes OSIRIS's live-news layer: headlines/streams from 23 broadcast
 * channels exposed via GET {OSIRIS_URL}/api/news
 * ({channels:[{name, headlines:[{title,url,ts}]}]} — schema assumed, parsing
 * is defensive; a flat {headlines:[...]} or bare array is also tolerated).
 * NDSEP wires broadcast mentions into the adverse-media pipeline as an
 * adverse-media candidate source
 * (workers/python/gdelt_adverse_media_worker.py + osirisIntelFeed router).
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

const logger = pino({ name: "osiris-news-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache

// ── Types ────────────────────────────────────────────────────────────────────

export interface OsirisNewsMention {
  /** Broadcaster / channel name ("unknown" when absent). */
  channel: string;
  /** Headline text (may contain raw PII — redact before persisting). */
  title: string;
  /** Provenance URL; "" when absent. */
  url: string;
  /** Headline timestamp (ISO-8601 string as returned; caller parses
   *  defensively). */
  ts: string;
}

export interface NewsMentionsResult {
  mentions: OsirisNewsMention[];
  /** Channels actually present in the payload. */
  channels: string[];
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
export function _clearNewsCache(): void {
  cache.clear();
}

// ── Defensive narrowing ──────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Narrow one raw headline object; returns null when the irreducible field
 *  (title) is unusable. Tolerates missing url / ts. */
export function narrowNewsHeadline(raw: unknown, channel: string): OsirisNewsMention | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = asString(r.title) ?? asString(r.headline) ?? asString(r.text);
  if (!title) return null;
  return {
    channel: asString(r.channel) ?? asString(r.name) ?? channel ?? "unknown",
    title,
    url: asString(r.url) ?? asString(r.link) ?? "",
    ts: asString(r.ts) ?? asString(r.timestamp) ?? asString(r.date) ?? "",
  };
}

/** Extract (channel, rawHeadline) pairs from the payload, tolerating the
 *  grouped {channels:[{name, headlines:[...]}]}, a flat {headlines:[...]},
 *  or a bare array of headlines (schema drift). Returns null when no
 *  recognisable shape is present. */
function extractHeadlines(raw: unknown): { pairs: Array<[string, unknown]>; degraded: boolean } | null {
  if (Array.isArray(raw)) {
    return { pairs: raw.map((h): [string, unknown] => ["unknown", h]), degraded: false };
  }
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const groupKey = Array.isArray(r.channels) ? "channels"
    : Array.isArray(r.streams) ? "streams"
    : null;
  if (groupKey) {
    const pairs: Array<[string, unknown]> = [];
    let degraded = false;
    for (const ch of r[groupKey] as unknown[]) {
      if (ch === null || typeof ch !== "object") { degraded = true; continue; }
      const c = ch as Record<string, unknown>;
      const name = asString(c.name) ?? asString(c.channel) ?? "unknown";
      const headlines = Array.isArray(c.headlines) ? c.headlines
        : Array.isArray(c.items) ? c.items
        : null;
      if (!headlines) { degraded = true; continue; }
      for (const h of headlines) pairs.push([name, h]);
    }
    return { pairs, degraded };
  }

  const flat = Array.isArray(r.headlines) ? r.headlines
    : Array.isArray(r.items) ? r.items
    : null;
  if (flat) {
    return { pairs: flat.map((h): [string, unknown] => ["unknown", h]), degraded: false };
  }
  return null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the OSIRIS live-news layer. Returns null on ANY failure
 * (unreachable, timeout, non-OK, unparseable payload) — callers treat null
 * as "no news data this cycle", never as an exception.
 */
export async function fetchNewsMentions(opts?: {
  /** Free-text query filter (resolved server-side). */
  query?: string;
}): Promise<NewsMentionsResult | null> {
  const cacheKey = `news:${opts?.query ?? ""}`;
  const hit = cached<NewsMentionsResult>(cacheKey);
  if (hit) return hit;

  const url = new URL("/api/news", OSIRIS_URL);
  if (opts?.query) url.searchParams.set("query", opts.query);

  let raw: unknown;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (OSIRIS_SCANNER_KEY) headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY;
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "OSIRIS news non-OK response");
      return null;
    }
    raw = await res.json();
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e) },
      "OSIRIS news unreachable — degrading gracefully",
    );
    return null;
  }

  const extracted = extractHeadlines(raw);
  if (!extracted) {
    logger.warn("OSIRIS news payload has no recognisable channels/headlines shape — schema drift");
    return null;
  }

  let dropped = 0;
  const mentions: OsirisNewsMention[] = [];
  const channels = new Set<string>();
  for (const [channel, h] of extracted.pairs) {
    const narrowed = narrowNewsHeadline(h, channel);
    if (narrowed) {
      mentions.push(narrowed);
      channels.add(narrowed.channel);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    logger.warn({ dropped, received: extracted.pairs.length }, "OSIRIS news: dropped unparseable headlines");
  }

  const result: NewsMentionsResult = {
    mentions,
    channels: Array.from(channels).sort(),
    degraded: extracted.degraded || dropped > 0,
  };
  setCache(cacheKey, result);
  return result;
}
