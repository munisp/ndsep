# NDSEP Full-Stack Audit and Remediation Report

**Branch:** `audit/full-stack-remediation`
**Scope:** Repository-wide frontend, backend, database, middleware, infrastructure, AI, and silent-mockware assessment and remediation.
**Date:** 2026-08-13

## Executive Summary

The audit found that the repository contained several high-risk conditions: an incomplete database migration journal, schema objects referenced by APIs but absent from the canonical ORM model, duplicate frontend routes, authorization fail-open paths, fabricated mobile and AI responses, in-memory implementations presented as TigerBeetle and Temporal workflows, and invalid deployment manifests. The remediation consolidates PostgreSQL onto a verified Drizzle migration path, makes security-sensitive boundaries fail closed, replaces the in-memory TigerBeetle proxy with an official-client implementation, and introduces targeted contract tests.

> **Safety posture:** Where a real upstream service, trained model, verified biometric backend, or source dataset is unavailable, the remediated code returns an explicit error or unhealthy status. It does not manufacture a plausible result.

## Verified Outcomes

| Area | Remediation | Verification evidence | Status |
|---|---|---|---|
| PostgreSQL schema | Repaired migration ordering and metadata; added canonical reconciliation, runtime-contract, mobile-push-device, and foreign-key-index migrations. | Fresh migration execution completed with **153 public tables** and **28 recorded migrations**. Strict verifier passed. | Passed |
| API/database readiness | Replaced stale migration verification and divergent migration wrapper with native Drizzle migration and strict startup verification. | Migration verifier passed against `ndsep_final_migration_e2e`. | Passed |
| Frontend routing | Eliminated duplicate routes and added aliases for valid unresolved navigation targets. | Static route and internal-link audit completed; TypeScript validation passed. | Passed |
| Keycloak | Hardened token validation and stopped invalid bearer headers from falling through to unrelated sessions. | TypeScript validation and focused Keycloak tests passed. | Passed |
| Permify | Changed protected authorization decisions and writes to fail closed on upstream errors. Added explicit authorization decisions to isolated unit fixtures rather than weakening production code. | Full test suite passed. | Passed |
| Temporal | Removed HTTP/local workflow-start fallback; workflow submissions now require the official SDK and a reachable broker. | Dedicated outage contract test passed. | Passed |
| TigerBeetle | Replaced the Go in-memory ledger proxy with the official `tigerbeetle-go` client, deterministic idempotency keys, account creation, durable transfers, real balances, and a formatted-replica Compose topology. Disabled the unsafe Rust in-memory ledger executable. | Go package test passed; four fail-closed TypeScript contract tests passed; orchestration Compose validation passed. | Passed |
| Mobile REST API | Replaced fabricated fallback payloads and insecure password-only issuance with canonical persisted contracts and explicit failure behavior. | Full migration journal and TypeScript validation passed. | Passed |
| AI and biometric paths | Removed synthetic ML training/time-series data, randomized KYC outcomes, pseudo face embeddings, and missing-analysis biometric approval. Added persisted model loading and explicit inference-unavailable responses. | Python compilation and CPU-AI fail-closed smoke test passed. | Conditionally ready |
| Dapr, lakehouse, Fluvio workers | Reworked identified Python worker paths to use configured real sidecar, object-store, and official Fluvio-client operations; failed calls remain unacknowledged. | Python syntax validation passed. | Requires runtime services |
| Compose manifests | Repaired orchestration YAML, TigerBeetle initialization/topology, middleware duplicate volume structure, and production structural validation. | Primary, middleware, dataops, intelligence, orchestration, and production manifests passed `docker compose config`. | Passed structurally |
| Regression protection | Added TigerBeetle and Temporal fail-closed tests and updated existing router fixtures to model explicit authorization. | **73 test files, 928 tests passed**. | Passed |

## Principal Security and Correctness Changes

