# NDSEP PR #18 Post-Hardening Readiness Reassessment

**Assessment date:** 2026-08-30 (EDT)
**Reviewed revision:** `27623f9edbe9b876db281773bff6b7e3e3a76f96` on PR #18
**Conclusion:** **31/100 — NO-GO.** This is a source-and-local-validation reassessment, not a production certification or a CBN finding.

## Verified hardening delta

PR #18 adds meaningful, locally validated safeguards. The Dockerfile now uses a pinned Node Alpine base digest, a fixed pnpm version, package upgrades and a production-only dependency installation/copy step. Removing the unused `@temporalio/worker` direct production dependency removes the known Temporal → webpack → esbuild closure from the current `pnpm --prod` graph. This has not yet been proven on a rebuilt, published candidate digest; only a direct final-image scan can establish that the 42 HIGH/CRITICAL baseline is remediated.

The worker relay now checks an HMAC-SHA-256 over the **exact received JSON bytes**, a bounded millisecond timestamp, worker identity and nonce. Production performs atomic Redis `SET NX PX` nonce reservation and rejects events if the nonce store is unavailable. Environment validation now rejects wildcard CORS, an absent/weak worker event secret and non-`rediss://` Redis in production. The APISIX synchronizer no longer has an embedded admin key, requires an explicit high-entropy key and refuses a non-HTTPS Admin API in production. Audit-return PDF responses now accurately disclose cryptographic signing failure rather than label an unsigned file as signed.

| Validation | Result |
|---|---|
| Worker-event HMAC/freshness/tamper/schema tests | **4/4 passed** locally |
| TypeScript compiler | **Passed** locally |
| Diff whitespace validation | **Passed** locally |
| Fresh synthetic-only MLP + GraphSAGE CPU training | **Passed** locally |
| Candidate artifact hash/signature and CPU inference verification | **Passed** locally |
| Ray local two-CPU candidate tasks | **Completed** locally |
| Go APISIX compilation | **Not run locally**; Go toolchain absent in sandbox |
| New CPU Docker image build | **Not run locally**; Docker unavailable in sandbox |
| Final candidate image direct Trivy scan | **Not run**; no rebuilt published candidate digest |
| External-service staging acceptance / DR tests | **Not run**; no authorized environments/clusters |

## Updated scoring calculation

The scoring model remains: PostgreSQL 12%; identity/authorization 10%; security/delivery 13%; residency/evidence 20%; financial/enforcement 10%; event/integration mesh 15%; AI/data/analytics 15%; CBN reporting 5%. The updated values reflect only direct implementation and local evidence, not presumed operation.

| Domain | Before | After | Rationale | Evidence ceiling |
|---|---:|---:|---|---:|
| PostgreSQL and data foundation | 45 | 45 | Schema packages remain un-applied/unproven in staging. | 70 |
| Identity and authorization | 40 | 40 | Keycloak/Permify external topology remains unverified. | 70 |
| Security and delivery | 24 | 35 | Pinned/minimized Docker source, mandatory production secrets and APISIX hardening; final image scan/staging delivery still absent. | 70 |
| Residency and evidence assurance | 10 | 10 | Self-attested/synthetic residency evidence remains unsuitable. | 40 |
| Financial/enforcement | 24 | 24 | TigerBeetle/Mojaloop/payment controls remain unproven. | 65 |
| Event/integration mesh | 28 | 32 | Relay now fails closed with signed/fresh/replay-safe ingress; every worker sender and Kafka/outbox topology are not yet migrated/proven. | 70 |
| AI/data/analytics | 28 | 45 | Real signed synthetic CPU candidate MLP/GNN and Ray tasks exist; no governed real data/labels or production MLOps. | 65 |
| CBN reporting | 15 | 15 | No official CBN transport/receipt/acknowledgement evidence. | 50 |
| **Weighted composite** | **26.07** | **30.65** | Rounded result is **31/100**. | **NO-GO** |

## Conditions for a defensible 95/100 Go-Live decision

No code-only activity can raise the platform to 95/100. The `GO_LIVE_EVIDENCE_REGISTER.md` committed in PR #18 specifies the required signed evidence. In short, the release owner must produce a clean published-digest scan/SBOM/provenance/signature set; each of the 11 services must pass secure topology, workload identity, failure/restore and reconciliation tests; the residency engine must use externally corroborated signed evidence rather than user inputs; CBN reporting must use an authorized interface with a verified recipient acknowledgement; and accountable engineering, security, data protection, legal/compliance and business owners must approve the measured production scope.

> The newly trained MLP and GraphSAGE weights are **synthetic candidates only**. They are not trained or fine-tuned on platform, financial, citizen, CBN or other regulated data, and they must not drive automated enforcement, payment activity, residency conclusions, regulatory filings or adverse decisions.

## References

1. [Direct published-image scan baseline](/home/ubuntu/ndsep-image-scan/published-image-trivy-high-critical.md)
2. [Original readiness assessment](/home/ubuntu/ndsep-production-readiness-and-ml-stack-assessment.md)
3. [PR #18 Go-Live evidence register](/home/ubuntu/ndsep-repo/docs/security/GO_LIVE_EVIDENCE_REGISTER.md)
4. [Synthetic candidate model card](/home/ubuntu/ndsep-repo/workers/python/ml_foundation/MODEL_CARD_SYNTHETIC_CANDIDATE.md)
