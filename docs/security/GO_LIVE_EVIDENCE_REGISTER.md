# NDSEP 26-to-95 Go-Live Evidence Register

**Date:** 2026-08-30 (EDT)
**Scope:** The 11 requested core services, cross-cutting evidence architecture, and new source-controlled hardening on PR #18.
**Decision status:** **No current Go-Live approval.** This is a measurable evidence register. It is not a claim that a score of 95 has been attained or that a regulator has accepted the platform.

> A 95/100 readiness score requires independently demonstrated, production-like operation of every critical control; a clean directly scanned release image; a verified residency-evidence chain; a tested disaster-recovery exercise; and signed business/regulatory approvals. A source-code change alone cannot meet this threshold.

## Scoring and gate rule

A component can reach **95/100** only when it meets all of the following: secure multi-node/HA topology; private network and workload identity; encrypted transport and storage; least-privilege access; independently tested backup/restore or reconciliation; source-to-destination audit/evidence lineage; service-specific failure-mode test; and signed owner/compliance acceptance. Any unwaived HIGH/CRITICAL vulnerability in the deployed image, a default credential, a mutable artifact reference, a fail-open authorization path, or an untested disaster-recovery plan caps the related domain below 80.

| Milestone | Gate | Evidence owner | Evidence required |
|---|---|---|---|
| M0 — Freeze unsafe release | Current digest blocked | Release security | Immutable direct Trivy evidence for `sha256:e1d…` and deployment deny record |
| M1 — Secure candidate | Final image contains no unwaived HIGH/CRITICAL finding | Platform security | Candidate digest, offline/direct Trivy JSON, SPDX SBOM, Cosign/DSSE attestations |
| M2 — Staging integration | Critical dependency transactions succeed and unsafe paths fail closed | Service owner + SRE | Repeatable test report, signed logs, dashboard integrity status |
| M3 — Resilience | Failover/restore/rotation drills complete | SRE + security | RTO/RPO measurement, recovery logs, reconciliation hash/ledger proof |
| M4 — Operating approval | Human/regulatory governance accepts the proven scope | Security + compliance | Approved change, risk decision, pilot/production authority (where applicable) |

## 11 core service close-out plan

| Core service | Current evidence-based state | Required implementation/remediation | Minimum Go-Live proof | Score ceiling until proven |
|---|---|---|---|---:|
| **1. PostgreSQL** | Primary store with RLS patterns; supervisory ledger amendment is not applied to staging. | Apply append-only hash-recomputation migration; TLS/mTLS; separate migration, ingest, projection and reporter roles; encrypted PITR/replica; connection pooling and statement controls; remove shared/default compose access. | Restore an encrypted backup to isolated staging; run advisory-lock/chain test; prove forced RLS and direct-DML denial; reconcile backup head against signed ledger head. | 70 |
| **2. TigerBeetle** | Real Go client path; one-node development topology. | 3+ replica topology; mTLS/workload identity; deterministic transfer-id/idempotency and reject-code handling; account/currency governance; operational reconciliation to PostgreSQL evidence ledger. | Failure/restart/duplicate-transfer tests; balance and journal reconciliation proof; approved non-production payment connector contract. | 65 |
| **3. Redis** | Used for rate limits/replay but originally standalone/plaintext/defaultable. PR #18 makes production replay enforcement depend on `rediss://`. | TLS/private CA; ACL per workload; Sentinel/cluster; encrypted backups/AOF test; resource limit/eviction policy; no public listener; rotate credentials. | Node failover during nonce/replay test; ACL denial test; restore and eviction test; readiness fails closed when unavailable. | 70 |
| **4. Mojaloop** | Transfer-shaped facade only; no verified participant deployment. | Do not call production endpoints. Establish authorized non-production participant/onboarding; mTLS/OAuth/JWS; asynchronous transfer state machine; signed callbacks; idempotency and settlement/reconciliation evidence. | Sandbox certification tests with signed callback and duplicate/out-of-order cases; settlement reconciliation; written partner approval. | 50 |
| **5. Kafka** | Single/plaintext development broker and HTTP proxy semantics. | KRaft multi-broker/zone topology; TLS/SASL/ACL; pre-created schema-governed topics; transactional outbox; idempotent producer; encryption/retention; DLQ and replay protection. | Broker loss/rebalance/lag/SLO test; ACL deny test; schema incompatibility rejection; outbox exactly-once/invariant reconciliation. | 70 |
| **6. APISIX** | Route synchronizer source exists; PR #18 removes embedded admin-key fallback and rejects non-HTTPS production Admin API. | HA gateway; private Admin API mTLS; short-lived workload credentials; GitOps-signed route configuration; OPA/ext-authz policy; rate limits/WAF/TLS; no public admin plane. | Route provenance verification; policy-denial and gateway-failover tests; admin credential rotation; configuration-drift evidence. | 70 |
| **7. Keycloak** | Wrapper/realm exists but `start-dev`, static credentials and plaintext topology remain. | HA production mode; external PostgreSQL; HTTPS; admin bootstrap rotation; realm/client key rotation; group/claim mapping coverage; mTLS for confidential clients; tested session/revocation policy. | Key rotation/revocation test; HA loss test; tenant/role authorization matrix; no default admin credential scan. | 70 |
| **8. open-appsec** | Adapter/worker reference, not a verified enforcement deployment. | Deploy supported WAF/integration in monitor mode first; signed policy lifecycle; traffic scope and privacy review; protected management identity; logging to immutable audit stream; controlled block-mode change. | Positive/negative attack corpus; false-positive review; policy rollback drill; alert-to-case evidence linkage. | 55 |
| **9. Permify** | Direct client rejects on error; development compose path lacks secure/controlled schema lifecycle. | Pinned image; TLS/mTLS; service credential; versioned schema migration/approval; relation lifecycle/reconciliation; availability SLO; no `latest`. | Authorize/deny/timeout matrix; tenant isolation test; schema rollback; relationship reconciliation evidence. | 70 |
| **10. OpenSearch** | Indexer/query adapter performs HTTP calls but no secure cluster proof. | HA secure cluster; TLS/mTLS/API keys; index templates/ILM; tenant isolation; audit logging; snapshots/restore; index records linked to PostgreSQL evidence/event hash. | Search access deny test; snapshot restore; index-to-ledger hash correlation; node-loss/replica test. | 65 |
| **11. Fluvio** | Relay/interface only; no verified cluster, auth or retention controls. | Decide whether Fluvio is necessary alongside Kafka; if retained, deploy a supported secure cluster with mTLS/ACL/schema/retention/replay, edge connectivity and monitoring. Otherwise remove it and its claims. | Cluster/auth/replay/retention tests and production ownership decision; or verified dependency removal. | 50 |

