# P0 Execution Runbook: FalkorDB Validation and Staging DPCO Lifecycle Remediation

**Scope:** The two remaining P0 release gates: real FalkorDB evidence and safe staging validation of DPCO lifecycle identifiers.
**Decision rule:** Neither gate is complete merely because source code or a deterministic simulator passes. Completion requires real-environment artifacts retained with PR #2.

> **Estimated active effort:** **3–5 business days** when the self-hosted runner, staging database access, backups, and change approvals already exist. The two workstreams can run in parallel. Plan **5–10 business days of calendar time** where runner procurement, network approval, data-owner review, or change-control windows are outstanding.

## 1. Resource plan and timeline

| Workstream | Minimum roles | Active effort | Calendar dependencies | Completion artifact |
|---|---|---:|---|---|
| FalkorDB runner enablement and live round trip | 1 platform/SRE engineer, 1 Go/backend engineer, 1 security reviewer | 1.5–2.5 engineer-days | Self-hosted runner registration; Docker bridge permission; outbound image access; CI approvals | Successful `FalkorDB Live Integration` run and retained artifact |
| FalkorDB failure/recovery review | Platform/SRE and backend engineer | 0.5 engineer-day | Same runner; approved test window | Health, neighbor, path, injection, persistence, outage, and recovery evidence |
| Staging lifecycle assessment and backup proof | 1 PostgreSQL DBA, 1 DPCO data owner, 1 SRE/release engineer | 1–1.5 engineer-days | Staging credential; data classification; approved backup location; freeze window | Read-only report, backup manifest, restore proof |
| Staging quarantine/remediation and constraint validation | DBA, DPCO data owner, release manager | 0.5–1 engineer-day | Formal approval if records are found; maintenance window | Quarantine report, zero-count recheck, validated catalog constraints |
| Release review | Security lead, DBA, service owners, release manager | 0.5 engineer-day | Evidence pack complete | Signed release decision and rollback owner |

The minimum working team is therefore **one platform/SRE engineer, one backend engineer, one DBA, one DPCO data owner, and a security/release approver**. The same person may cover backend and platform only if they are not also the final approver. Separation of implementation and approval is important for insider-risk control.

## 2. FalkorDB P0 critical path

The FalkorDB code has a real client adapter, parameterized neighbor/path reads, node/statistics reads, and an explicitly gated PostgreSQL materialization route. What remains is deployment evidence against a real server. The required workflow must not be replaced with a mock or with a host whose Docker networking preflight fails.

### 2.1 Provision the qualified runner

Register a self-hosted runner with all required labels:

```text
self-hosted
linux
docker-bridge
```

The runner must have Docker Engine, Compose v2, Buildx, IP forwarding, `iptables -t raw -S PREROUTING`, and permission to create a disposable bridge-network container. The runner must be dedicated or isolated from production secrets; its job token should have the minimum GitHub permissions required to read the repository and upload artifacts.

Before dispatch, perform the workflow’s own preflight. A raw-table or bridge failure is a **stop condition**, not a reason to edit or bypass the workflow.

### 2.2 Execute and retain live evidence

After the workflow definition is available on the target branch and the runner is online:

```bash
gh workflow run falkordb-live-integration.yml --ref production
```

Record the workflow URL, commit SHA, runner labels, container image digests, and uploaded log artifact. A passing result must cover the following assertions.

| Test | Required pass condition |
|---|---|
| Health | The worker reports the real FalkorDB connection as healthy. |
| Neighbor and path reads | Returned graph results are from the server-backed graph and observe query bounds. |
| Injection defense | Invalid labels or path inputs are rejected without altering graph state. |
| Rebuild | With `FALKORDB_REBUILD_ENABLED=true`, PostgreSQL-derived materialization writes are committed before success is returned. |
| Persistence | Graph records remain after worker restart. |
| Outage | FalkorDB unavailability returns an explicit failure; no in-memory graph response is served. |
| Recovery | Requests recover only after the real server has recovered. |

### 2.3 FalkorDB rollback and proof

The workflow uses disposable volumes and must remove them on completion. Production deployment rollback is different: retain the prior APISIX/worker release artifact, disable the rebuild environment gate, and roll back the worker only after exporting an incident bundle containing application logs, FalkorDB logs, and the exact graph/version identifiers. Never delete a persistent production graph as a rollback mechanism without a data-owner-approved snapshot and restore test.

## 3. Staging PostgreSQL lifecycle remediation

The script `scripts/remediate-dpco-lifecycle-identifiers.sh` does **not** fabricate licence or reference identifiers. If it finds invalid historical final-state records, it atomically moves them to `identifier_remediation_required`, retains `previous_final_status`, and records the remediation reason and timestamp in the JSON payload. Its `--apply` mode locks the two lifecycle tables in `SHARE ROW EXCLUSIVE` mode and commits both table updates as one transaction.[1]

### 3.1 Pre-flight: change control, access, and stop conditions

Before any write operation, obtain the staging change ticket, designate a rollback owner, and place lifecycle writers into a controlled maintenance/freeze window. Use a least-privilege, audited database role for report and validation; use the separately approved migration role only where `ALTER TABLE ... VALIDATE CONSTRAINT` is required.

The operation must stop before remediation if any of the following is true: backup cannot be restored to an isolated database; the DPCO data owner has not approved the affected-record list; unexpected application writers remain active; the report output changes between review and apply without explanation; or free storage is insufficient for a logical backup plus point-in-time recovery retention.

### 3.2 Backup and restore proof before remediation

