export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  // ── Email & Alerting ─────────────────────────────────────────────────────
  // Priority 1: SMTP (nodemailer) — set SMTP_HOST + SMTP_USER + SMTP_PASS.
  //   Example: smtp.nitda.gov.ng:587 with STARTTLS, or smtp.gmail.com:465 with SSL.
  // Priority 2: Resend — set RESEND_API_KEY (transactional email SaaS).
  // Priority 3: Manus Forge notification relay (always available, zero config).
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
  smtpSecure: process.env.SMTP_SECURE === "true",   // true = TLS on port 465; false = STARTTLS on 587
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "NDSEP Platform <noreply@ndsep.nitda.gov.ng>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "NDSEP Platform <noreply@ndsep.nitda.gov.ng>",
  platformUrl: process.env.PLATFORM_URL ?? "https://ndsep.nitda.gov.ng",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
  pagerdutyKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? "",
  nitdaComplianceEmail: process.env.NITDA_COMPLIANCE_EMAIL ?? "compliance@nitda.gov.ng",

  // ── Temporal Cloud / self-hosted Temporal ─────────────────────────────────
  // Set TEMPORAL_ADDRESS to <namespace>.tmprl.cloud:7233 for Temporal Cloud.
  // Set TEMPORAL_TLS_CERT + TEMPORAL_TLS_KEY for mTLS auth (Temporal Cloud).
  // Set TEMPORAL_API_KEY for API-key auth (newer Temporal Cloud accounts).
  // Leave all unset to use local Docker Temporal (localhost:7233).
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main",
  temporalTlsCert: process.env.TEMPORAL_TLS_CERT ?? "",
  temporalTlsKey: process.env.TEMPORAL_TLS_KEY ?? "",
  temporalApiKey: process.env.TEMPORAL_API_KEY ?? "",

  // ── Kafka Staging ─────────────────────────────────────────────────────────
  // Set KAFKA_BROKERS to comma-separated broker list for staging/production.
  // For Confluent Cloud: <cluster>.confluent.cloud:9092
  // Set KAFKA_SASL_USER + KAFKA_SASL_PASS for SASL/PLAIN auth (Confluent / MSK).
  // Set KAFKA_SSL=true to enable TLS (required for Confluent Cloud).
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "localhost:9092",
  kafkaSaslUser: process.env.KAFKA_SASL_USER ?? "",
  kafkaSaslPass: process.env.KAFKA_SASL_PASS ?? "",
  kafkaSsl: process.env.KAFKA_SSL === "true",

  // ── Redis ─────────────────────────────────────────────────────────────────
  // Set REDIS_URL for production Redis (e.g., redis://:password@host:6379/0).
  // Defaults to local Docker Redis.
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  redisPassword: process.env.REDIS_PASSWORD ?? "",
  redisTls: process.env.REDIS_TLS === "true",

  // ── APISIX API Gateway ────────────────────────────────────────────────────
  // Set APISIX_ADMIN_URL to your APISIX admin API endpoint.
  // Set APISIX_ADMIN_KEY to the APISIX admin API key (X-API-KEY header).
  // Set APISIX_GATEWAY_URL to the APISIX proxy base URL for routing.
  apisixAdminUrl: process.env.APISIX_ADMIN_URL ?? "http://localhost:9180",
  apisixAdminKey: process.env.APISIX_ADMIN_KEY ?? "",
  apisixGatewayUrl: process.env.APISIX_GATEWAY_URL ?? "http://localhost:9080",
  apisixEnabled: process.env.APISIX_ENABLED !== "false",

  // ── Keycloak IAM ──────────────────────────────────────────────────────────
  // Set KEYCLOAK_URL to your Keycloak server (e.g., https://auth.ndsep.gov.ng).
  // Set KEYCLOAK_REALM (default: ndsep), KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET.
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "ndsep",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "ndsep-platform",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  keycloakEnabled: process.env.KEYCLOAK_ENABLED !== "false",

  // ── Permify Authorization ─────────────────────────────────────────────────
  // Set PERMIFY_URL to your Permify server (e.g., http://permify:3476).
  // Set PERMIFY_TENANT_ID (default: t1) and PERMIFY_SCHEMA_VERSION.
  permifyUrl: process.env.PERMIFY_URL ?? "http://localhost:3476",
  permifyTenantId: process.env.PERMIFY_TENANT_ID ?? "t1",
  permifySchemaVersion: process.env.PERMIFY_SCHEMA_VERSION ?? "",
  permifyEnabled: process.env.PERMIFY_ENABLED !== "false",

  // ── TigerBeetle Ledger ────────────────────────────────────────────────────
  // Set TIGERBEETLE_CLUSTER_ID and TIGERBEETLE_ADDRESSES for production.
  // The TigerBeetle ledger Go service runs on port 8240.
  tigerbeetleClusterId: process.env.TIGERBEETLE_CLUSTER_ID ?? "0",
  tigerbeetleAddresses: process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3000",
  tigerbeetleServiceUrl: process.env.TIGERBEETLE_SERVICE_URL ?? "http://localhost:8240",
  tigerbeetleEnabled: process.env.TIGERBEETLE_ENABLED !== "false",

  // ── Fluvio Edge Streaming ─────────────────────────────────────────────────
  // Set FLUVIO_HTTP_URL for the Fluvio HTTP proxy endpoint.
  // Set FLUVIO_SC_HOST + FLUVIO_SC_PORT for direct SC (streaming controller) access.
  fluvioHttpUrl: process.env.FLUVIO_HTTP_URL ?? "http://localhost:9003",
  fluvioScHost: process.env.FLUVIO_SC_HOST ?? "localhost",
  fluvioScPort: parseInt(process.env.FLUVIO_SC_PORT ?? "9003", 10),
  fluvioEnabled: process.env.FLUVIO_ENABLED !== "false",

  // ── Dapr Sidecar ─────────────────────────────────────────────────────────
  // Set DAPR_HTTP_PORT (default 3500) and DAPR_GRPC_PORT (default 50001).
  // Set DAPR_APP_ID to the Dapr application ID for this service.
  daprHttpPort: parseInt(process.env.DAPR_HTTP_PORT ?? "3500", 10),
  daprGrpcPort: parseInt(process.env.DAPR_GRPC_PORT ?? "50001", 10),
  daprAppId: process.env.DAPR_APP_ID ?? "ndsep-platform",
  daprEnabled: process.env.DAPR_ENABLED !== "false",

  // ── Lakehouse / Apache Iceberg ────────────────────────────────────────────
  // Set LAKEHOUSE_CATALOG_URL for Apache Iceberg REST catalog endpoint.
  // Set LAKEHOUSE_S3_ENDPOINT, LAKEHOUSE_S3_BUCKET for object storage.
  lakehouseCatalogUrl: process.env.LAKEHOUSE_CATALOG_URL ?? "http://localhost:8181",
  lakehouseS3Endpoint: process.env.LAKEHOUSE_S3_ENDPOINT ?? "http://localhost:9000",
  lakehouseS3Bucket: process.env.LAKEHOUSE_S3_BUCKET ?? "ndsep-lakehouse",
  lakehouseS3AccessKey: process.env.LAKEHOUSE_S3_ACCESS_KEY ?? "",
  lakehouseS3SecretKey: process.env.LAKEHOUSE_S3_SECRET_KEY ?? "",
  lakehouseEnabled: process.env.LAKEHOUSE_ENABLED === "true",

  // ── Orchestration Service URLs ────────────────────────────────────────────
  // These are the internal ports for the orchestration Go/Python services.
  // Override with ORCHESTRATION_* env vars if running in separate containers.
  orchestrationApiGatewayUrl: process.env.ORCHESTRATION_API_GATEWAY_URL ?? "http://localhost:8130",
  orchestrationEventBusUrl: process.env.ORCHESTRATION_EVENT_BUS_URL ?? "http://localhost:8160",
  orchestrationIamServiceUrl: process.env.ORCHESTRATION_IAM_SERVICE_URL ?? "http://localhost:8150",
  orchestrationTigerbeetleUrl: process.env.ORCHESTRATION_TIGERBEETLE_URL ?? "http://localhost:8240",
  orchestrationWorkflowEngineUrl: process.env.ORCHESTRATION_WORKFLOW_ENGINE_URL ?? "http://localhost:8170",
  orchestrationDaprBindingsUrl: process.env.ORCHESTRATION_DAPR_BINDINGS_URL ?? "http://localhost:8120",
  orchestrationLakehouseUrl: process.env.ORCHESTRATION_LAKEHOUSE_URL ?? "http://localhost:8140",
  orchestrationMlPipelineUrl: process.env.ORCHESTRATION_ML_PIPELINE_URL ?? "http://localhost:8125",

  // ── Termii SMS Enforcement Alerts ─────────────────────────────────────────
  termiiApiKey: process.env.TERMII_API_KEY ?? "",
  termiiBaseUrl: process.env.TERMII_BASE_URL ?? "https://api.ng.termii.com",
  termiiSenderId: process.env.TERMII_SENDER_ID ?? "NDSEP",
  termiiEnabled: process.env.TERMII_ENABLED === "true",
  ndpcPhoneNumber: process.env.NDPC_PHONE_NUMBER ?? "+2348012345678",
  ndpcEmail: process.env.NDPC_EMAIL ?? "enforcement@ndpc.gov.ng",
  slaAlertEmail: process.env.SLA_ALERT_EMAIL ?? "sla-alerts@ndsep.nitda.gov.ng",

  // ── PDF Generation & Certificate Service ─────────────────────────────────
  pdfBaseUrl: process.env.PDF_BASE_URL ?? "https://certs.ndsep.gov.ng/pdf",
  certVerifyBaseUrl: process.env.CERT_VERIFY_BASE_URL ?? "https://verify.ndsep.gov.ng/cert",
  certIssuerName: process.env.CERT_ISSUER_NAME ?? "National Information Technology Development Agency (NITDA)",
  certIssuerUrl: process.env.CERT_ISSUER_URL ?? "https://nitda.gov.ng",
  certValidityDays: parseInt(process.env.CERT_VALIDITY_DAYS ?? "365", 10),
  carSubmissionEmail: process.env.CAR_SUBMISSION_EMAIL ?? "car@ndpc.gov.ng",
  carDeadlineDay: parseInt(process.env.CAR_DEADLINE_DAY ?? "31", 10),

  // ── Document Vault (S3) ───────────────────────────────────────────────────
  vaultS3Endpoint: process.env.VAULT_S3_ENDPOINT ?? "https://s3.amazonaws.com",
  vaultS3Bucket: process.env.VAULT_S3_BUCKET ?? "ndsep-document-vault",
  vaultS3Region: process.env.VAULT_S3_REGION ?? "eu-west-1",
  vaultMaxFileSizeMb: parseInt(process.env.VAULT_MAX_FILE_SIZE_MB ?? "50", 10),

  // ── API Key Management ────────────────────────────────────────────────────
  apiKeySalt: process.env.API_KEY_SALT ?? "",
  apiKeyPrefix: process.env.API_KEY_PREFIX ?? "ndsep_live_",
  apiKeyTestPrefix: process.env.API_KEY_TEST_PREFIX ?? "ndsep_test_",

  // ── Webhook Delivery ──────────────────────────────────────────────────────
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET ?? "",
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? "10000", 10),
  webhookMaxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES ?? "3", 10),

  // ── AI Risk Scoring Engine ────────────────────────────────────────────────
  aiRiskModelVersion: process.env.AI_RISK_MODEL_VERSION ?? "ndsep-risk-v2.1.0",
  aiRiskThresholdCritical: parseFloat(process.env.AI_RISK_THRESHOLD_CRITICAL ?? "0.75"),
  aiRiskThresholdHigh: parseFloat(process.env.AI_RISK_THRESHOLD_HIGH ?? "0.50"),
  aiRiskThresholdMedium: parseFloat(process.env.AI_RISK_THRESHOLD_MEDIUM ?? "0.25"),
  rescoringBatchSize: parseInt(process.env.RESCORING_BATCH_SIZE ?? "100", 10),
};
