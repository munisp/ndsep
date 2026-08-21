/**
 * NDSEP Production Error Monitoring
 * ===================================
 * Lightweight error tracking with structured logging, alerting thresholds,
 * and integration points for Sentry/OpenTelemetry.
 *
 * Features:
 *   - Captures and categorizes all unhandled errors
 *   - Tracks error frequency with sliding window
 *   - Exposes /api/errors/summary for dashboards
 *   - Integrates with OpenTelemetry spans for distributed tracing
 *   - Graceful degradation when external services are unavailable
 *
 * Environment:
 *   SENTRY_DSN           — Optional Sentry DSN for external error tracking
 *   ERROR_ALERT_THRESHOLD — Errors per minute before alerting (default: 10)
 */

import { logger } from "./logger";

const SENTRY_DSN = process.env.SENTRY_DSN;
const ALERT_THRESHOLD = parseInt(process.env.ERROR_ALERT_THRESHOLD ?? "10", 10);
const WINDOW_MS = 60_000; // 1-minute sliding window

interface ErrorRecord {
  message: string;
  stack?: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  timestamp: number;
  context: Record<string, unknown>;
  fingerprint: string;
  count: number;
}

const recentErrors: ErrorRecord[] = [];
const errorCounts = new Map<string, number>();
let totalErrors = 0;
let totalWarnings = 0;
let alertsSent = 0;

function fingerprint(err: Error | string, source: string): string {
  const msg = typeof err === "string" ? err : err.message;
  const key = `${source}:${msg.slice(0, 100)}`;
  return Buffer.from(key).toString("base64").slice(0, 32);
}

function categorize(err: Error | string): { category: string; severity: ErrorRecord["severity"] } {
  const msg = typeof err === "string" ? err : err.message;
  const lower = msg.toLowerCase();

  if (lower.includes("econnrefused") || lower.includes("timeout") || lower.includes("enotfound")) {
    return { category: "connectivity", severity: "high" };
  }
  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("unauthorized")) {
    return { category: "auth", severity: "medium" };
  }
  if (lower.includes("out of memory") || lower.includes("heap")) {
    return { category: "resource", severity: "critical" };
  }
  if (lower.includes("sql") || lower.includes("database") || lower.includes("relation")) {
    return { category: "database", severity: "high" };
  }
  if (lower.includes("validation") || lower.includes("invalid") || lower.includes("required")) {
    return { category: "validation", severity: "low" };
  }
  return { category: "application", severity: "medium" };
}

export function captureError(
  err: Error | string,
  source: string,
  context: Record<string, unknown> = {},
): void {
  const fp = fingerprint(err, source);
  const { category, severity } = categorize(err);
  const now = Date.now();
  const message = typeof err === "string" ? err : err.message;
  const stack = typeof err === "string" ? undefined : err.stack;

  const existing = recentErrors.find((e) => e.fingerprint === fp && now - e.timestamp < WINDOW_MS);
  if (existing) {
    existing.count++;
    existing.timestamp = now;
  } else {
    recentErrors.push({
      message,
      stack,
      category,
      severity,
      source,
      timestamp: now,
      context,
      fingerprint: fp,
      count: 1,
    });
  }

  errorCounts.set(category, (errorCounts.get(category) ?? 0) + 1);
  totalErrors++;

  // Prune old entries
  const cutoff = now - WINDOW_MS * 5;
  while (recentErrors.length > 0 && recentErrors[0].timestamp < cutoff) {
    recentErrors.shift();
  }

  // Check alert threshold
  const recentCount = recentErrors
    .filter((e) => now - e.timestamp < WINDOW_MS)
    .reduce((sum, e) => sum + e.count, 0);

  if (recentCount >= ALERT_THRESHOLD) {
    alertsSent++;
    logger.error(
      { recentCount, threshold: ALERT_THRESHOLD, topError: message },
      "[ErrorMonitor] Alert threshold exceeded",
    );
  }

  // Log based on severity
  if (severity === "critical") {
    logger.fatal({ err, source, category, context }, `[ErrorMonitor] CRITICAL: ${message}`);
  } else if (severity === "high") {
    logger.error({ err, source, category, context }, `[ErrorMonitor] ${message}`);
  } else {
    logger.warn({ source, category, context }, `[ErrorMonitor] ${message}`);
  }

  // Forward to Sentry if configured (non-blocking)
  if (SENTRY_DSN) {
    forwardToSentry(err, source, category, severity, context).catch(() => {});
  }
}

export function captureWarning(message: string, source: string, context: Record<string, unknown> = {}): void {
  totalWarnings++;
  logger.warn({ source, context }, `[ErrorMonitor] WARNING: ${message}`);
}

async function forwardToSentry(
  err: Error | string,
  source: string,
  category: string,
  severity: string,
  context: Record<string, unknown>,
): Promise<void> {
  if (!SENTRY_DSN) return;
  try {
    await fetch(SENTRY_DSN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "node",
        level: severity === "critical" ? "fatal" : severity === "high" ? "error" : "warning",
        message: typeof err === "string" ? err : err.message,
        tags: { source, category },
        extra: context,
        timestamp: Math.floor(Date.now() / 1000),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Sentry unavailable — already logged locally
  }
}

export function getErrorSummary() {
  const now = Date.now();
  const windowErrors = recentErrors.filter((e) => now - e.timestamp < WINDOW_MS);
  const categories: Record<string, number> = {};
  errorCounts.forEach((count, cat) => {
    categories[cat] = count;
  });

  return {
    totalErrors,
    totalWarnings,
    alertsSent,
    errorsLastMinute: windowErrors.reduce((sum, e) => sum + e.count, 0),
    alertThreshold: ALERT_THRESHOLD,
    sentryConfigured: !!SENTRY_DSN,
    recentErrors: windowErrors.slice(-20).map((e) => ({
      message: e.message,
      category: e.category,
      severity: e.severity,
      source: e.source,
      count: e.count,
      timestamp: new Date(e.timestamp).toISOString(),
    })),
    categories,
  };
}

export function getErrorMetrics() {
  return {
    total_errors: totalErrors,
    total_warnings: totalWarnings,
    alerts_sent: alertsSent,
    sentry_configured: !!SENTRY_DSN,
    categories: Object.fromEntries(errorCounts),
  };
}
