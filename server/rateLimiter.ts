/**
 * Rate Limiting Middleware — distributed Redis-backed enforcement in runtime.
 * Test runs use isolated express-rate-limit memory stores only.
 */
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { redisRateLimitStore } from "./redisRateLimitStore";

function safeIpKey(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return ipKeyGenerator(ip);
}

function getOrgKey(req: Request): string {
  const orgId = (req as { session?: { orgId?: string }; user?: { orgId?: string } }).session?.orgId
    ?? (req as { session?: { orgId?: string }; user?: { orgId?: string } }).user?.orgId;
  return orgId ? `org:${orgId}` : safeIpKey(req);
}

function standardHeaders() {
  return { standardHeaders: "draft-7" as const, legacyHeaders: false, passOnStoreError: false };
}

/** Global API rate limiter — 1,000 requests per 15 minutes per source IP. */
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
  keyGenerator: safeIpKey,
  skip: (req: Request) => req.path === "/api/health",
  store: redisRateLimitStore("ndsep:global-api:"),
  ...standardHeaders(),
});

/** Authentication rate limiter — 20 requests per 15 minutes per source IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many authentication attempts. Please wait 15 minutes.", code: "AUTH_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  store: redisRateLimitStore("ndsep:auth:"),
  ...standardHeaders(),
});

/** tRPC mutation limiter — 200 write operations per 15 minutes per organization. */
export const trpcMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many write operations. Please slow down.", code: "MUTATION_RATE_LIMITED" },
  keyGenerator: getOrgKey,
  skip: (req: Request) => req.method !== "POST",
  store: redisRateLimitStore("ndsep:trpc-mutation:"),
  ...standardHeaders(),
});

/** File upload limiter — 50 uploads per hour per organization. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: "Upload limit reached. Maximum 50 uploads per hour.", code: "UPLOAD_RATE_LIMITED" },
  keyGenerator: getOrgKey,
  store: redisRateLimitStore("ndsep:upload:"),
  ...standardHeaders(),
});

/** Public DSAR limiter — 10 submissions per hour per source IP. */
export const dsarPublicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many DSAR submissions from this IP. Please wait before submitting again.", code: "DSAR_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  store: redisRateLimitStore("ndsep:dsar:"),
  ...standardHeaders(),
});

/** BGP SSE limiter — five stream openings per minute per source IP. */
export const bgpSseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many SSE connections.", code: "SSE_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  store: redisRateLimitStore("ndsep:bgp-sse:"),
  ...standardHeaders(),
});

/** Developer API limiter — 500 requests per hour per API key or source IP. */
export const developerApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 500,
  message: { error: "API rate limit exceeded.", code: "API_KEY_RATE_LIMITED" },
  keyGenerator: (req: Request) => {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    return apiKey ? `apikey:${apiKey}` : safeIpKey(req);
  },
  store: redisRateLimitStore("ndsep:developer-api:"),
  ...standardHeaders(),
});
