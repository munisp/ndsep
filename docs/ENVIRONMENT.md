# NDSEP Environment Variables Reference

This document describes every environment variable used across the NDSEP platform, organized by service layer. All secrets must be managed through your secrets manager (Vault, AWS Secrets Manager, or the Manus platform secrets panel).

---

## Core Platform (Node.js API Server)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string | `postgresql://user:pass@host:5432/ndsep_db` |
| `JWT_SECRET` | ✅ | 64-byte secret for JWT signing | `openssl rand -base64 64` |
| `NODE_ENV` | ✅ | Runtime environment | `production` / `development` / `test` |
| `PORT` | ❌ | HTTP server port (default: 3000) | `3000` |
| `VITE_APP_ID` | ✅ | Manus OAuth application ID | `app_xxxxxxxxxxxx` |
| `OAUTH_SERVER_URL` | ✅ | Manus OAuth backend base URL | `https://api.manus.im` |
| `VITE_OAUTH_PORTAL_URL` | ✅ | Manus login portal URL | `https://manus.im/oauth` |
| `OWNER_OPEN_ID` | ✅ | Owner's Manus OpenID | `user_xxxxxxxxxxxx` |
| `OWNER_NAME` | ✅ | Owner's display name | `NDSEP Administrator` |
| `BUILT_IN_FORGE_API_URL` | ✅ | Manus built-in APIs base URL | `https://api.manus.im/forge` |
| `BUILT_IN_FORGE_API_KEY` | ✅ | Bearer token for Manus APIs (server) | `forge_xxxxxxxxxxxx` |
| `VITE_FRONTEND_FORGE_API_KEY` | ✅ | Bearer token for Manus APIs (frontend) | `forge_xxxxxxxxxxxx` |
| `VITE_FRONTEND_FORGE_API_URL` | ✅ | Manus APIs URL for frontend | `https://api.manus.im/forge` |
| `VITE_APP_TITLE` | ❌ | Application title | `NDSEP` |
| `VITE_APP_LOGO` | ❌ | Application logo URL | `https://cdn.../logo.png` |

---

## Caching (Redis)

| Variable | Required | Description | Example |
|---|---|---|---|
| `REDIS_URL` | ❌ | Redis connection URL (graceful degradation if absent) | `redis://:password@localhost:6379/0` |
| `REDIS_TLS` | ❌ | Enable TLS for Redis connection | `true` |
| `CACHE_TTL_SECONDS` | ❌ | Default cache TTL (default: 300) | `300` |

---

## Worker Services (All Go/Rust/Python Workers)

| Variable | Required | Description | Example |
|---|---|---|---|
| `WORKER_DATABASE_URL` | ✅ | PostgreSQL connection for workers | `postgresql://user:pass@host:5432/ndsep_db` |
| `WORKER_RELAY_URL` | ✅ | URL to post events to the API relay | `http://localhost:3000/api/workers/event` |
| `WORKER_RELAY_TOKEN` | ❌ | Bearer token for relay authentication | `openssl rand -hex 32` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ❌ | OpenTelemetry OTLP endpoint | `http://otel-collector:4318/v1/traces` |
| `OTEL_SERVICE_NAME` | ❌ | Override service name in traces | `ndsep-compliance-engine` |

---

## Compliance Engine (Go)

| Variable | Required | Description |
|---|---|---|
| `COMPLIANCE_PORT` | ❌ | HTTP port (default: 8081) |
| `COMPLIANCE_SCAN_INTERVAL` | ❌ | Scan interval in seconds (default: 30) |
| `COMPLIANCE_THRESHOLD_CRITICAL` | ❌ | Score below which is critical (default: 40) |

---

## ML Prediction Worker (Python)

| Variable | Required | Description |
|---|---|---|
| `ML_PORT` | ❌ | HTTP port (default: 8085) |
| `ML_MODEL_PATH` | ❌ | Path to pre-trained model file |
| `ML_PREDICTION_INTERVAL` | ❌ | Prediction interval in seconds (default: 25) |

---

## SIEM Correlator (Python)

| Variable | Required | Description |
|---|---|---|
| `SIEM_PORT` | ❌ | HTTP port (default: 8086) |
| `OPENCTI_URL` | ❌ | OpenCTI threat intelligence URL |
| `OPENCTI_TOKEN` | ❌ | OpenCTI API token |
| `WAZUH_API_URL` | ❌ | Wazuh manager API URL |
| `WAZUH_API_USER` | ❌ | Wazuh API username |
| `WAZUH_API_PASSWORD` | ❌ | Wazuh API password |

