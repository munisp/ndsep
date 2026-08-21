/**
 * NDSEP Structured Error Tracking
 * ================================
 * Provides a centralized error tracking module with:
 *   - Structured error capture with context
 *   - Error deduplication by fingerprint
 *   - Severity-based alerting thresholds
 *   - Integration hooks for Sentry, Datadog, or self-hosted
 *
 * Environment:
 *   SENTRY_DSN     — Sentry DSN for error reporting (optional)
 *   ERROR_TRACKING — "true" | "false" (default: "true")
 */

import { logger } from "./logger";

export type ErrorSeverity = "fatal" | "error" | "warning" | "info";

export interface ErrorEvent {
  message: string;
  severity: ErrorSeverity;
  error?: Error;
  context?: Record<string, unknown>;
  userId?: string;
  requestId?: string;
  tags?: Record<string, string>;
  fingerprint?: string[];
  timestamp: string;
}

const ERROR_TRACKING_ENABLED = (process.env.ERROR_TRACKING ?? "true") === "true";
const SENTRY_DSN = process.env.SENTRY_DSN;
const ERROR_SAMPLE_RATE = parseFloat(process.env.ERROR_SAMPLE_RATE ?? "1.0");

const errorCounts = new Map<string, { count: number; lastSeen: number; firstSeen: number }>();
const MAX_FINGERPRINTS = 10000;

function generateFingerprint(event: ErrorEvent): string {
  const parts = event.fingerprint ?? [
    event.message.replace(/\d+/g, "N"),
    event.severity,
    ...(event.tags ? Object.values(event.tags) : []),
  ];
  return parts.join("|");
}

export function captureError(
  error: Error | string,
  context?: {
    severity?: ErrorSeverity;
    userId?: string;
    requestId?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): void {
  if (!ERROR_TRACKING_ENABLED) return;

  const event: ErrorEvent = {
    message: error instanceof Error ? error.message : error,
    severity: context?.severity ?? "error",
    error: error instanceof Error ? error : undefined,
    context: context?.extra,
    userId: context?.userId,
    requestId: context?.requestId,
    tags: context?.tags,
    timestamp: new Date().toISOString(),
  };

  const fp = generateFingerprint(event);

  // Deduplicate — track frequency but don't re-log rapid duplicates
  const existing = errorCounts.get(fp);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastSeen = now;
    // Only re-log if it's been more than 60 seconds since last log
    if (now - existing.lastSeen < 60_000 && existing.count > 1) return;
  } else {
    if (errorCounts.size >= MAX_FINGERPRINTS) {
      // Evict oldest entries
      const sorted = Array.from(errorCounts.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (let i = 0; i < 1000; i++) errorCounts.delete(sorted[i][0]);
    }
    errorCounts.set(fp, { count: 1, lastSeen: now, firstSeen: now });
  }

  // Sample rate check
  if (Math.random() > ERROR_SAMPLE_RATE) return;

  // Log structured error
  const logData = {
    errorMessage: event.message,
    severity: event.severity,
    userId: event.userId,
    requestId: event.requestId,
    tags: event.tags,
    fingerprint: fp,
    stack: event.error?.stack?.split("\n").slice(0, 5).join(" | "),
    ...event.context,
  };

  switch (event.severity) {
    case "fatal":
      logger.fatal(logData, "[ErrorTracking] FATAL: %s", event.message);
      break;
    case "error":
      logger.error(logData, "[ErrorTracking] %s", event.message);
      break;
    case "warning":
      logger.warn(logData, "[ErrorTracking] %s", event.message);
      break;
    case "info":
      logger.info(logData, "[ErrorTracking] %s", event.message);
      break;
  }

  // Forward to Sentry if configured
  if (SENTRY_DSN) {
    forwardToSentry(event).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
  }
}

export function captureMessage(
  message: string,
  severity: ErrorSeverity = "info",
  context?: Record<string, unknown>
): void {
  captureError(message, { severity, extra: context });
}

export function getErrorStats(): {
  totalFingerprints: number;
  recentErrors: Array<{ fingerprint: string; count: number; lastSeen: string }>;
} {
  const recent = Array.from(errorCounts.entries())
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .slice(0, 20)
    .map(([fp, data]) => ({
      fingerprint: fp,
      count: data.count,
      lastSeen: new Date(data.lastSeen).toISOString(),
    }));

  return { totalFingerprints: errorCounts.size, recentErrors: recent };
}

async function forwardToSentry(event: ErrorEvent): Promise<void> {
  if (!SENTRY_DSN) return;
  try {
    // Sentry SDK integration point — import dynamically to avoid bundling
    // when Sentry is not configured
    const Sentry = await (import("@sentry/node") as any).catch(() => null);
    if (Sentry?.captureException) {
      if (event.error) {
        Sentry.captureException(event.error, {
          tags: event.tags,
          extra: event.context,
          user: event.userId ? { id: event.userId } : undefined,
        });
      } else if (Sentry.captureMessage) {
        Sentry.captureMessage(event.message, event.severity);
      }
    }
  } catch {
    // Sentry not available — silent degradation
  }
}

/**
 * Express error handler middleware.
 * Mount this LAST in the Express middleware chain.
 */
export function errorTrackingMiddleware() {
  return (err: Error, req: any, res: any, next: any) => {
    captureError(err, {
      severity: "error",
      userId: req.session?.userId,
      requestId: req.id ?? req.headers?.["x-request-id"],
      tags: {
        method: req.method,
        path: req.path,
        statusCode: String(res.statusCode),
      },
      extra: {
        query: req.query,
        userAgent: req.headers?.["user-agent"],
      },
    });
    next(err);
  };
}
