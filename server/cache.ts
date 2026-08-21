/**
 * NDSEP Redis Cache Module (Node.js / ioredis)
 * =============================================
 * Provides a thin wrapper around ioredis with:
 *   - Automatic reconnection with exponential backoff
 *   - Graceful degradation: all operations are no-ops when Redis is unreachable
 *   - Metrics: hits, misses, sets, errors
 *
 * Environment variables:
 *   REDIS_URL     — redis://[:password@]host[:port][/db]  (default: redis://localhost:6379)
 *   REDIS_ENABLED — "true" | "false"  (default: "true")
 */

import Redis from "ioredis";
import fs from "fs";
import { logger } from "./logger";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_ENABLED = (process.env.REDIS_ENABLED ?? "true") === "true";
const REDIS_TLS_ENABLED = process.env.REDIS_TLS === "true";
const REDIS_TLS_CA = process.env.REDIS_TLS_CA_PATH;

let hits = 0;
let misses = 0;
let sets = 0;
let dels = 0;
let errors = 0;
let connected = false;

function getRedisTlsOptions(): Record<string, unknown> | undefined {
  if (!REDIS_TLS_ENABLED) return undefined;
  const opts: Record<string, unknown> = {
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
  };
  if (REDIS_TLS_CA && fs.existsSync(REDIS_TLS_CA)) {
    opts.ca = [fs.readFileSync(REDIS_TLS_CA)];
  }
  return opts;
}

let redis: Redis | null = null;

if (REDIS_ENABLED) {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    reconnectOnError: () => true,
    tls: getRedisTlsOptions() as any,
  });

  redis.on("connect", () => {
    connected = true;
    logger.info(`[Redis] Connected to ${REDIS_URL}`);
  });

  redis.on("ready", () => { connected = true; });

  redis.on("error", (err: Error) => {
    if (connected) logger.warn(`[Redis] Connection error: ${err.message}`);
    connected = false;
    errors++;
  });

  redis.on("close", () => { connected = false; });

  redis.connect().catch(() => {
    logger.warn(`[Redis] Could not connect — caching disabled (graceful degradation)`);
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!redis || !connected) { misses++; return null; }
  try {
    const val = await redis.get(key);
    if (val !== null) hits++; else misses++;
    return val;
  } catch { errors++; misses++; return null; }
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  if (!redis || !connected) return false;
  try {
    if (ttlSeconds) await redis.set(key, value, "EX", ttlSeconds);
    else await redis.set(key, value);
    sets++;
    return true;
  } catch { errors++; return false; }
}

export async function cacheDel(key: string): Promise<boolean> {
  if (!redis || !connected) return false;
  try { await redis.del(key); dels++; return true; }
  catch { errors++; return false; }
}

export async function cacheTtl(key: string): Promise<number> {
  if (!redis || !connected) return -2;
  try { return await redis.ttl(key); }
  catch { errors++; return -2; }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  return cacheSet(key, JSON.stringify(value), ttlSeconds);
}

export function cacheMetrics() {
  return {
    connected,
    enabled: REDIS_ENABLED,
    url: REDIS_URL.replace(/:\/\/.*@/, "://**@"),
    hits,
    misses,
    sets,
    dels,
    errors,
    hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0,
  };
}

export { connected as redisConnected };