## Cross-cutting blockers that cannot be delegated to a service

| Blocker | Required close-out condition |
|---|---|
| **Container security** | The candidate image is built once from pinned inputs, has an SBOM/provenance/signature, and direct Trivy scan of its **published digest** reports zero unwaived HIGH/CRITICAL runtime results. The current published digest remains blocked. |
| **Residency assertion** | Replace client-provided location with signed/cloud/database/backup/egress evidence, independent verifier policy, timestamp/nonce/replay validation, Merkle transparency proofs and an appeal workflow. Do not claim physical geography from an IP/region label alone. |
| **Worker events** | PR #18 now verifies HMAC, exact raw request bytes, freshness and Redis nonce reservation. Every sender must be migrated to the versioned protocol before production enablement; mTLS/workload identity should replace shared secrets for the next deployment phase. |
| **Evidence and reporting** | PostgreSQL integrity ledger, encrypted blobs, evidence verifier, registry/ledger proofs and recipient signed acknowledgement must be deployed/tested. Dashboards and SIEM copies are not evidence authorities. |
| **ML governance** | Synthetic candidate artifacts are real weights but not regulatory/policy models. A real-data route requires lawful data authority, privacy impact assessment, versioned/approved labels, time/cohort metrics, bias/drift tests, model registry, signing, deployment approval, rollback and human decision/appeal controls. |

## PR #18 hardening delta

PR #18 adds implementation evidence but does not close external dependencies:

1. Removes the unused `@temporalio/worker` production dependency, eliminating its webpack/esbuild closure from a production-only dependency tree.
2. Pins the Node Alpine base by immutable manifest digest, upgrades base packages during build, pins pnpm, and copies a production-only deployment tree into the runtime image. The candidate must still be built and directly scanned.
3. Adds strict production startup checks for `rediss://`, explicit CORS origin allow-list and high-entropy worker-event HMAC configuration.
4. Adds HMAC-SHA-256, exact-body binding, timestamp freshness and Redis `SET NX PX` replay prevention to the worker event relay. Four focused tests pass locally.
5. Removes APISIX embedded admin-key fallback and requires an HTTPS Admin API in production.
6. Corrects audit-return output so a PDF cannot be labelled signed after a signing failure.
7. Adds real synthetic-only CPU PyTorch MLP/GraphSAGE training, signed artifacts and candidate-only inference; it does not create a regulated production model.

## Go-Live decision evidence pack

A request to change from **NO-GO** to a score of 95 must include, at minimum, a signed evidence manifest with the following files and owners:

1. Candidate OCI digest, build provenance, SBOM, direct Trivy report, remediation trace and Cosign verification result — **release security**.
2. Service-by-service staging integration, fault, security and recovery evidence tied to immutable artifacts — **service owner/SRE**.
3. Residency evidence verification/appeal test records and policy version — **compliance/evidence verifier**.
4. Database backup/PITR, ledger chain, reporting submission and acknowledgement proof — **data owner/compliance**.
5. ML data/model approvals, reproducible training/evaluation, drift/bias results and decision controls — **model-risk owner**.
6. Explicit pilot/production authority from accountable business, security and legal/compliance owners; if CBN submission is involved, the actual authorized interface/recipient acknowledgement — **governance**.

Until all evidence is independently reviewed and accepted, the defensible operational conclusion remains **NO-GO**, not 95/100.

## References

1. `/home/ubuntu/ndsep-production-readiness-and-ml-stack-assessment.md` — prior score and source review.
2. `/home/ubuntu/ndsep-image-scan/published-image-trivy-high-critical.md` — direct published-image scan baseline.
3. `/home/ubuntu/ndsep-residency-architecture-and-image-security-review.md` — residency/evidence limitations.
4. `/home/ubuntu/ndsep-repo/workers/python/ml_foundation/MODEL_CARD_SYNTHETIC_CANDIDATE.md` — synthetic candidate model boundary.
