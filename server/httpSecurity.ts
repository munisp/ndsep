import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

export function fallbackApiRateLimit(input: { remoteAddress: string; now?: number; limit?: number; windowMs?: number }) {
  const now = input.now ?? Date.now(); const limit = input.limit ?? 120; const windowMs = input.windowMs ?? 60_000;
  const bucket = buckets.get(input.remoteAddress);
  if (!bucket || bucket.resetAt <= now) { buckets.set(input.remoteAddress, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfterSeconds: 0 }; }
  bucket.count += 1; if (bucket.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
}

export function fallbackApiRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/metrics") return next();
  const result = fallbackApiRateLimit({ remoteAddress: req.socket.remoteAddress ?? "unknown" });
  if (!result.allowed) { res.setHeader("Retry-After", String(result.retryAfterSeconds)); res.status(429).json({ error: "Request rate limit exceeded. Retry later." }); return; }
  next();
}
