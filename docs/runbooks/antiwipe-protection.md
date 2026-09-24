# Anti-Wipe Protection Runbook

Regulatory context: NDSEP evidence files and audit trails must be
**tamper-evident** and must **survive ransomware and wipe attempts**. This
runbook covers the `antiwipe` module family:

| Component | Location | Purpose |
| --- | --- | --- |
| Evidence vault | `server/antiwipe/vault.ts` | Append-only, content-addressed evidence store |
| Audit ledger | `server/antiwipe/ledger.ts` | Hash-chained, trigger-protected audit chain + daily anchors |
| Destructive-op guards | `server/antiwipe/guards.ts` | SQL guard, filesystem quarantine, soft-delete enforcement |
| Backup guard | `server/antiwipe/backupGuard.ts` | Backup manifest verification + ransomware canaries |
| Watchdog worker | `workers/python/antiwipe_watchdog.py` | Out-of-process integrity loop, non-zero exit on failure |
| Scheduler (optional) | `server/antiwipe/scheduler.ts` | In-process cadence: anchors, canary checks, tail verify |
| Migrations | `drizzle/migrations/0060..0063` | Tables + append-only triggers |
| tRPC router | `server/antiwipe/router.ts` | `antiwipe.append/verify/anchor/status`, vault/backup/canary procedures |

---

## 1. Threat model

### T1 — Ransomware / mass encryption
Attacker (or malware with app-host privileges) encrypts or deletes evidence
files and database tables, then demands ransom.

**Controls:**
- *Canaries* (`canary_files` + `writeCanary`/`checkCanaries`): tripwire files
  with known hashes in the vault, backup, and quarantine dirs. Encryption or
  deletion changes/removes them → `audit_logs` alert + `console.error` (SIEM)
  + ledger entry, within one watchdog cycle (default 5 min out-of-process,
  hourly in-process).
- *Content-addressed vault*: re-encryption of vault files is detectable by
  re-hashing (`vaultVerify`, watchdog sweep).
- *Backup manifest*: backups carry SHA-256; a ransom note claiming "your
  backups are gone too" is verifiable, and a swapped/corrupted dump fails
  `backupVerify`.
- *Quarantine deletes*: `safeDeleteFile` never unlinks; bulk "deletion"
  attempts produce a recoverable quarantine tree.

### T2 — Malicious insider (incl. privileged app credentials)
Insider rewrites history: edits an audit row, deletes evidence of a complaint,
"tidies up" a case.

**Controls:**
- *Hash-chained ledger*: `entry_hash = sha256(prev_hash || canonical(payload)
  || created_at)`. Editing any historical row breaks every later link;
  `antiwipe.verify` reports the **first broken seq**.
- *DB triggers* (migrations 0060–0063): `UPDATE`/`DELETE`/`TRUNCATE` on
  `audit_ledger`, `ledger_anchors`, `evidence_vault_entries` (delete),
  `backup_manifest` (delete), `canary_files` (delete), `watchdog_heartbeats`
  raise exceptions **even for the app's own DB user**. Vault updates are
  limited to the one-way `sealed: false → true` transition.
- *API surface with no mutation*: the vault module exports no update/delete
  functions at all; review any PR that adds one.
- *Daily anchors* mirrored to the external Rust `audit_chain` worker: an
  insider would have to forge both the Postgres chain and the external
  service's copy.

### T3 — Accidental wipe / fat-fingered ops
`DROP TABLE` in the wrong terminal, `rm -rf` with a bad glob, migration run
against prod instead of staging.

**Controls:**
- *`assertNotDestructive(sql)`*: rejects DROP/TRUNCATE/DELETE-without-WHERE
  against the protected table list in the app SQL layer.
- *`safeDeleteFile(path)`*: refuses vault/backup/ledger/quarantine paths
  outright; everything else is quarantined, not unlinked.
- *Triggers* are the last line even if the SQL guard is bypassed with psql as
  the app role. Only a superuser/owner explicitly dropping the triggers can
  mutate — and that action itself is outside every sanctioned path.
- *Backup verification*: restore drills use `verifyBackup` so a "backup" that
  was never valid is discovered before the day it is needed.

---

## 2. Operating procedures

### 2.1 Storing evidence
```ts
await trpc.antiwipe.vaultPut.mutate({ contentBase64, caseRef: "CASE-2026-014", contentType });
```
Bytes are hashed (SHA-256), written once under
`$EVIDENCE_VAULT_DIR/YYYY-MM-DD/<sha256>` with mode `0440`, and indexed in
`evidence_vault_entries`. Re-upload of identical content is an idempotent
dedupe. There is no delete: disposal is a break-glass infra operation (§4).

### 2.2 Sealing evidence (end of case)
```ts
await trpc.antiwipe.vaultSeal.mutate({ hash }); // admin only
```
One-way. The DB trigger freezes every content-identity column; `sealed` can
never flip back.

