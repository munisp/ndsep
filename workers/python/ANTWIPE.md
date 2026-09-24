# Anti-Wipe Watchdog — Run Notes

`antiwipe_watchdog.py` is the out-of-process tripwire for the antiwipe
controls (see `docs/runbooks/antiwipe-protection.md`). It verifies, on a loop:

- evidence vault file hashes (`evidence_vault_entries` vs on-disk SHA-256)
- ransomware canary files (`canary_files` registry vs on-disk SHA-256)
- hash-chain ledger head (via the API, with direct-DB fallback)
- appends a `watchdog_heartbeats` row every cycle (append-only table)

It **exits non-zero on any integrity failure** so systemd / Docker restart
policies and the process supervisor page the on-call.

## Prerequisites

- Tables from `drizzle/migrations/0060..0063` applied.
- Python deps from `workers/python/requirements.txt` (`psycopg2`, `requests`).
- The API should expose the OPTIONAL status endpoint
  `GET /api/antiwipe/status` (see `/tmp/wave1/aw_registration.md`, block (c)).
  Without it the watchdog falls back to a direct-DB head recompute and
  reports `ledger_ok = null` (degraded) on canonicalization mismatches.

## Run

```bash
cd workers/python
WORKER_DATABASE_URL=postgresql://ndsep_user:***@localhost:5432/ndsep_db \
EVIDENCE_VAULT_DIR=/var/lib/ndsep/vault \
ANTIWIPE_API_URL=http://localhost:3000 \
WATCHDOG_INTERVAL=300 \
WATCHDOG_VERIFY_N=25 \
WATCHDOG_HEALTH_PORT=8170 \
python3 antiwipe_watchdog.py
```

One-shot mode (e.g. from cron with alerting on exit code):

```bash
WATCHDOG_INTERVAL=0 python3 antiwipe_watchdog.py || echo "INTEGRITY FAILURE"
```

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `WORKER_DATABASE_URL` | per `worker_base` | Postgres DSN for heartbeat + reads |
| `EVIDENCE_VAULT_DIR` | `./data/vault` | vault root to verify |
| `ANTWIPE_QUARANTINE_DIR` | `./data/quarantine` | quarantine root to stat |
| `ANTIWIPE_API_URL` | `http://localhost:3000` | NDSEP API base (`ANTWIPE_API_URL` typo also honoured) |
| `WATCHDOG_INTERVAL` | `300` | seconds between cycles; `0` = run once |
| `WATCHDOG_VERIFY_N` | `25` | newest vault entries re-hashed per cycle |
| `WATCHDOG_HEALTH_PORT` | `8170` | `/health` + `/status` HTTP port; `0` disables |

## systemd (production sketch)

```ini
[Unit]
Description=NDSEP anti-wipe watchdog
After=postgresql.service

[Service]
EnvironmentFile=/etc/ndsep/antiwipe-watchdog.env
ExecStart=/usr/bin/python3 /opt/ndsep/workers/python/antiwipe_watchdog.py
Restart=always
RestartSec=10
# Exit code 1 == integrity failure: alert via OnFailure= unit.
OnFailure=antiwipe-alert@%n.service

[Install]
WantedBy=multi-user.target
```

## Interpreting results

- `status=ok` heartbeat stream with no gaps: controls healthy.
- `status=degraded`: API unreachable and DB fallback could not confirm the
  ledger head — check API availability; not (by itself) a tamper verdict.
- `status=integrity_failure` + non-zero exit: canary modified/missing, vault
  hash mismatch, or API-confirmed broken chain. Follow the runbook's
  incident procedure immediately; a gap in heartbeats afterwards is itself
  a critical signal.
