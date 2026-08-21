# PR #2: External-Service Critical Path to Unconditional Production Readiness

**Branch:** `audit/full-platform-integration-20260812`
**Target:** `production`
**Decision standard:** NDSEP becomes unconditionally production-ready only when every blocking service is **provisioned, configured, exercised through a real NDSEP business path, subjected to a dependency-loss test, and supported by retained evidence**.

> **Current position:** The repository has code and deterministic-contract coverage for the service boundaries below. This is not equivalent to a live deployment validation. The remaining work is primarily environment provisioning, data remediation, real round trips, and operational sign-off.

## 1. Exact external-service integration gaps

| Service or boundary | What is already coded | Exact production gap | Required remediation | Exit evidence |
|---|---|---|---|---|
| **PostgreSQL 16** | Canonical 35-migration chain, 168-table clean-schema result, lifecycle foreign keys and final-state checks | No staging rehearsal; historical records may violate the two `NOT VALID` lifecycle checks | Provision staging clone; take backup; run identifier report; approve and apply remediation only where needed; validate constraints; rehearse migration and rollback | Migration log, schema catalog, zero-count post-remediation report, `convalidated = true` catalog output, backup/restore test |
| **Keycloak** | Issuer/audience/expiry validation and administrative-session contract tests | No real realm, client, signing key, role mapping, or session-revocation round trip | Create production realm and confidential clients; configure valid redirect URIs, token audience, JWKS rotation, service accounts, and role mappings; execute valid/invalid/expired/revoked token tests | Realm export with secrets redacted, test transcript proving accept/deny/revoke behavior, audit log |
| **Permify** | Fail-closed authorization client and contract tests | No deployed schema, tenant, tuples, or real allow/deny decision evidence | Load the NDSEP authorization schema; seed least-privilege tuples for real staging principals; verify allow, cross-tenant deny, missing tuple deny, and service outage deny | Schema version, tuple seed manifest, decision-test results, outage test log |
| **Redis** | Session revocation, cache, and rate-limit code paths | No production topology/TLS/persistence/failover validation | Deploy managed or HA Redis with ACLs/TLS, persistence and eviction policy; configure session/cache namespaces; simulate primary loss and recovery | Configuration review, revocation test, rate-limit test, failover/recovery metrics |
| **Kafka** | Durable publication paths, DPCO fail-closed publication behavior, DLQ code | No broker cluster, topic ACLs, retention/partition plan, producer/consumer or DLQ round trip | Create topics for all journey events; apply TLS/SASL and per-service ACLs; define partitions, retention, compaction, and DLQ replay policy; execute produce/consume/outage/replay tests | Topic/ACL inventory, consumer lag dashboard, delivery and outage test logs, DLQ replay artifact |
| **Dapr** | Real sidecar invocation/state/pub-sub contracts; no in-memory production substitution | No component manifests bound to real state store/pubsub/secrets and no sidecar mesh run | Deploy Dapr control plane and per-service sidecars; bind components to approved Redis/PostgreSQL/Kafka/secrets backends; test invocation, state write/read, publish/subscribe, and sidecar outage | Component manifests, sidecar health evidence, request trace, failure propagation test |
| **Temporal** | Workflow clients and strict schedule-registration failure behavior | No namespace, task queues, workers, retry/dead-letter policy, or recovery proof | Create namespace and task queues; deploy pinned worker versions; configure retention, TLS, retries, timeouts, and alerting; run penalty/transfer/incident workflows through timer, retry, and restart | Workflow histories, worker restart/resume record, timer/SLA test, alert evidence |
| **TigerBeetle** | Official client integration and fail-closed ledger behavior | No real cluster, account bootstrap, ledger code map, settlement or reconciliation evidence | Deploy a replicated TigerBeetle cluster; bootstrap immutable account/ledger/code registry; execute balanced penalty, payment, distribution, dispute, rejection, and reconciliation scenarios | Cluster health, account manifest, transfer IDs, balance/reconciliation report, outage/rejection log |
| **Lakehouse / MinIO / Delta or Iceberg** | Real object-store/lakehouse request contracts and explicit query failure behavior | No bucket, catalog, storage credentials, table registration, immutable-write or query evidence | Provision object storage with versioning, encryption, retention and least-privilege keys; configure catalog/table format, checkpointing and lineage; ingest then query audit, penalty, transfer, and model data | Bucket/policy review, table catalog, write/query/time-travel evidence, restore test |
| **ML artifact and CPU inference** | Fail-closed artifact requirement; no rule-based fabricated prediction fallback | No persisted approved model, governed training corpus, evaluation, lineage, or CPU serving proof | Establish model registry and approval workflow; persist signed model artifact with dataset/version/metrics; run CPU inference/load/failure tests; define monitoring and retraining controls | Approval record, artifact digest, model card, evaluation report, CPU smoke/load logs, absent-artifact denial test |
| **OpenSearch** | Fail-closed indexer tests and index lifecycle code | No real cluster credentials, index policy/template, document ingestion/search or recovery evidence | Deploy TLS-authenticated cluster; create lifecycle policies/templates/aliases; index and query representative NDSEP records; test unavailable indexer behavior and restore | Cluster health, policy/template export, search/index trace, outage/recovery test |
| **FalkorDB** | Real adapter for health, neighbor, bounded path, node, stats, and gated PostgreSQL rebuild | The real-server CI round trip is not run; no eligible bridge-capable runner | Register runner labelled `self-hosted`, `linux`, `docker-bridge`; retain Docker bridge preflight; run live workflow without bypassing network preflight; verify rebuild persistence and recovery | Workflow URL, uploaded round-trip artifact, health/path/injection/persistence/outage/recovery results |
| **Fluvio** | Official streaming integration and explicit failure behavior | No cluster, topic policy, producer/consumer telemetry run, or retention evidence | Provision cluster; create telemetry topics with retention/partitions; configure credentials; ingest edge events and verify consumer, replay, outage, and retention behavior | Topic inventory, telemetry traces, consumer/replay/outage logs |
| **APISIX** | Gateway configuration and required-admin-key handling | No deployed gateway routes, upstream health, JWT/rate-limit, or failure behavior evidence | Deploy gateway with managed admin credentials; load reviewed routes/plugins; configure Keycloak JWT validation, rate limits, upstream health and TLS; test authorized, unauthorized, throttled, and unhealthy-upstream paths | Route export, gateway access logs, four-path test transcript, configuration review |
| **OpenAppSec** | Policy synchronization code and deployment configuration | No enrolled agents, policy attachment, blocking-mode verification, or false-positive review | Enroll agents, attach reviewed policy, begin observed learning period, approve block-mode transition, and test known-safe/known-malicious requests | Agent status, policy version, test evidence, false-positive sign-off |
| **Observability and secrets** | OpenTelemetry/Pino/Prometheus wiring and startup validation | No production secret injection, centralized traces/logs/metrics, alerts, or runbook rehearsal | Inject secrets through approved secret manager; disable all defaults; configure telemetry collectors, dashboards, SLO alerts, audit retention, and incident runbooks | Redacted configuration review, startup logs, trace across a business journey, alert and rollback exercise |
| **Network enforcement hardware / external feeds** | DPI, BGP, PCAP, and telemetry worker code | No representative IXP, RPKI, BGP, PCAP, or external-intelligence environment | Use a controlled staging lab or approved integration partner; exercise monitoring-only events before any blocking capability; validate safety approvals and chain of custody | Lab report, safety approval, incident timeline, evidence retention record |

