# PR #2 Production Merge Checklist

**PR:** [#2 — audit: harden integrations, canonical schema, and FalkorDB CI](https://github.com/munisp/ndsep/pull/2)
**Target branch:** `production`
**Head branch:** `audit/full-platform-integration-20260812`

## Current review state

PR #2 is open, mergeable, and not a draft. At the latest review it contains **58 commits** and **151 changed files** across server, workers, orchestration, migrations, client, CI, and infrastructure. It is therefore a platform release candidate rather than a narrow workflow-only change. Its FalkorDB integration check remains environment-blocked until an eligible self-hosted `docker-bridge` runner is registered.

> Do not merge solely to unblock the workflow. The workflow must run on a bridge-capable runner and all data migration, application, and security gates below must have evidence attached to the PR.

## Required merge gates

| Gate | Required validation | Pass condition | Evidence to attach to PR |
|---|---|---|---|
| Branch reconciliation | Update audit branch against current `production`; resolve all conflicts. | A clean comparison with no unreviewed production divergence. | Rebase/merge commit and final diff. |
| Review approval | Security, database, and service-owner review. | Required reviewers approve the full 151-file scope. | GitHub approvals and resolved comments. |
| TypeScript | `pnpm check` and `pnpm test`. | Type check passes; current baseline is **76 test files / 968 tests passed**. | CI job output. |
| Lint policy | `pnpm lint`. | Either zero errors, or an explicitly approved baseline exception with owner/date/remediation issue. | Lint report and approval. |
| Go | `go test ./...` in `orchestration/go`, `services/go`, and `workers/go`. | All module suites pass. | CI job output. |
| Python | `python3 -m compileall -q services workers orchestration`. | No syntax failures. | CI job output. |
| Rust | `cargo test --workspace` in service and worker workspaces; strict WASM Clippy. | Both workspaces pass; WASM Clippy runs with warnings denied. | CI job output. |
| Compose | `docker compose config -q` for core, middleware, data operations, intelligence, orchestration, production, and FalkorDB fixture manifests. | All manifests parse with non-secret disposable values. | CI job output. |
| Fresh database | Apply the journal-ordered canonical migrations through `0034` to a new database. | All **35** migrations complete; 168 public tables, lifecycle typed FKs/indexes, and final-state checks exist. | Schema catalog query and migration log. |
| Staging identifier report | `DATABASE_URL="$STAGING_DATABASE_URL" scripts/remediate-dpco-lifecycle-identifiers.sh --report`. | Counts are zero, or a change-approved remediation plan exists. | Report-only output. |
| Staging remediation | If report counts are nonzero: take backup, run `--apply`, review quarantined IDs, rerun `--report`. | Counts become zero without generated identifiers. | Backup reference, apply log, post-report. |
| Constraint validation | `scripts/remediate-dpco-lifecycle-identifiers.sh --validate-constraints`. | Both migration-0034 constraints validate successfully. | PostgreSQL constraint catalog output. |
| Authorization/identity | Keycloak token, Permify denial, and Redis revocation outage tests. | Invalid/unavailable dependencies deny access. | Contract/integration test logs. |
| Durable ledger/workflow | TigerBeetle rejected/unreachable cases and Temporal unavailable cases. | No completed business result or fabricated transaction/workflow ID. | Targeted test logs. |
| Durable state/events | Dapr/Kafka/Permify outage behavior for DPCO services. | Mutations return explicit failure and no non-durable lifecycle state is acknowledged. | Service integration logs. |
| Real FalkorDB | Run `FalkorDB Live Integration` on a qualified self-hosted runner. | Health, neighbor/path, injection, persistence, outage, and recovery assertions all pass. | Workflow run URL and artifact. |
| Deployment readiness | Required production secrets and config are injected; no placeholder credentials remain. | Startup gates pass only with configured values; no default admin secrets. | Deployment config review and smoke log. |
| Rollback | Migration and deployment rollback plan signed off. | Backup/restore and service rollback instructions are executable. | Release runbook link. |

## Exact staging execution order

```bash
# 1. Read-only assessment.
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report

# 2. Only when nonzero counts are approved for remediation and a backup exists.
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --apply

# 3. Confirm there are no remaining invalid final-state records.
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report

# 4. Enable full historic constraint validation only after review.
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --validate-constraints
```

## Exact FalkorDB workflow prerequisites

The `.github/workflows/falkordb-live-integration.yml` job requires a runner carrying all three labels: `self-hosted`, `linux`, and `docker-bridge`. Its preflight requires Docker Engine, Compose v2, Buildx, `iptables -t raw -S PREROUTING`, IP forwarding, and a disposable Docker bridge-network container. Do not manually bypass this preflight: a failure means the runner cannot provide meaningful real-server graph evidence.

After the workflow is on `production` and the runner is online, dispatch it from GitHub Actions or with:

```bash
gh workflow run falkordb-live-integration.yml --ref production
```

Monitor the run and retain the uploaded round-trip log artifact. The current queued status is not a passing result.
