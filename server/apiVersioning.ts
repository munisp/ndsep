/**
 * NDSEP API Versioning Strategy
 * ================================
 * Implements URL-based API versioning with backward compatibility.
 *
 * Current: /api/trpc/... (unversioned)
 * New: /api/v1/... and /api/v2/... with deprecation notices
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

export const CURRENT_API_VERSION = "v2";
export const SUPPORTED_VERSIONS = ["v1", "v2"] as const;
export const DEPRECATED_VERSIONS = ["v1"] as const;
export const SUNSET_DATES: Record<string, string> = {
  v1: "2026-12-31",
};

/** Version usage metrics for observability */
const versionUsageCounters: Record<string, number> = { v1: 0, v2: 0 };
export function getVersionMetrics(): Record<string, number> {
  return { ...versionUsageCounters };
}

/**
 * Middleware: Add API version headers to responses.
 * Uses req.baseUrl (set by Express on mounted routes) to correctly detect version.
 */
export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  // req.baseUrl contains the mount path ("/api/v1" or "/api/v2")
  // req.originalUrl contains the full original URL for fallback detection
  const fullPath = req.baseUrl + req.path;
  const versionMatch = fullPath.match(/\/api\/(v\d+)/);
  const version = versionMatch ? versionMatch[1] : CURRENT_API_VERSION;

  // Track usage metrics
  if (version in versionUsageCounters) versionUsageCounters[version]++;

  // Set version header
  res.setHeader("X-API-Version", version);

  // Add deprecation headers for old versions (RFC 8594)
  if ((DEPRECATED_VERSIONS as readonly string[]).includes(version)) {
    res.setHeader("Deprecation", "true");
    const successorPath = req.path === "/" ? "/" : req.path;
    res.setHeader("Link", `</api/${CURRENT_API_VERSION}${successorPath}>; rel="successor-version"`);
    const sunsetDate = SUNSET_DATES[version];
    if (sunsetDate) {
      res.setHeader("Sunset", new Date(sunsetDate).toUTCString());
    }
    logger.info({ version, path: fullPath }, "[API] Deprecated version accessed");
  }

  next();
}

/**
 * Create versioned endpoint mountpoints.
 * Maps /api/v1/... and /api/v2/... with proper deprecation signaling.
 */
export function createVersionedEndpoints(expressApp: { use: (...args: any[]) => void }): void {
  expressApp.use("/api/v1", apiVersionMiddleware);
  expressApp.use("/api/v2", apiVersionMiddleware);

  logger.info("[API] Versioned endpoints registered (v1=deprecated sunset:2026-12-31, v2=current)");
}