## 2. Critical path order

The order below prevents a later test from producing misleading evidence. For example, a workflow test is not meaningful until identity, authorization, durable state, and message delivery are all real.

| Sequence | Gate | Dependencies | Completion condition |
|---|---|---|---|
| **0** | Release governance and immutable environment | PR review, secrets ownership, named service owners | Approved change window, service-owner matrix, staging data classification, rollback owner |
| **1** | Database safety | PostgreSQL staging clone and backup | Clean migration rehearsal; DPCO identifier report/remediation; both final-state checks validated |
| **2** | Identity and authorization | Keycloak, Permify, Redis, APISIX | Authentication, resource authorization, session revocation, and outage denial all proven through gateway paths |
| **3** | Durable transaction and orchestration core | TigerBeetle, Kafka, Dapr, Temporal, Redis | Penalty and dispute flows prove balanced ledger write, durable event, workflow checkpoint/retry, and no acknowledgement on dependency loss |
| **4** | Analytics and governed AI | Lakehouse/object store, OpenSearch, approved ML artifact | Immutable ingest/query, search, artifact approval, CPU inference, and error propagation proven |
| **5** | Graph and streaming | FalkorDB, Fluvio, Docker-bridge runner | Live graph CI artifacts and telemetry consume/replay/outage evidence complete |
| **6** | Edge protection and enforcement | APISIX, OpenAppSec, observability, controlled network lab | Gateway/WAF behavior, traces/alerts, and monitoring-only network workflow proven |
| **7** | Full business acceptance and release controls | All prior gates | J01–J30 live acceptance pack, load/security findings dispositioned, rollback rehearsal, release approvals |