---

## Kafka Monitor (Go)

| Variable | Required | Description |
|---|---|---|
| `KAFKA_BROKERS` | ❌ | Comma-separated Kafka broker list | `kafka1:9092,kafka2:9092` |
| `KAFKA_CONSUMER_GROUP` | ❌ | Consumer group ID | `ndsep-monitor` |
| `KAFKA_SASL_USERNAME` | ❌ | SASL username for Kafka auth |
| `KAFKA_SASL_PASSWORD` | ❌ | SASL password for Kafka auth |
| `KAFKA_TLS_ENABLED` | ❌ | Enable TLS for Kafka | `true` |

---

## Temporal Workflow Engine (Go)

| Variable | Required | Description |
|---|---|---|
| `TEMPORAL_HOST` | ❌ | Temporal server host (default: localhost:7233) |
| `TEMPORAL_NAMESPACE` | ❌ | Temporal namespace (default: ndsep) |
| `TEMPORAL_TLS_CERT` | ❌ | Path to client TLS certificate |
| `TEMPORAL_TLS_KEY` | ❌ | Path to client TLS key |

---

## BGP Validator (Rust)

| Variable | Required | Description |
|---|---|---|
| `BGP_PORT` | ❌ | HTTP port (default: 8088) |
| `RPKI_VALIDATOR_URL` | ❌ | Routinator RPKI validator URL |
| `BGP_SCAN_INTERVAL` | ❌ | Scan interval in seconds (default: 60) |

---

## Data Residency Enforcer (Rust)

| Variable | Required | Description |
|---|---|---|
| `RESIDENCY_PORT` | ❌ | HTTP port (default: 8089) |
| `GEOFENCE_GEOJSON_PATH` | ❌ | Path to national border GeoJSON file |
| `POSTGIS_URL` | ❌ | PostGIS-enabled PostgreSQL URL |

---

## Financial Ledger (Rust / TigerBeetle)

| Variable | Required | Description |
|---|---|---|
| `TIGERBEETLE_ADDRESS` | ❌ | TigerBeetle cluster address | `3000` (port) |
| `TIGERBEETLE_CLUSTER_ID` | ❌ | TigerBeetle cluster ID | `0` |

---

## mTLS Configuration

| Variable | Required | Description |
|---|---|---|
| `MTLS_CA_CERT` | ❌ | Path to CA certificate | `./certs/ca/ca.crt` |
| `MTLS_SERVER_CERT` | ❌ | Path to server certificate | `./certs/server/server.crt` |
| `MTLS_SERVER_KEY` | ❌ | Path to server private key | `./certs/server/server.key` |
| `MTLS_ENABLED` | ❌ | Enable mTLS enforcement | `true` |
| `MTLS_VERIFY_CLIENT` | ❌ | Require client certificates | `true` |

---

## Analytics

| Variable | Required | Description |
|---|---|---|
| `VITE_ANALYTICS_ENDPOINT` | ❌ | Analytics collection endpoint |
| `VITE_ANALYTICS_WEBSITE_ID` | ❌ | Analytics website identifier |

---

## Secret Rotation Schedule

| Secret | Rotation Frequency | Method |
|---|---|---|
| `JWT_SECRET` | Every 90 days | `./security/rotate-secrets.sh --component jwt` |
| `DATABASE_URL` password | Every 180 days | `./security/rotate-secrets.sh --component db` |
| `WORKER_RELAY_TOKEN` | Every 90 days | `./security/rotate-secrets.sh --component relay` |
| `REDIS_URL` password | Every 180 days | `./security/rotate-secrets.sh --component redis` |
| mTLS certificates | Annually | `./security/mtls/generate-certs.sh` |

---

## Security Checklist

- [ ] All secrets stored in secrets manager (never in `.env` files committed to git)
- [ ] `JWT_SECRET` is at least 64 bytes of cryptographically random data
- [ ] `DATABASE_URL` uses TLS (`sslmode=require` or `sslmode=verify-full`)
- [ ] `REDIS_URL` uses TLS in production
- [ ] mTLS certificates generated and distributed to all worker services
- [ ] `MTLS_ENABLED=true` in production
- [ ] `NODE_ENV=production` in production
- [ ] All worker `WORKER_DATABASE_URL` values use read-only replica where possible
- [ ] Secret rotation schedule configured in your CI/CD or cron system
