# NDSEP Assurance Remediation Ledger

**Assessment revision:** `855e079b1bf8374bfdf3b673c608bfff60ddb717` plus uncommitted assurance fixes.
**Assessment timestamp:** 2026-08-29 EDT.
**Operating mode:** `FIX_ALL_IN_SCOPE_FINDINGS`. A finding is never considered closed solely because it is documented or suppressed.

| ID | Severity | Claim / affected flow | State | Root cause and disposition | Evidence / re-test |
|---|---|---|---|---|---|
| DEP-001 | Critical | Node dependency supply chain | `RETESTING` | The committed lockfile produced 2 Critical and 40 High findings. Dependency resolution was updated using pnpm 10.34.4 and targeted patched overrides; the current audit has 0 Critical and 0 High findings. The full build/test suite must still pass against this new graph before `VERIFIED_FIXED`. | `.assurance-targeted-convergence-audit.json`; `package.json`; `pnpm-lock.yaml` |
| DEP-002 | High | Package-manager integrity | `RETESTING` | The declared package manager was vulnerable at pnpm 10.4.1. It is now pinned to pnpm 10.34.4; CI must use the same patched release. | `package.json`; `.github/workflows/security-gate.yml` |
| SEC-001 | High | `POST /api/workers/event` event integrity | `TRIAGED` | The API relay accepts arbitrary event/data from any network-reachable caller. A complete repair needs a coordinated workload-identity header, schema contract, replay strategy, producer rollout, secret injection, and negative integration test across Go, Python, Rust, and orchestration producers. The platform must not expose or approve this flow until that contract is deployed. | `server/_core/index.ts`; `.assurance-worker-relay-callers.txt` |
| SEC-002 | High | Destructive demo reset | `REGRESSION_PROVEN` | `/api/demo-reset` lacked independent app-level guards, so a direct internal path could bypass gateway-only protection. It now requires `demoLoginGuard` and `requireAdmin`. | `server/_core/index.ts`; `server/demoRouteWiring.test.ts` |
| OPS-001 | High | Production readiness: identity | `REGRESSION_PROVEN` | The readiness score granted an authentication pass via `keycloak.enabled || true`, allowing demo fallback to count as production auth. The score now requires enabled Keycloak with a fresh loaded JWKS cache. | `server/routers/productionReadiness.ts`; `server/routers/productionReadiness.logic.test.ts` |
| OPS-002 | Medium | Production readiness: ML model freshness | `REGRESSION_PROVEN` | ML status used training duration as an epoch and rendered the current time as `lastTrained`. It now records `completedAt` and derives stale/next-training status from that immutable timestamp. Durable model-history persistence remains an external implementation gap. | `server/mlPipeline.ts`; `server/mlPipeline.test.ts` |
| CI-001 | High | CI quality gates | `IMPLEMENTING` | The main CI workflow omitted `production`, allowed Python, Trivy, pnpm audit, and E2E failures to pass, and lacked an independent mobile job. The workflow was revised to run and fail those checks and to validate mobile separately. It must be run in GitHub Actions before closure. | `.github/workflows/ci.yml` |
| CI-002 | High | Future dependency regression | `IMPLEMENTING` | There was no baseline high/critical pnpm gate with expiring, independently reviewed exceptions. A fail-closed security-gate workflow and registry policy were added. They require branch protection/ruleset activation after review. | `.github/workflows/security-gate.yml`; `scripts/ci/assert-pnpm-audit.mjs`; `PNPM_AUDIT_EXCEPTION_POLICY.md` |
| QA-001 | High | Root static verification | `DISCOVERED` | The root lint command reports 164 errors and 3,020 warnings after mobile scope is correctly isolated. No lint suppression or broad ignore was used to hide these results. The repository is blocked until the errors are corrected and the project establishes an approved warning policy. | `.assurance-root-lint-after-scope.log`; `.assurance-lint-workflow-classification.txt` |
| QA-002 | High | Real-dependency integration and E2E | `EXTERNAL_BLOCKED` | Docker/Kubernetes tooling, a preproduction deployment, and approved service/provider sandboxes were unavailable. The assessment did not use production data, credentials, or live funds. Required real-dependency, gateway, worker, migration, restore, rollback, financial reconciliation, and public-interface E2E evidence is therefore absent. | `.assurance-toolchain.txt`; `ASSURANCE_CLAIM_MANIFEST.yaml` |
| OPS-003 | High | Authoritative deployment/readiness evidence | `EXTERNAL_BLOCKED` | Service autostart is not wired into application startup; K8s readiness is a manifest filesystem heuristic; worker/build status is not a successful deployability proof. These surfaces must be replaced or clearly marked as static checks and validated against an actual orchestration API. | `server/serviceAutoStart.ts`; `server/k8sReadiness.ts`; `server/workerBuilder.ts` |

## State totals

| State | Count |
|---|---:|
| `DISCOVERED` | 1 |
| `TRIAGED` | 1 |
| `IMPLEMENTING` | 2 |
| `REGRESSION_PROVEN` | 3 |
| `RETESTING` | 2 |
| `VERIFIED_FIXED` | 0 |
| `EXTERNAL_BLOCKED` | 2 |

> **Release status remains BLOCKED.** `EXTERNAL_BLOCKED` does not waive a mandatory gate, and the current dependency, code, and workflow changes are not closed until the affected verification suite and GitHub execution evidence succeed.
