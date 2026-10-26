/**
 * OSIRIS Telegram OSINT Layer — NDSEP client (round 13, P0.1)
 * ============================================================
 * Consumes OSIRIS's Telegram layer: public-channel posts scraped from
 * t.me/s/<channel> previews, geoparsed by OSIRIS and exposed via
 * GET {OSIRIS_URL}/api/telegram-feed. NDSEP wires this feed into the
 * adverse-media pipeline as a breach early-warning source
 * (workers/python/telegram_breach_watch_worker.py + telegramWatch router).
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
 *   OSIRIS_URL                 base URL (default https://osirisai.live)
 *   OSIRIS_SCANNER_KEY         optional API key header (X-Scanner-Key)
 *   OSIRIS_TELEGRAM_CHANNELS   comma-separated default channel list
 */
import pino from "pino";

const logger = pino({ name: "osiris-telegram-client" });

const OSIRIS_URL = process.env.OSIRIS_URL ?? "https://osirisai.live";
const OSIRIS_SCANNER_KEY = process.env.OSIRIS_SCANNER_KEY ?? "";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramPostGeo {
  lat: number;
  lng: number;
  place: string | null;
}

export interface OsirisTelegramPost {
  /** OSIRIS-assigned post id (dedupe key together with channel). */
  id: string;
  /** Telegram channel handle (without @). */
  channel: string;
  /** Post text (may contain raw PII — redact before persisting). */
  text: string;
  /** Post timestamp (ISO-8601 string as returned; caller parses defensively). */
  ts: string;
  /** Geoparse result; null when OSIRIS could not geolocate the post. */
  geo: TelegramPostGeo | null;
  /** Canonical t.me URL for provenance. */
  url: string;
}

export interface TelegramFeedResult {
  posts: OsirisTelegramPost[];
  /** Channels actually queried (after env/default resolution). */
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
export function _clearTelegramFeedCache(): void {
  cache.clear();
}

// ── Defensive narrowing ──────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Narrow one raw post object; returns null when the irreducible fields
 *  (id, text) are unusable. Tolerates missing geo / ts / url / channel. */
export function narrowTelegramPost(raw: unknown): OsirisTelegramPost | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id) ?? (typeof r.id === "number" ? String(r.id) : null);
  const text = asString(r.text) ?? asString(r.message) ?? asString(r.content);
  if (!id || !text) return null;

  let geo: TelegramPostGeo | null = null;
  if (r.geo !== null && typeof r.geo === "object") {
    const g = r.geo as Record<string, unknown>;
    const lat = asNumber(g.lat);
    const lng = asNumber(g.lng);
    if (lat !== null && lng !== null) {
      geo = { lat, lng, place: asString(g.place) };
    }
  }

  return {
    id,
    channel: asString(r.channel) ?? "unknown",
    text,
    ts: asString(r.ts) ?? asString(r.timestamp) ?? asString(r.date) ?? "",
    geo,
    url: asString(r.url) ?? (asString(r.channel) ? `https://t.me/s/${asString(r.channel)}/${id}` : ""),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** Default channel list from env (comma-separated), else empty (server
 *  decides its own default set). */
export function defaultTelegramChannels(): string[] {
  return (process.env.OSIRIS_TELEGRAM_CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Fetch the OSIRIS Telegram feed. Returns null on ANY failure (unreachable,
 * timeout, non-OK, unparseable payload) — callers treat null as "no feed
 * data this cycle", never as an exception.
 */
export async function fetchTelegramFeed(opts?: {
  channels?: string[];
  /** ISO-8601 lower bound; posts older than this are excluded server-side. */
  since?: string;
}): Promise<TelegramFeedResult | null> {
  const channels = (opts?.channels && opts.channels.length > 0)
    ? opts.channels.map((c) => c.trim().replace(/^@/, "")).filter(Boolean)
    : defaultTelegramChannels();

  const cacheKey = `telegram-feed:${channels.join(",")}:${opts?.since ?? ""}`;
  const hit = cached<TelegramFeedResult>(cacheKey);
  if (hit) return hit;

  const url = new URL("/api/telegram-feed", OSIRIS_URL);
  if (channels.length) url.searchParams.set("channels", channels.join(","));
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
      logger.warn({ status: res.status }, "OSIRIS telegram-feed non-OK response");
      return null;
    }
    raw = await res.json();
  } catch (e) {
    logger.debug(
      { err: e instanceof Error ? e.message : String(e) },
      "OSIRIS telegram-feed unreachable — degrading gracefully",
    );
    return null;
  }

  // Tolerate both {posts: [...]} and a bare array (schema drift).
  const rawPosts: unknown[] = Array.isArray(raw)
    ? raw
    : (raw !== null && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).posts))
      ? ((raw as Record<string, unknown>).posts as unknown[])
      : [];
  if (!Array.isArray(raw) && (raw === null || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).posts))) {
    logger.warn("OSIRIS telegram-feed payload missing posts array — schema drift");
    return null;
  }

  let dropped = 0;
  const posts: OsirisTelegramPost[] = [];
  for (const p of rawPosts) {
    const narrowed = narrowTelegramPost(p);
    if (narrowed) posts.push(narrowed);
    else dropped += 1;
  }
  if (dropped > 0) {
    logger.warn({ dropped, received: rawPosts.length }, "OSIRIS telegram-feed: dropped unparseable posts");
  }

  const result: TelegramFeedResult = { posts, channels, degraded: dropped > 0 };
  setCache(cacheKey, result);
  return result;
}
