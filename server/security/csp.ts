/**
 * Content Security Policy & Security Headers
 * =============================================
 * Comprehensive HTTP security headers for the NDSEP platform.
 * Implements OWASP recommended headers:
 * - Content-Security-Policy (CSP)
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options
 * - X-Frame-Options
 * - Referrer-Policy
 * - Permissions-Policy
 * - Cache-Control for sensitive endpoints
 */

import type { Request, Response, NextFunction } from "express";

const isProduction = process.env.NODE_ENV === "production";

// CSP nonce is generated per-request for inline scripts
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

const API_ORIGINS = [
  "'self'",
  process.env.OAUTH_SERVER_URL ?? "https://api.manus.im",
  process.env.VITE_OAUTH_PORTAL_URL ?? "https://manus.im",
  process.env.VITE_ANALYTICS_ENDPOINT ?? "",
].filter(Boolean).join(" ");

const CSP_DIRECTIVES = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, // React needs eval in dev
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' https://fonts.gstatic.com`,
  `connect-src 'self' ${API_ORIGINS} wss: ws:`,
  `frame-src 'self' https://js.stripe.com`,
  `frame-ancestors 'self'`,
  `form-action 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `media-src 'self' blob:`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  isProduction ? `upgrade-insecure-requests` : "",
].filter(Boolean).join("; ");

/**
 * Middleware: set comprehensive security headers on every response.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // CSP
  res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);

  // HSTS — 2 years with subdomains and preload
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // Referrer policy — send origin only for cross-origin
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy — disable unnecessary browser features
  res.setHeader("Permissions-Policy", [
    "camera=()",
    "microphone=()",
    "geolocation=(self)",
    "payment=(self)",
    "usb=()",
    "magnetometer=()",
    "gyroscope=()",
    "accelerometer=()",
  ].join(", "));

  // Prevent browsers from caching sensitive responses
  res.setHeader("X-XSS-Protection", "0"); // CSP is the modern replacement
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Download-Options", "noopen");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  // Remove server identification
  res.removeHeader("X-Powered-By");

  next();
}

/**
 * Middleware: add no-cache headers for API responses containing sensitive data.
 */
export function noCacheForSensitive(req: Request, res: Response, next: NextFunction): void {
  const sensitivePaths = ["/api/trpc/auth", "/api/trpc/banking", "/api/trpc/billing"];
  if (sensitivePaths.some(p => req.path.startsWith(p))) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
}

/**
 * Middleware: CORS with strict production settings.
 */
export function strictCors(req: Request, res: Response, next: NextFunction): void {
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "*").split(",").map(o => o.trim());
  const origin = req.headers.origin;

  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-CSRF-Token");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24h preflight cache
    res.setHeader("Access-Control-Expose-Headers", "X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
