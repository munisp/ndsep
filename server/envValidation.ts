/**
 * NDSEP Environment Variable Validation
 *
 * Validates that security-sensitive environment variables are set
 * before allowing the server to start in production mode.
 * In development mode, missing values log warnings but don't halt startup.
 */

import { logger } from "./logger";

interface EnvRule {
  name: string;
  insecureDefaults: string[];
  description: string;
}

const SECURITY_SENSITIVE_VARS: EnvRule[] = [
  {
    name: "JWT_SECRET",
    insecureDefaults: ["", "dev-test-secret-key-at-least-32-chars-long"],
    description: "Session signing key — unsigned tokens if missing",
  },
  {
    name: "FIELD_ENCRYPTION_KEY",
    insecureDefaults: [""],
    description: "AES-256-GCM PII encryption key — data stored in plaintext if missing",
  },
  {
    name: "TERMII_API_KEY",
    insecureDefaults: ["TLtest_default_key_ndsep_2026", ""],
    description: "SMS notification API key — enforcement alerts will fail",
  },
  {
    name: "NDPC_PHONE_NUMBER",
    insecureDefaults: ["+2348012345678"],
    description: "NDPC enforcement phone — SMS sent to placeholder number",
  },
  {
    name: "API_KEY_SALT",
    insecureDefaults: ["ndsep_api_key_salt_2026_production_default", ""],
    description: "API key hashing salt — predictable hashes if using default",
  },
  {
    name: "WEBHOOK_SIGNING_SECRET",
    insecureDefaults: ["ndsep_webhook_signing_secret_2026_default", ""],
    description: "Webhook signature key — signatures forgeable with default",
  },
  {
    name: "APISIX_ADMIN_KEY",
    insecureDefaults: ["CHANGE_ME_IN_PRODUCTION", ""],
    description: "APISIX admin API key — gateway admin accessible with known key",
  },
  {
    name: "DATABASE_URL",
    insecureDefaults: [""],
    description: "PostgreSQL connection string — server cannot function without DB",
  },
];

const SECTOR_API_KEYS: EnvRule[] = [
  { name: "NCC_API_KEY", insecureDefaults: ["ncc-api-key-placeholder", ""], description: "NCC (telecom) regulator API key" },
  { name: "NHIA_API_KEY", insecureDefaults: ["nhia-api-key-placeholder", ""], description: "NHIA (healthcare) regulator API key" },
  { name: "NERC_API_KEY", insecureDefaults: ["nerc-api-key-placeholder", ""], description: "NERC (energy) regulator API key" },
  { name: "DPR_API_KEY", insecureDefaults: ["dpr-api-key-placeholder", ""], description: "DPR (oil/gas) regulator API key" },
  { name: "NAICOM_API_KEY", insecureDefaults: ["naicom-api-key-placeholder", ""], description: "NAICOM (insurance) regulator API key" },
  { name: "CBN_FINTECH_API_KEY", insecureDefaults: ["cbn-fintech-api-key-placeholder", ""], description: "CBN (fintech) regulator API key" },
];

const INFRASTRUCTURE_VARS: EnvRule[] = [
  { name: "LAKEHOUSE_S3_ACCESS_KEY", insecureDefaults: ["minioadmin"], description: "Lakehouse S3 access key — using MinIO dev default" },
  { name: "LAKEHOUSE_S3_SECRET_KEY", insecureDefaults: ["minioadmin"], description: "Lakehouse S3 secret key — using MinIO dev default" },
];

/**
 * Validate environment variables at server startup.
 * In production: throws if any critical security variable uses an insecure default.
 * In development: logs warnings for missing variables.
 */
export function validateEnvironment(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of SECURITY_SENSITIVE_VARS) {
    const value = process.env[rule.name] ?? "";
    if (rule.insecureDefaults.includes(value)) {
      if (isProduction) {
        errors.push(`  ${rule.name}: ${rule.description}`);
      } else {
        warnings.push(`  ${rule.name}: ${rule.description} (using dev default)`);
      }
    }
  }

  for (const rule of SECTOR_API_KEYS) {
    const value = process.env[rule.name] ?? "";
    if (rule.insecureDefaults.includes(value)) {
      if (isProduction) {
        warnings.push(`  ${rule.name}: ${rule.description} — sector monitor will fail API calls`);
      }
    }
  }

  for (const rule of INFRASTRUCTURE_VARS) {
    const value = process.env[rule.name] ?? "";
    if (rule.insecureDefaults.includes(value)) {
      if (isProduction) {
        warnings.push(`  ${rule.name}: ${rule.description}`);
      }
    }
  }

  if (warnings.length > 0) {
    logger.warn(
      { count: warnings.length },
      `[ENV] ${warnings.length} environment variable warning(s):\n${warnings.join("\n")}`
    );
  }

  if (errors.length > 0) {
    const message =
      `[ENV] FATAL: ${errors.length} security-critical environment variable(s) missing or using insecure defaults.\n` +
      `The server CANNOT start in production mode without these:\n\n` +
      errors.join("\n") +
      `\n\nSet these environment variables and restart. See .env.production.example for reference.`;

    logger.fatal({ count: errors.length }, message);
    throw new Error(message);
  }

  logger.info("[ENV] Environment validation passed");
}
