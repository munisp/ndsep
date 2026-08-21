# NDSEP Requirements Traceability Baseline

**Status:** Active implementation baseline
**Scope:** Repository business journeys, README capabilities, gap analysis, audit findings, and production-readiness requirements
**Important:** A simulated dependency is a test double. It is not evidence that the corresponding external service is production-available.

## Status vocabulary

| Status | Meaning |
|---|---|
| `CODED` | A concrete implementation is present in this repository. |
| `SIMULATED` | A deterministic local contract fixture exists for an unavailable dependency. |
| `LIVE-VERIFIED` | The code has passed a round trip against a real service in a deployment-capable environment. |
| `INCOMPLETE` | Requirement capability is absent, partially implemented, or deliberately disabled. |
| `ENVIRONMENT-BLOCKED` | Code exists, but the real dependency/runner/staging credential is not available in this environment. |

## Technical requirements

| ID | Requirement | Code status | Verification target | Current boundary |
|---|---|---|---|---|
| T01 | PostgreSQL schema, constraints, migrations, foreign-key indexes | CODED | Fresh journal-ordered migration run: 35 files, 168 public tables | Live staging rehearsal still required. |
| T02 | Keycloak identity and invalid-token rejection | CODED; SIMULATED contract | Unit/contract outage and request-shape tests | Real Keycloak realm round trip required. |
| T03 | Permify policy authorization and outage denial | CODED; SIMULATED contract | Contract tests | Real tenant/schema/tuple enforcement required. |
| T04 | TigerBeetle ledger posting and settlement | CODED; SIMULATED refusal contract | Network-failure tests | Real ledger transfer/reconciliation required. |
| T05 | Redis sessions, revocation, rate limiting | CODED; SIMULATED contract | Unit/contract tests | Real clustered Redis outage/recovery required. |
| T06 | Kafka, Dapr, and Temporal durable delivery/workflows | CODED; SIMULATED contract | Explicit failure contracts and journey matrix | Real broker/sidecar/workflow execution required. |
| T07 | Lakehouse and ML risk scoring | CODED fail-closed; SIMULATED contract | Artifact/unavailable and request-shape tests | Approved model artifact, training data, and live lakehouse required. |
| T08 | OpenSearch and FalkorDB search/graph | CODED partial | Adapter tests; real PostgreSQL-to-FalkorDB rebuild implementation; Compose structural validation | Real OpenSearch/FalkorDB round trips and GNN embedding endpoint remain required. |
| T09 | APISIX, OpenAppSec, observability, secrets | CODED partial | Compose/config checks | Live gateway/WAF/telemetry validation required. |
| T10 | CI/CD deployment and Docker bridge preflight | CODED | actionlint and mock runner dry run | Self-hosted bridge-capable runner required. |

## Stakeholder journey coverage

| Journey | Primary coded boundaries | Simulation acceptance target | Current status |
|---|---|---|---|
| J01–J30 | Journey-specific portal, worker, workflow, and middleware code paths | One deterministic fixture per journey; exact documented dependency matrix; simulated outage refusal | SIMULATED acceptance complete; live evidence remains environment-blocked by the required external services and hardware. |

> The all-journey simulation proves contract coverage only. It does not substitute for a live environment in which Keycloak, Permify, TigerBeetle, Kafka, Dapr, Fluvio, OpenSearch, Temporal, Redis, Lakehouse, APISIX, OpenAppSec, and network enforcement systems are provisioned. |

## Explicit scope gaps to implement or test

1. FalkorDB rebuild, node inspection, and statistics are implemented against the real adapter; the GNN embedding endpoint still needs a real-backed implementation and deployment-environment round trip.
2. DPCO, banking, and React Native AI advisory summaries are now backend-wired. Full mobile route-for-route parity, especially sector-specific and transactional detail flows, remains incomplete.
3. The former 18-router mutation-emission finding is closed by current source scan; router behavior still needs live middleware delivery evidence.
4. Real ML requires a persisted approved model artifact and governed training/validation data; simulation must not fabricate predictions.
5. Deterministic acceptance fixtures exist for all 30 journeys; separate live-environment acceptance evidence remains required.
6. Full repository lint remediation remains required before declaring a clean release baseline.
