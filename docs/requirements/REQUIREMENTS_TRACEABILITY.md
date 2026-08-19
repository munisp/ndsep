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
| T01 | PostgreSQL schema, constraints, migrations, foreign-key indexes | CODED | Fresh migration and catalog tests | Live staging rehearsal required. |
| T02 | Keycloak identity and invalid-token rejection | CODED | Unit/contract outage tests | Real Keycloak realm round trip required. |
| T03 | Permify policy authorization and outage denial | CODED | Contract tests | Real tenant/schema/tuple enforcement required. |
| T04 | TigerBeetle ledger posting and settlement | CODED | Network-failure tests | Real ledger transfer/reconciliation required. |
| T05 | Redis sessions, revocation, rate limiting | CODED | Unit/contract tests | Real clustered Redis outage/recovery required. |
| T06 | Kafka, Dapr, and Temporal durable delivery/workflows | CODED | Explicit failure contracts | Real broker/sidecar/workflow execution required. |
| T07 | Lakehouse and ML risk scoring | CODED fail-closed | Artifact/unavailable tests | Approved model artifact, training data, and live lakehouse required. |
| T08 | OpenSearch and FalkorDB search/graph | CODED partial | Adapter unit tests | Real OpenSearch/FalkorDB round trips required; Falkor rebuild/embedding/node operations incomplete. |
| T09 | APISIX, OpenAppSec, observability, secrets | CODED partial | Compose/config checks | Live gateway/WAF/telemetry validation required. |
| T10 | CI/CD deployment and Docker bridge preflight | CODED | actionlint and mock runner dry run | Self-hosted bridge-capable runner required. |

## Stakeholder journey coverage

| Journey | Primary coded boundaries | Simulation acceptance target | Current status |
|---|---|---|---|
| J01 Registration | Portal/API, DPCO registry, durable PostgreSQL | Keycloak, Kafka, Dapr, lakehouse success/failure contracts | CODED; ENVIRONMENT-BLOCKED live dependencies |
| J02 Assessment | Compliance/ML API and Redis cache | Persisted-model required vs unavailable responses | CODED fail-closed; INCOMPLETE real model/data |
| J03 Violation detection | Compliance, Temporal, Kafka, Dapr | Workflow/event failure propagation | CODED; ENVIRONMENT-BLOCKED live workflow |
| J04–J05 Penalty issue/payment | Registry/financial paths, TigerBeetle errors | Ledger refusal/network/malformed-response contracts | CODED; ENVIRONMENT-BLOCKED real ledger |
| J06 Transfer approval | Transfer routes, workflow boundary | Keycloak/Temporal/Kafka outcome contracts | CODED; ENVIRONMENT-BLOCKED live dependencies |
| J07–J08 Blocking/BGP response | DPI/BGP workers and events | Command/event contract fixtures | INCOMPLETE end-to-end enforcement validation |
| J09–J10 Threat intelligence/incidents | SIEM, incident/workflow paths | Event/workflow failure contracts | CODED partial; ENVIRONMENT-BLOCKED live sources |
| J11–J14 Residency/ML/score updates | Residency/ML workers, events | Approved-artifact and persistence contracts | CODED fail-closed; INCOMPLETE real ML operation |
| J15–J16 Audit/reporting | Audit records, lakehouse/report routes | Durable audit/event contracts | CODED partial; ENVIRONMENT-BLOCKED lakehouse |
| J17 Certificate | Certificate issuance and DPCO verification | Identifier/issuance constraints | CODED; live signing/notification pending |
| J18 Revenue distribution | TigerBeetle revenue route | Multi-leg posting/refusal tests | CODED partial; live ledger pending |
| J19–J20 Workflows/disputes | Temporal and financial boundaries | Broker/ledger failure contracts | CODED partial; live workflow/ledger pending |
| J21–J24 IXP/metrics/PCAP | Go/Rust worker sources | Worker build and event contract tests | INCOMPLETE end-to-end telemetry/network hardware validation |
| J25 Reconciliation | Ledger integration | Balance/query/refusal tests | CODED partial; live ledger reconciliation pending |
| J26–J29 Escalation/streaming/remediation/SLA | Temporal, Kafka, Dapr, ML routes | Explicit dependency-loss behavior | CODED partial; live integration/model pending |
| J30 Regulatory submission | Gateway, Keycloak, reporting/event routes | Gateway/auth/report contract tests | CODED partial; live regulator API and lakehouse pending |

## Explicit scope gaps to implement or test

1. Real FalkorDB graph rebuild, embedding, node-inspection, and graph-statistics operations remain intentionally unsupported.
2. The documented mobile parity gap remains: DPCO, banking, AI, sector, and many compliance/enforcement screens are not implemented in both mobile clients.
3. The 18-router middleware-event emission gap needs current static and acceptance-test verification; imported middleware is not sufficient evidence.
4. Real ML requires a persisted approved model artifact and governed training/validation data; simulation must not fabricate predictions.
5. All 30 journeys need deterministic simulated acceptance tests and separate live-environment acceptance evidence.
6. Full repository lint remediation remains required before declaring a clean release baseline.