The database migration chain is now the single canonical deployment path. Application startup invokes migration processing and a strict verifier before reporting ready. The verifier checks required tables, expected columns, Drizzle migration history, foreign-key integrity, and foreign-key index coverage. This eliminates the prior condition where readiness could report success while a clean database had only a subset of the schema.

The authorization model now rejects invalid bearer tokens rather than silently attempting another identity mechanism. Administrative mutations retain role checks but also require a successful relationship-based authorization decision. Upstream Permify errors are explicit denials rather than an implicit permit. Financial transaction recording and workflow dispatch likewise propagate failure: a failed TigerBeetle or Temporal submission cannot be treated as a completed business event.

The TigerBeetle replacement follows the official client model of a shared client, durable accounts, and `CreateTransfers` journal entries with returned status codes. Account and transfer identifiers are deterministic across retries, so repeat calls are handled through TigerBeetle idempotency semantics rather than process memory. [1]

## Runtime Prerequisites and Residual Risks

The repository now fails safely when these prerequisites are absent; they must be supplied before declaring a live deployment operational.

| Prerequisite | Why it is required | Current behavior if absent |
|---|---|---|
| TigerBeetle replica, cluster ID, and replica addresses | The official ledger client requires a formatted cluster and reachable replica. [1] | Ledger proxy fails startup or returns explicit service failure; it never falls back to memory. |
| Keycloak realm/JWKS and configured issuer/audience | Required for cryptographic bearer validation. [2] | Token validation rejects the request. |
| Permify schema and relationship tuples | Required for authoritative authorization decisions. [3] | Protected writes are denied. |
| Temporal server and registered worker package | Required for workflow execution. [4] | Workflow starts reject; no HTTP/local fallback is used. |
| PostgreSQL historical data | Required to train non-fabricated CPU ML models. | ML health remains unhealthy and inference responds with `503` until enough labelled records exist. |
| Approved GGUF model and `llama-cpp-python` | Required for local CPU LLM inference. | Local LLM health is unhealthy and generation endpoints return `503`. |
| Real Fluvio cluster and configured downstream services | Required for official-client streaming consumption and durable downstream delivery. | Workers fail explicitly and do not commit offsets. |
| Docker-capable host | Required for actual end-to-end container launch. | Only structural Compose validation is possible in this sandbox; Docker bridge support was unavailable. |

The full Vite production bundle passes module transformation (**7,863 modules transformed**) but the sandbox terminates the renderer during chunk generation with `SIGTERM`. TypeScript compilation and all unit tests pass; the build outcome should be rechecked on a normal CI runner with a longer uninterrupted process window. This is documented as a validation-environment limitation, not a successful production build.

## Operational Commands

```bash
# Install and verify JavaScript dependencies
pnpm install --frozen-lockfile
pnpm check
pnpm test

# Apply the one canonical migration path
DATABASE_URL='postgresql://...' bash scripts/migrate.sh

# Verify schema/readiness after migration
DATABASE_URL='postgresql://...' pnpm exec tsx /path/to/ndsep-verify-migrations.ts

# Validate structural service configuration
POSTGRES_PASSWORD=... REDIS_PASSWORD=... docker compose -f orchestration/docker-compose.yml config
```

Deploy the Go TigerBeetle ledger proxy with `TIGERBEETLE_CLUSTER_ID` and `TIGERBEETLE_ADDRESSES`. Do not deploy the Rust `tigerbeetle_ledger` binary; it now exits explicitly to prevent accidental in-memory financial processing.

## References

[1] [TigerBeetle Go Client Guide](https://docs.tigerbeetle.com/coding/clients/go/)
[2] [Keycloak Securing Applications Guide](https://www.keycloak.org/docs/25.0.6/securing_apps/index.html)
[3] [Permify Enforcement Guide](https://docs.permify.co/getting-started/enforcement)
[4] [Temporal TypeScript Worker Guide](https://docs.temporal.io/develop/typescript/workers/run-worker-process)