### 2.3 Verification cadence
| Check | Actor | Cadence |
| --- | --- | --- |
| Canary hashes | watchdog worker + optional in-process scheduler | 5 min / 1 h |
| Newest 25 vault entries | watchdog + scheduler | 5 min / 15 min |
| Ledger tail (100 entries) | `antiwipe.status` / scheduler | 15 min |
| Full chain walk | `antiwipe.verify` (ops, or weekly cron) | weekly |
| Daily anchor | `antiwipe.anchor` for yesterday (scheduler or cron) | daily |
| Backup verify | `antiwipe.backupVerify` after each backup + weekly on latest | per backup / weekly |

CLI-style full chain verification (bypasses tRPC auth for break-glass):
```bash
psql $DATABASE_URL -c "SELECT seq, prev_hash, entry_hash FROM audit_ledger ORDER BY seq" \
  # then recompute per server/antiwipe/ledger.ts (entry_hash = sha256(prev||canon(payload)||created_at))
```

### 2.4 Daily anchoring
`anchorLedger(date)` folds the day's entry hashes into a merkle-style root
(same algorithm as `workers/rust/audit_chain`) into `ledger_anchors`, and
best-effort POSTs to the Rust worker (`AUDIT_CHAIN_URL`, default
`http://localhost:8165`, `POST /api/v1/audit/append`). If the worker is down
the anchor is still stored locally with `external_anchor.mirrored = false`.
One anchor per UTC day; re-running is idempotent.

### 2.5 Backup registration & restore verification
`scripts/backup-postgres.sh` already writes `<dump>.sha256` sidecars. After
each run:
```ts
await trpc.antiwipe.backupRegister.mutate({ backupId, path, type: "postgres" });
await trpc.antiwipe.backupVerify.mutate({ backupId });
```
Registration cross-checks the sidecar; verification re-hashes the artifact.
**Before any restore**, verify the manifest row is `verified = true` and
re-run `backupVerify`; never restore an unverified artifact.

### 2.6 Canary operations
- Write/refresh: `antiwipe.canaryWrite` (admin) or the scheduler (daily).
- Watched dirs: `ANTWIPE_CANARY_DIRS` (comma-separated), default = vault,
  backup dir (`BACKUP_DIR`), quarantine.
- Alert handling: any `modified`/`missing` canary → treat as T1 incident:
  isolate host, snapshot disks, check `watchdog_heartbeats` for first
  anomaly time, verify ledger and vault before any cleanup.

### 2.7 Quarantine review
`safeDeleteFile` moves files to `data/quarantine/<UTC-timestamp>/`. Review
weekly; restore with `mv` if the delete was erroneous. Emptying quarantine is
a privileged manual operation — it is a protected path for `safeDeleteFile`.

---

## 3. Incident quick reference

| Signal | Meaning | First actions |
| --- | --- | --- |
| `antiwipe.canary_alert` in audit_logs | possible ransomware/wipe | isolate host; check heartbeat gaps; snapshot |
| `verifyChain` broken at seq N | ledger row N or N-1 tampered | freeze writes; diff row N against anchors/external mirror |
| vault `hash_mismatch` | evidence file modified on disk | quarantine host copy; restore file from backup; investigate mtime |
| heartbeat gap > 2 intervals | watchdog killed or host down | page on-call; treat as integrity incident until disproven |
| backup `hash_mismatch` | dump corrupted/swapped | do NOT restore; use previous verified backup |

---

## 4. Production hardening — honest limitations

**Application-level controls complement, never replace, infrastructure
immutability.** Anyone with root on the host (or the Postgres superuser, or
the cloud IAM role) can drop triggers, delete files, and forge heartbeats.
Deploy these infra complements:

1. **Immutable filesystem flags**: `chattr +i` (or `+a` for append-only dirs)
   on sealed vault day-directories via a root-only cron that lags writes by
   one day. The app runs unprivileged and cannot set/clear these flags.
2. **WORM object storage**: sync vault + backups to S3 with **Object Lock
   (compliance mode)** retention ≥ the NDPA evidence retention period, in a
   separate account with no delete permissions for the app role.
3. **Postgres role separation**: app role has `INSERT/SELECT` (and the narrow
   sealed/verified updates) on antiwipe tables only; trigger ownership and
   `DROP TRIGGER` stay with a DBA role requiring break-glass. Consider
   `REVOKE TRUNCATE` and row-security on top of the triggers.
4. **External anchoring**: run `workers/rust/audit_chain` on a *different*
   host/trust domain; an anchor mirrored there survives total loss of the
   primary DB. For evidentiary grade, periodically notarize the daily root
   externally (timestamping authority / public chain — the Rust worker's
   anchor interface is designed for this).
5. **Off-host heartbeat monitoring**: alert on heartbeat *absence*, not just
   `integrity_failure` rows — a wiped host cannot report its own death.
6. **Key management**: the ledger proves modification, not confidentiality;
   keep using the existing field encryption for payload PII.
