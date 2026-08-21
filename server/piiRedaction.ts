/**
 * NDSEP PII Redaction for Logging
 * ================================
 * Configures pino log redaction to prevent PII from appearing in logs.
 * Replaces sensitive values with [REDACTED].
 *
 * Recommendation M2: Request/response logging with PII redaction
 */

/** Pino redaction paths configuration */
export const PII_REDACTION_PATHS = [
  // Request body PII
  "req.body.citizenEmail",
  "req.body.citizenName",
  "req.body.citizenNin",
  "req.body.citizenPhone",
  "req.body.citizenBvn",
  "req.body.email",
  "req.body.phone",
  "req.body.nin",
  "req.body.bvn",
  "req.body.bankAccountNumber",
  "req.body.accountNumber",
  "req.body.name",
  "req.body.fullName",
  "req.body.password",
  "req.body.secret",
  // Query parameters
  "req.query.email",
  "req.query.nin",
  "req.query.phone",
  // Response body (if logged)
  "res.body.email",
  "res.body.citizenEmail",
  "res.body.citizenName",
  // Wildcard patterns for nested objects
  "*.email",
  "*.citizenEmail",
  "*.nin",
  "*.bvn",
  "*.citizenNin",
  "*.citizenBvn",
  "*.password",
  "*.secret",
  "*.apiKey",
  "*.token",
];

/** Pino redaction config object for use in logger initialization */
export const pinoRedactionConfig = {
  paths: PII_REDACTION_PATHS,
  censor: "[REDACTED]",
};

/**
 * Manually redact PII from an object (for non-pino logging contexts).
 * Replaces known PII field values with [REDACTED].
 */
const PII_FIELD_NAMES = new Set([
  "email", "citizenEmail", "citizenName", "citizenNin", "citizenPhone",
  "citizenBvn", "nin", "bvn", "phone", "bankAccountNumber", "accountNumber",
  "password", "secret", "apiKey", "token", "fullName", "name",
]);

export function redactPii(obj: unknown, depth = 0): unknown {
  if (depth > 5) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(item => redactPii(item, depth + 1));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (PII_FIELD_NAMES.has(key) && typeof value === "string") {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactPii(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}
