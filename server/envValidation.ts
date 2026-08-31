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
  minimumLength?: number;
}

const SECURITY_SENSITIVE_VARS: EnvRule[] = [
  {
    name: "JWT_SECRET",
    insecureDefaults: ["", "dev-test-secret-key-at-least-32-chars-long"],
    minimumLength: 32,
    description: "Session signing key — unsigned tokens if missing or predictable",
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
    minimumLength: 32,
    description: "API key hashing salt — predictable hashes if using default",
  },
  {
    name: "WEBHOOK_SIGNING_SECRET",
    insecureDefaults: ["ndsep_webhook_signing_secret_2026_default", ""],
    minimumLength: 32,
    description: "Webhook signature key — signatures forgeable with default",
  },
  {
    name: "APISIX_ADMIN_KEY",
    insecureDefaults: ["CHANGE_ME_IN_PRODUCTION", ""],
    minimumLength: 32,
    description: "APISIX admin API key — gateway admin accessible with known key",
  },
  {
    name: "DATABASE_URL",
    insecureDefaults: [""],
    description: "PostgreSQL connection string — server cannot function without DB",
  },
  {
    name: "REDIS_URL",
    insecureDefaults: ["", "redis://localhost:6379"],
    description: "Redis transport — production rate limiting and replay protection require a non-default TLS endpoint",
  },
  {
    name: "WORKER_EVENT_HMAC_SECRET",
    insecureDefaults: [""],
    description: "Worker-event authentication secret — unsigned worker events must not be accepted",
  },
  {
    name: "CORS_ORIGINS",
    insecureDefaults: ["", "*"],
    description: "CORS origin allow-list — wildcard origins are not permitted in production",
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

function isPlaceholderValue(value: string): boolean {
  return /(?:CHANGE_ME|PLACEHOLDER|_DEFAULT(?:_|$)|example\.)/i.test(value);
}

function invalidProductionCorsOrigins(value: string): string[] {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) return ["CORS_ORIGINS must contain at least one explicit HTTPS origin"];

  const errors: string[] = [];
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.origin !== origin ||
        url.username ||
        url.password ||
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      ) {
        errors.push(origin);
      }
    } catch {
      errors.push(origin);
    }
  }
  return errors;
}

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
    if (
      rule.insecureDefaults.includes(value) ||
      isPlaceholderValue(value) ||
      (rule.minimumLength !== undefined && value.length < rule.minimumLength)
    ) {
      if (isProduction) {
        errors.push(`  ${rule.name}: ${rule.description}`);
      } else {
        warnings.push(`  ${rule.name}: ${rule.description} (using dev default)`);
      }
    }
  }

  if (isProduction) {
    if (!/^rediss:\/\//.test(process.env.REDIS_URL ?? "")) {
      errors.push("  REDIS_URL: production replay protection requires a rediss:// endpoint with a private CA/identity policy");
    }
    const invalidCorsOrigins = invalidProductionCorsOrigins(process.env.CORS_ORIGINS ?? "");
    if (invalidCorsOrigins.length > 0) {
      errors.push(`  CORS_ORIGINS: production origins must be explicit HTTPS origins without paths, credentials, or localhost values (${invalidCorsOrigins.join(", ")})`);
    }
    if ((process.env.WORKER_EVENT_HMAC_SECRET ?? "").length < 32) {
      errors.push("  WORKER_EVENT_HMAC_SECRET: must be a high-entropy secret of at least 32 characters");
    }
    if (!/^[a-f0-9]{64}$/i.test(process.env.FIELD_ENCRYPTION_KEY ?? "")) {
      errors.push("  FIELD_ENCRYPTION_KEY: must be exactly 32 random bytes encoded as 64 hexadecimal characters");
    }
    if ((process.env.LAKEHOUSE_ENABLED ?? "false") === "true") {
      if (!/^https:\/\//.test(process.env.LAKEHOUSE_CATALOG_URL ?? "")) {
        errors.push("  LAKEHOUSE_CATALOG_URL: enabled production lakehouse requires an https:// catalog endpoint");
      }
      for (const key of ["LAKEHOUSE_S3_ACCESS_KEY", "LAKEHOUSE_S3_SECRET_KEY"]) {
        const value = process.env[key] ?? "";
        if (value.length < 16 || value === "minioadmin") {
          errors.push(`  ${key}: enabled production lakehouse requires a non-default credential of at least 16 characters`);
        }
      }
    }
    if ((process.env.PERMIFY_ENABLED ?? "false") === "true") {
      if (!/^https:\/\//.test(process.env.PERMIFY_URL ?? "")) {
        errors.push("  PERMIFY_URL: enabled production authorization requires an https:// endpoint");
      }
      if ((process.env.PERMIFY_AUTH_TOKEN ?? "").length < 32) {
        errors.push("  PERMIFY_AUTH_TOKEN: enabled production authorization requires a high-entropy bearer credential");
      }
    }
  }

  for (const rule of SECTOR_API_KEYS) {
    const value = process.env[rule.name] ?? "";
    if (
      rule.insecureDefaults.includes(value) ||
      isPlaceholderValue(value) ||
      (rule.minimumLength !== undefined && value.length < rule.minimumLength)
    ) {
      if (isProduction) {
        warnings.push(`  ${rule.name}: ${rule.description} — sector monitor will fail API calls`);
      }
    }
  }

  for (const rule of INFRASTRUCTURE_VARS) {
    const value = process.env[rule.name] ?? "";
    if (
      rule.insecureDefaults.includes(value) ||
      isPlaceholderValue(value) ||
      (rule.minimumLength !== undefined && value.length < rule.minimumLength)
    ) {
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
