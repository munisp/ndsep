/**
 * NDSEP Error Classification & Alert Routing
 * ============================================
 * Classifies errors into severity tiers and routes alerts accordingly.
 *
 * Recommendations: H11 (silent error handlers), M8 (structured alert routing)
 */

import { logger } from "./logger";

export type ErrorSeverity = "P1" | "P2" | "P3" | "P4";

export interface ClassifiedError {
  severity: ErrorSeverity;
  category: string;
  message: string;
  context: Record<string, unknown>;
  shouldAlert: boolean;
  alertChannel: "pagerduty" | "slack" | "email" | "log-only";
}

const P1_PATTERNS = [
  /database.*connection/i, /pool.*exhausted/i, /ECONNREFUSED.*5432/i,
  /auth.*service.*down/i, /jwt.*secret.*missing/i,
  /out of memory/i, /ENOMEM/i,
  /disk.*full/i, /ENOSPC/i,
  /certificate.*expired/i, /ssl.*handshake/i,
];

const P2_PATTERNS = [
  /payment.*failed/i, /stripe.*error/i,
  /encryption.*failed/i, /decrypt.*error/i,
  /data.*corrupt/i, /integrity.*violation/i,
  /timeout.*exceeded/i, /ETIMEDOUT/i,
  /redis.*connection/i, /ECONNREFUSED.*6379/i,
];

const P3_PATTERNS = [
  /validation.*error/i, /invalid.*input/i,
  /not.*found/i, /404/,
  /unauthorized/i, /forbidden/i,
  /rate.*limit/i, /too many requests/i,
  /duplicate.*key/i, /unique.*constraint/i,
];

/** Classify an error by severity tier */
export function classifyError(err: unknown, context: Record<string, unknown> = {}): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Check P1 patterns (critical infrastructure)
  for (const pattern of P1_PATTERNS) {
    if (pattern.test(message) || (stack && pattern.test(stack))) {
      return {
        severity: "P1",
        category: "infrastructure",
        message,
        context: { ...context, stack },
        shouldAlert: true,
        alertChannel: "pagerduty",
      };
    }
  }

  // Check P2 patterns (data/payment issues)
  for (const pattern of P2_PATTERNS) {
    if (pattern.test(message) || (stack && pattern.test(stack))) {
      return {
        severity: "P2",
        category: "data-integrity",
        message,
        context: { ...context, stack },
        shouldAlert: true,
        alertChannel: "slack",
      };
    }
  }

  // Check P3 patterns (user errors / expected failures)
  for (const pattern of P3_PATTERNS) {
    if (pattern.test(message) || (stack && pattern.test(stack))) {
      return {
        severity: "P3",
        category: "user-facing",
        message,
        context: { ...context, stack },
        shouldAlert: false,
        alertChannel: "log-only",
      };
    }
  }

  // Default: P4 (unknown)
  return {
    severity: "P4",
    category: "unknown",
    message,
    context: { ...context, stack },
    shouldAlert: false,
    alertChannel: "log-only",
  };
}

/** Log a classified error with appropriate severity */
export function logClassifiedError(classified: ClassifiedError): void {
  const logData = {
    severity: classified.severity,
    category: classified.category,
    alertChannel: classified.alertChannel,
    ...classified.context,
  };

  switch (classified.severity) {
    case "P1":
      logger.fatal(logData, `[P1-CRITICAL] ${classified.message}`);
      break;
    case "P2":
      logger.error(logData, `[P2-HIGH] ${classified.message}`);
      break;
    case "P3":
      logger.warn(logData, `[P3-MEDIUM] ${classified.message}`);
      break;
    default:
      logger.info(logData, `[P4-LOW] ${classified.message}`);
  }
}

/**
 * Safe error handler — replaces silent catch blocks.
 * Classifies, logs, and optionally alerts.
 */
export function handleError(err: unknown, context: Record<string, unknown> = {}): ClassifiedError {
  const classified = classifyError(err, context);
  logClassifiedError(classified);
  return classified;
}
