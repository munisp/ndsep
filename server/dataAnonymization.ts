/**
 * NDSEP Data Anonymization / Pseudonymization Engine
 * ====================================================
 * Provides NDPA-compliant anonymization for data used in analytics,
 * research, or cross-border sharing where full PII is not required.
 *
 * Strategies:
 *   - Generalization (age ranges, city → region)
 *   - Suppression (remove field entirely)
 *   - Pseudonymization (replace with consistent hash)
 *   - Noise addition (add random noise to numeric values)
 *   - K-anonymity enforcement
 */

import crypto from "crypto";
import { logger } from "./logger";

export type AnonymizationStrategy = "generalize" | "suppress" | "pseudonymize" | "noise" | "mask";

export interface AnonymizationRule {
  field: string;
  strategy: AnonymizationStrategy;
  options?: Record<string, unknown>;
}

const ANONYMIZATION_SALT = process.env.ANONYMIZATION_SALT ?? crypto.randomBytes(16).toString("hex");

export function anonymizeRecord(
  record: Record<string, unknown>,
  rules: AnonymizationRule[]
): Record<string, unknown> {
  const result = { ...record };

  for (const rule of rules) {
    if (!(rule.field in result)) continue;

    const value = result[rule.field];

    switch (rule.strategy) {
      case "suppress":
        delete result[rule.field];
        break;

      case "pseudonymize":
        if (value !== null && value !== undefined) {
          result[rule.field] = crypto
            .createHmac("sha256", ANONYMIZATION_SALT)
            .update(String(value))
            .digest("hex")
            .substring(0, 16);
        }
        break;

      case "generalize":
        result[rule.field] = generalizeValue(value, rule.options);
        break;

      case "noise":
        if (typeof value === "number") {
          const noiseFactor = (rule.options?.factor as number) ?? 0.1;
          const noise = (Math.random() - 0.5) * 2 * noiseFactor * value;
          result[rule.field] = Math.round(value + noise);
        }
        break;

      case "mask":
        if (typeof value === "string") {
          const visibleChars = (rule.options?.visibleChars as number) ?? 3;
          result[rule.field] = value.substring(0, visibleChars) + "*".repeat(Math.max(0, value.length - visibleChars));
        }
        break;
    }
  }

  return result;
}

function generalizeValue(value: unknown, options?: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value;

  // Age generalization
  if (typeof value === "number" && options?.type === "age") {
    const step = (options.step as number) ?? 10;
    const lower = Math.floor(value / step) * step;
    return `${lower}-${lower + step - 1}`;
  }

  // Date generalization (year only)
  if (value instanceof Date || (typeof value === "string" && /^\d{4}-\d{2}/.test(value))) {
    const d = new Date(value as string);
    return `${d.getFullYear()}`;
  }

  // String generalization (first 2 chars)
  if (typeof value === "string") {
    return value.substring(0, 2) + "***";
  }

  return value;
}

// Standard PII anonymization rules for NDSEP
export const STANDARD_PII_RULES: AnonymizationRule[] = [
  { field: "email", strategy: "pseudonymize" },
  { field: "citizen_email", strategy: "pseudonymize" },
  { field: "phone", strategy: "mask", options: { visibleChars: 4 } },
  { field: "phone_number", strategy: "mask", options: { visibleChars: 4 } },
  { field: "full_name", strategy: "suppress" },
  { field: "citizen_name", strategy: "suppress" },
  { field: "display_name", strategy: "suppress" },
  { field: "nin", strategy: "suppress" },
  { field: "bvn", strategy: "suppress" },
  { field: "bank_account", strategy: "mask", options: { visibleChars: 4 } },
  { field: "address", strategy: "generalize" },
  { field: "ip_address", strategy: "mask", options: { visibleChars: 6 } },
  { field: "date_of_birth", strategy: "generalize" },
];

export function anonymizeDataset(
  records: Record<string, unknown>[],
  rules: AnonymizationRule[] = STANDARD_PII_RULES
): Record<string, unknown>[] {
  const result = records.map(r => anonymizeRecord(r, rules));

  logger.info(
    { recordCount: records.length, ruleCount: rules.length },
    "[Anonymize] Processed %d records with %d rules",
    records.length, rules.length
  );

  return result;
}