Create a timestamped custom-format backup and a checksum manifest. Use your managed-database equivalent where `pg_dump` is unavailable, but preserve the same evidence properties: immutable backup ID, point-in-time, encrypted storage, access log, and successful isolated restore.

```bash
export DATABASE_URL="$STAGING_DATABASE_URL"
export BACKUP_ID="ndsep-staging-pre-dpco-$(date -u +%Y%m%dT%H%M%SZ)"

pg_dump --format=custom --no-owner --no-privileges \
  --file="${BACKUP_ID}.dump" "$DATABASE_URL"
sha256sum "${BACKUP_ID}.dump" > "${BACKUP_ID}.sha256"

# Restore proof occurs in an isolated database, never into staging.
createdb "${BACKUP_ID}_restore_proof"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="${BACKUP_ID}_restore_proof" "${BACKUP_ID}.dump"
psql "${BACKUP_ID}_restore_proof" -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema='public';"
```

Record the backup checksum, object-storage version ID, restore target, `pg_restore` exit status, table-count result, and measured restore duration. The release manager must compare the duration to the recovery-time objective. This is the first rollback proof; a backup that has not been restored is not rollback evidence.

### 3.3 Read-only assessment and approval

Run the report twice: once before stakeholder review and once immediately before `--apply`. Persist both outputs in the change ticket.

```bash
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report
```

The report has exactly two categories:

| Category | Meaning | Required approval |
|---|---|---|
| `registry_active_missing_licence` | An active registry lifecycle record lacks `payload.licence_number` | DPCO registry data owner and legal/compliance owner |
| `verification_issued_missing_ref` | An issued verification record lacks `payload.ref_number` | DPCO verification data owner and legal/compliance owner |

If both counts are zero, skip directly to constraint validation. If either count is non-zero, review the list of affected primary identifiers and record the business disposition. The approved remediation is **quarantine to `identifier_remediation_required`**, not creation of plausible identifiers.

### 3.4 Apply the non-fabricating remediation

During the approved maintenance window, confirm the second report matches the approved record counts. Then execute:

```bash
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --apply

DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --report
```

The script transaction either commits both registry and verification quarantine changes or rolls them both back on error. Capture the transaction output and the post-apply zero-count report. The data owner must acknowledge that affected records have left their final state and are awaiting authoritative identifiers.

### 3.5 Validate constraints only after the report is clean

```bash
DATABASE_URL="$STAGING_DATABASE_URL" \
  ./scripts/remediate-dpco-lifecycle-identifiers.sh --validate-constraints

psql "$STAGING_DATABASE_URL" -P pager=off -c "
SELECT conname, convalidated
FROM pg_constraint
WHERE conname IN (
  'dpco_registry_active_requires_licence_number',
  'dpco_verification_issued_requires_ref_number'
)
ORDER BY conname;"
```

Both values must be `true`. Constraint validation scans historical records but does not rewrite them. It is therefore executed after the report is zero and before the maintenance window is released.

## 4. Rollback plan and proof standard

### 4.1 Rollback decision points

| Point | Trigger | Action |
|---|---|---|
| Before `--apply` | Backup or restore proof fails; report count lacks approval | Stop. No staging data has changed. Correct the operational condition and repeat pre-flight. |
| During `--apply` | Script/connection/lock failure before commit | The script transaction rolls back automatically. Verify both table counts against the pre-apply report. |
| After committed `--apply`, before constraint validation | Business owner rejects quarantine result or application compatibility test fails | Pause lifecycle writers, restore the approved backup to a replacement staging instance or use a documented, reviewed compensating update based on the recorded affected IDs. Do not hand-edit identifiers. |
| After constraint validation | Application error or unexpected data condition | Roll back the application deployment first if schema-compatible. Restore to a separate replacement instance for data rollback; do not drop constraints or mutate identifiers in place without a new approved change. |

### 4.2 Required rollback proof

The release evidence must prove more than the ability to issue a restore command. It must include:

1. A pre-remediation backup checksum and immutable storage/version reference.
2. A successful restore to an isolated target with the expected 168-table schema catalog result.
3. A sampled comparison of both lifecycle tables between the backup and restore target, including counts by final status and identifier presence.
4. A timed application read-only smoke test against the restored target, with secrets isolated from staging/production.
5. A documented recovery-time and recovery-point result, with the DBA and release manager sign-off.
6. An application compatibility check proving the deployed version handles `identifier_remediation_required` safely before any quarantine is committed.

> **Important:** The canonical migration checks are additive and the remediation is intentionally non-fabricating. The safest rollback for committed record-state changes is restore to a separate replacement environment followed by controlled cutover, rather than destructive in-place reversal.

## 5. P0 exit checklist

| Gate | Required final evidence |
|---|---|
| FalkorDB | Passing self-hosted live workflow URL, runner preflight, and uploaded artifact covering health/read/injection/rebuild/persistence/outage/recovery |
| Staging backup | Immutable backup ID/checksum, encrypted location, successful isolated restore, measured restore time |
| Lifecycle report | Approved pre-apply and post-apply report outputs with zero remaining invalid final-state records |
| Lifecycle constraints | Catalog output showing both migration-0034 constraints `convalidated = true` |
| Security separation | DBA, data owner, and release approver sign-offs; no single operator performs remediation and approval |
| Release readiness | Evidence attached to PR #2 and linked from the change ticket |

## References

[1] [Lifecycle identifier remediation script](../../scripts/remediate-dpco-lifecycle-identifiers.sh)
[2] [PR #2 Production Merge Checklist](./PR2_PRODUCTION_MERGE_CHECKLIST.md)
[3] [Requirements Traceability](../requirements/REQUIREMENTS_TRACEABILITY.md)
