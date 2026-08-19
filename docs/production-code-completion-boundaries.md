# Production Code Completion Boundaries

## Purpose

This document separates controls that can be implemented and tested in source code from conditions that **cannot truthfully be completed by code or a local emulator**. It is the governing boundary for the production-completion program.

> A local simulator may validate protocol handling, retry behavior, authorization boundaries, and fail-closed states. It must never be labelled as an authoritative government registry, a certified biometric service, a payment settlement provider, a KMS/HSM, or production monitoring evidence.

## Code-resolvable work

| Area | Code deliverable | Acceptance evidence |
|---|---|---|
| Payment testability | Isolated PostgreSQL service profile, deterministic test bootstrap, and documented test environment variables | `pnpm test` runs against the declared local test service. |
| Provider boundaries | Typed configuration, health/readiness routes, fail-closed clients, and labelled emulators | Unconfigured and emulator modes are distinguishable by API/UI state and tests. |
| Deployment artifacts | Production Dockerfile, compose simulation profile, environment template, migration command, and health endpoints | Reproducible build and documented deployment handoff. |
| Observability code | Structured logging fields, health/readiness probes, metrics contract, and alert rule artifacts | Automated route tests and configuration linting. |
| Security controls | Role enforcement, idempotency, receipt/audit records, session handling, test coverage, and secure defaults | Unit/integration tests, code review, and zero placeholder credentials in production templates. |
| Workflow completeness | Remaining code-only UI, queues, filters, audit exports, and error/retry controls | Deterministic test coverage and rendered workflow verification. |

## External evidence gates

| Gate | Why an emulator is insufficient | Required target-environment evidence |
|---|---|---|
| NIMC, CAC, land registry and document authority | Only the approved authority can return authoritative verification results | Contract, approved endpoint, credentials, test cases, redacted transaction evidence, and owner. |
| Keycloak/enterprise identity and delegated approvals | Claims, authenticators, and administrative policies exist outside this repository | Realm/client export applied, JWKS validation, lifecycle drill, policy owner, and audit evidence. |
| Paystack/Flutterwave and settlement | A local webhook cannot prove provider signature, settlement, chargeback, or financial controls | Approved gateway credentials, callback registration, verified staging transactions, reconciliation sign-off. |
| KMS/HSM, workload identity and device security | A local key cannot prove custody, rotation, access control, MDM, or hardware/device attestation | Key policy, identity federation, rotation/recovery drill, signed native builds, MDM/device evidence. |
| Production resilience and governance | A compose service cannot prove real backups, regional recovery, monitoring ownership, legal authority, or incident operations | HA design, PITR drill, alert test, penetration test, DPIA, retention approval, on-call roster. |

## Completion rule

Code-resolvable items may be marked complete only after source, migration, deterministic tests, and a clearly disclosed emulator or fail-closed boundary exist. External evidence gates remain pending until the responsible production environment supplies evidence. No status report may collapse the two categories into a single “production-ready” claim.
