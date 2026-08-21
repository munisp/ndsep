/**
 * NDSEP Centralized Configuration — Environment Validation at Startup
 * ====================================================================
 * Validates all required environment variables at startup and provides
 * typed access. Fails fast with clear messages for missing config.
 *
 * Recommendations: M13 (env validation), H7 (no hardcoded localhost)
 */

import { logger } from "./logger";

export interface NdsepConfig {
  // Database
  databaseUrl: string;
  databaseReplicaUrl: string | null;
  // Auth
  jwtSecret: string;
  // Encryption
  fieldEncryptionKey: string | null;
  // Server
  port: number;
  nodeEnv: string;
  // Redis
  redisUrl: string;
  // External services
  otelEndpoint: string;
  sentryDsn: string | null;
  // Feature flags
  enableDemoLogin: boolean;
  enableCsrf: boolean;
  // Cors
  corsOrigins: string;
  // Backup
  backupS3Bucket: string | null;
  // Stripe
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  // VAPID (push notifications)
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidEmail: string | null;
}

/** Validate and load configuration. Throws on missing required vars in production. */
export function loadConfig(): NdsepConfig {
  const env = process.env;
  const isProd = env.NODE_ENV === "production";
  const errors: string[] = [];

  function required(name: string): string {
    const val = env[name];
    if (!val && isProd) errors.push(`Missing required env var: ${name}`);
    return val ?? "";
  }

  function optional(name: string, defaultVal: string = ""): string {
    return env[name] ?? defaultVal;
  }

  const config: NdsepConfig = {
    databaseUrl: required("DATABASE_URL") || `postgresql://${optional("PG_USER", "ndsep_user")}:${required("PG_PASSWORD")}@${optional("PG_HOST", "localhost")}:${optional("PG_PORT", "5432")}/${optional("PG_DATABASE", "ndsep_db")}`,
    databaseReplicaUrl: env.DATABASE_REPLICA_URL ?? null,
    jwtSecret: required("JWT_SECRET") || (isProd ? "" : "dev-jwt-secret-not-for-production-" + process.pid),
    fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY ?? null,
    port: parseInt(env.PORT ?? "3000", 10),
    nodeEnv: env.NODE_ENV ?? "development",
    redisUrl: optional("REDIS_URL", `redis://${optional("REDIS_HOST", "localhost")}:${optional("REDIS_PORT", "6379")}`),
    otelEndpoint: optional("OTEL_EXPORTER_OTLP_ENDPOINT", `http://${optional("OTEL_HOST", "localhost")}:4318/v1/traces`),
    sentryDsn: env.SENTRY_DSN ?? null,
    enableDemoLogin: env.ENABLE_DEMO_LOGIN === "true" || env.NODE_ENV !== "production",
    enableCsrf: env.ENFORCE_CSRF === "true" || isProd,
    corsOrigins: optional("CORS_ORIGINS", "*"),
    backupS3Bucket: env.BACKUP_S3_BUCKET ?? null,
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? null,
    vapidEmail: env.VAPID_EMAIL ?? null,
  };

  if (errors.length > 0) {
    const msg = `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join("\n")}`;
    logger.fatal(msg);
    throw new Error(msg);
  }

  // Warn about non-ideal config in development
  if (!isProd) {
    if (!config.fieldEncryptionKey) {
      logger.warn("[Config] FIELD_ENCRYPTION_KEY not set — PII encryption disabled");
    }
    if (!config.sentryDsn) {
      logger.info("[Config] SENTRY_DSN not set — error tracking disabled");
    }
  }

  return config;
}

/** Backwards-compatible export used by existing code */
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? `postgresql://${process.env.PG_USER ?? "ndsep_user"}:${process.env.PG_PASSWORD ?? ""}@${process.env.PG_HOST ?? "localhost"}:${parseInt(process.env.PG_PORT ?? "5432", 10)}/${process.env.PG_DATABASE ?? "ndsep_db"}`;
}
