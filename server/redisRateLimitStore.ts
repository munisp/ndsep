import fs from "node:fs";
import Redis from "ioredis";
import RedisStore, { type RedisReply } from "rate-limit-redis";

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
const redisUrl = process.env.REDIS_URL;
const tlsEnabled = process.env.REDIS_TLS === "true";
const tlsCaPath = process.env.REDIS_TLS_CA_PATH;

function requiredRedisUrl(): string {
  if (!redisUrl) throw new Error("REDIS_URL is required for non-test rate limiting");
  if (isProduction) {
    if (!redisUrl.startsWith("rediss://")) throw new Error("Production rate limiting requires REDIS_URL to use rediss://");
    if (!tlsEnabled || process.env.REDIS_TLS_REJECT_UNAUTHORIZED === "false") {
      throw new Error("Production rate limiting requires REDIS_TLS=true with certificate verification");
    }
    if (!tlsCaPath || !fs.existsSync(tlsCaPath)) {
      throw new Error("Production rate limiting requires a readable REDIS_TLS_CA_PATH");
    }
  }
  return redisUrl;
}

function redisTlsOptions(): Record<string, unknown> | undefined {
  if (!tlsEnabled) return undefined;
  const options: Record<string, unknown> = {
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
  };
  if (tlsCaPath && fs.existsSync(tlsCaPath)) options.ca = [fs.readFileSync(tlsCaPath)];
  return options;
}

// Test suites intentionally use express-rate-limit's isolated memory store. Runtime
// request throttling is distributed through Redis; a store error rejects requests
// because passOnStoreError remains false on every limiter.
const rateLimitRedis = isTest
  ? undefined
  : new Redis(requiredRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      tls: redisTlsOptions() as never,
    });

if (rateLimitRedis) {
  rateLimitRedis.on("error", () => undefined);
  void rateLimitRedis.connect().catch(() => undefined);
}

export function redisRateLimitStore(prefix: string): RedisStore | undefined {
  if (!rateLimitRedis) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      rateLimitRedis.call(command, ...args) as Promise<RedisReply>,
  });
}

export const __test__ = { isTest, isProduction, requiredRedisUrl, redisTlsOptions };