## 3. Required live acceptance pack

The final acceptance pack must execute each documented journey in a deployment-capable environment. It should not merely call health endpoints. Each journey needs a trace ID joining the UI/API request, Keycloak identity, Permify decision, database transaction, Kafka/Dapr events, Temporal history where applicable, ledger transfer where applicable, lakehouse record, and observability trace.

At a minimum, the pack must include these high-risk proof scenarios:

| Scenario | Services that must be real | Non-negotiable assertion |
|---|---|---|
| Penalty issuance, payment, dispute, and reconciliation | Keycloak, Permify, PostgreSQL, TigerBeetle, Kafka, Temporal, Lakehouse | No penalty is marked issued, paid, or settled unless the authoritative ledger operation succeeds and the durable event/workflow record exists. |
| Cross-border transfer approval and timeout escalation | Keycloak, Permify, PostgreSQL, Temporal, Kafka, Dapr, Lakehouse | Rejection, approval, deadline escalation, and dependency outage each preserve a consistent durable state. |
| DPCO registry/audit/verification lifecycle | PostgreSQL, Dapr, Kafka, TigerBeetle, Permify | Final lifecycle states enforce required identifiers and do not acknowledge a non-durable side effect. |
| Compliance scoring and SLA prediction | PostgreSQL, Lakehouse, approved ML model, Redis, Kafka, Dapr | Every score/prediction includes an approved model version and input lineage; missing artifact causes an explicit error. |
| Identity, session revocation, and gateway denial | Keycloak, Redis, Permify, APISIX | Invalid, expired, cross-tenant, revoked, and upstream-unavailable paths all deny. |
| Graph, search, and telemetry | FalkorDB, OpenSearch, Fluvio, Lakehouse | Data persists, remains queryable, rejects injection, and fails explicitly when a dependency is removed. |
| Network enforcement | Dapr, Kafka, Fluvio, controlled DPI/BGP/PCAP lab | Begin in monitor-only mode; blocking is never enabled without separately approved safety controls. |

## 4. Exact PR #2 execution steps

### A. Reconcile and protect the release candidate

1. Update the audit branch against current `production` and attach the final diff.
2. Obtain security, database, and relevant service-owner approvals for the full PR scope.
3. Require a clean type check, test suite, lint disposition, Go/Rust/Python validation, and production build in CI with adequate memory.

### B. Make PostgreSQL safe before connecting services

```bash
# Read-only assessment
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report

# Only after backup and formal approval when invalid records exist
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --apply

# Confirm no invalid final-state records remain
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report

# Enforce the historical checks only after the preceding evidence is reviewed
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --validate-constraints
```

### C. Run the qualified FalkorDB workflow

The runner must have labels `self-hosted`, `linux`, and `docker-bridge`; Docker Engine, Compose v2, Buildx, raw-table iptables support, IP forwarding, and disposable bridge networking. Do not weaken or bypass the preflight.

```bash
gh workflow run falkordb-live-integration.yml --ref production
```

Attach the workflow URL and artifact to PR #2. A queued, skipped, or preflight-bypassed workflow is not a pass.

### D. Collect release evidence before merge

Attach the following to PR #2: environment inventory; redacted secrets/config review; database migration/rollback artifacts; service health and real dependency-outage results; J01–J30 live acceptance report; security/load results; observability traces; and named approval/rollback evidence.

## 5. Definition of unconditional production readiness

NDSEP may be called **unconditionally production-ready** only when all statements below are true:

1. Every P0 service in the gap table has a real deployment, a named owner, hardened credentials, health/SLO monitoring, and success-plus-failure test evidence.
2. Staging data has passed the lifecycle remediation report and the two historic DPCO final-state constraints are validated.
3. A bridge-capable runner has passed the FalkorDB live workflow, and all external dependency tests are green without mocks or fallback acknowledgements.
4. The ML system serves only approved persisted artifacts with reproducible lineage and CPU inference evidence.
5. Every J01–J30 journey has a live end-to-end trace and a documented failure-mode result.
6. Security, database, service owners, and release management have approved the evidence, and rollback has been rehearsed.

## References

[1] [PR #2 Production Merge Checklist](./PR2_PRODUCTION_MERGE_CHECKLIST.md)
[2] [Requirements Traceability](../requirements/REQUIREMENTS_TRACEABILITY.md)
[3] [Stakeholder Journeys](../stakeholder-journeys.md)
