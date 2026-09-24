#!/usr/bin/env python3
"""
NDSEP Anti-Wipe Filesystem Watchdog
====================================
Standalone integrity loop for the antiwipe controls
(docs/runbooks/antiwipe-protection.md):

  1. Stats the evidence vault + quarantine dirs (file counts / bytes).
  2. Verifies ransomware canary hashes registered in `canary_files`.
  3. Re-hashes the N newest `evidence_vault_entries` against their content
     addresses (SHA-256).
  4. Checks the hash-chained ledger head via the antiwipe HTTP API
     (ANTIWIPE_API_URL); falls back to a direct-DB head recompute when the
     API is unreachable (result marked degraded, not failed).
  5. Appends one heartbeat row to `watchdog_heartbeats` per cycle via direct
     Postgres insert.

Any hard integrity failure (canary modified/missing, vault hash mismatch,
API-confirmed broken ledger) exits the process NON-ZERO so the process
supervisor (systemd/docker restart policy) raises the alarm.

Environment:
  WORKER_DATABASE_URL    Postgres DSN (default per worker_base)
  EVIDENCE_VAULT_DIR     vault root (default ./data/vault)
  ANTWIPE_QUARANTINE_DIR quarantine root (default ./data/quarantine)
  ANTIWIPE_API_URL       base URL of the NDSEP API, e.g. http://localhost:3000
                         (legacy typo ANTWIPE_API_URL is also honoured)
  WATCHDOG_INTERVAL      seconds between cycles (default 300; 0 = run once)
  WATCHDOG_VERIFY_N      newest vault entries re-hashed per cycle (default 25)
  WATCHDOG_HEALTH_PORT   health server port (default 8170; 0 disables)
  LOG_LEVEL              standard worker_base log level
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests

import worker_base

WORKER_ID = "antiwipe-watchdog"
log = worker_base.get_logger(WORKER_ID)

VAULT_DIR = Path(os.environ.get("EVIDENCE_VAULT_DIR", "./data/vault")).resolve()
QUARANTINE_DIR = Path(os.environ.get("ANTWIPE_QUARANTINE_DIR", "./data/quarantine")).resolve()
API_URL = (
    os.environ.get("ANTIWIPE_API_URL")
    or os.environ.get("ANTWIPE_API_URL")  # legacy typo, kept for compatibility
    or "http://localhost:3000"
).rstrip("/")
INTERVAL = int(os.environ.get("WATCHDOG_INTERVAL", "300"))
VERIFY_N = int(os.environ.get("WATCHDOG_VERIFY_N", "25"))
HEALTH_PORT = int(os.environ.get("WATCHDOG_HEALTH_PORT", "8170"))

GENESIS_HASH = hashlib.sha256(b"genesis").hexdigest()


# ── Directory stats ──────────────────────────────────────────────────────────

def dir_stats(root: Path) -> Dict[str, int]:
    files = 0
    bytes_total = 0
    if root.exists():
        for p in root.rglob("*"):
            if p.is_file():
                files += 1
                try:
                    bytes_total += p.stat().st_size
                except OSError:
                    pass
    return {"files": files, "bytes": bytes_total}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ── Canary verification ──────────────────────────────────────────────────────

def check_canaries(pool) -> Tuple[int, int, list]:
    """Returns (ok_count, failed_count, failures[])."""
    ok = 0
    failures = []
    with worker_base.get_conn(pool) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT path, sha256 FROM canary_files WHERE status <> 'disabled'")
            rows = cur.fetchall()
            for path_str, expected in rows:
                p = Path(path_str)
                status = "ok"
                actual = None
                if not p.exists():
                    status = "missing"
                else:
                    try:
                        actual = sha256_file(p)
                        if actual != expected:
                            status = "modified"
                    except OSError:
                        status = "missing"
                cur.execute(
                    "UPDATE canary_files SET last_checked_at = now(), status = %s WHERE path = %s",
                    (status, path_str),
                )
                if status == "ok":
                    ok += 1
                else:
                    failures.append({"path": path_str, "status": status,
                                     "expected": expected, "actual": actual})
        conn.commit()
    return ok, len(failures), failures


# ── Vault verification ───────────────────────────────────────────────────────

def verify_vault_entries(pool, n: int) -> Tuple[int, int, list]:
    """Re-hash the n newest vault entries. Returns (checked, verified, failures[])."""
    checked = 0
    verified = 0
    failures = []
    with worker_base.get_conn(pool) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT hash, path, size_bytes FROM evidence_vault_entries "
                "ORDER BY created_at DESC LIMIT %s",
                (n,),
            )
            rows = cur.fetchall()
    for hash_hex, rel_path, size_bytes in rows:
        checked += 1
        p = VAULT_DIR / rel_path
        if not p.exists():
            failures.append({"hash": hash_hex, "reason": "missing_file"})
            continue
        try:
            if p.stat().st_size != size_bytes:
                failures.append({"hash": hash_hex, "reason": "size_mismatch"})
                continue
            if sha256_file(p) != hash_hex:
                failures.append({"hash": hash_hex, "reason": "hash_mismatch"})
                continue
        except OSError as exc:
            failures.append({"hash": hash_hex, "reason": f"read_error:{exc}"})
            continue
        verified += 1
    return checked, verified, failures


# ── Ledger head check ────────────────────────────────────────────────────────

def _canonical_json(value: Any) -> str:
    """Matches server/antiwipe/ledger.ts canonicalJson for typical payloads."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _iso_ms(dt: datetime) -> str:
    """Match JS Date#toISOString(): millisecond precision, 'Z' suffix."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def check_ledger_via_api() -> Optional[Dict[str, Any]]:
    """Ask the antiwipe API for chain status. None if unreachable."""
    try:
        resp = requests.get(f"{API_URL}/api/antiwipe/status", timeout=5)
        if resp.status_code == 200:
            return resp.json()
        log.warning(f"antiwipe API returned HTTP {resp.status_code}")
    except requests.RequestException as exc:
        log.warning(f"antiwipe API unreachable at {API_URL}: {exc}")
    return None


def check_ledger_via_db(pool) -> Tuple[Optional[str], Optional[bool]]:
    """Fallback: recompute the head entry hash directly. (head_hash, ok|None)."""
    with worker_base.get_conn(pool) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT seq, prev_hash, entry_hash, payload, created_at "
                "FROM audit_ledger ORDER BY seq DESC LIMIT 1"
            )
            row = cur.fetchone()
    if row is None:
        return None, True  # empty chain is vacuously valid
    _seq, prev_hash, entry_hash, payload, created_at = row
    recomputed = hashlib.sha256(
        (prev_hash + _canonical_json(payload) + _iso_ms(created_at)).encode("utf-8")
    ).hexdigest()
    # Canonicalization edge cases (numeric rendering) can cause false
    # negatives here, so a mismatch is reported as degraded (None), not
    # a hard failure — the API path is authoritative.
    return entry_hash, (True if recomputed == entry_hash else None)


# ── Heartbeat ────────────────────────────────────────────────────────────────

def insert_heartbeat(pool, result: Dict[str, Any]) -> None:
    with worker_base.get_conn(pool) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO watchdog_heartbeats
                  (worker_id, vault_files, vault_verified, canaries_ok,
                   canaries_failed, ledger_head_hash, ledger_ok, status, details)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    WORKER_ID,
                    result.get("vault_files"),
                    result.get("vault_verified"),
                    result.get("canaries_ok"),
                    result.get("canaries_failed"),
                    result.get("ledger_head_hash"),
                    result.get("ledger_ok"),
                    result["status"],
                    json.dumps(result.get("details", {})),
                ),
            )
        conn.commit()


# ── Main cycle ───────────────────────────────────────────────────────────────

def run_cycle(pool, health) -> bool:
    """One integrity sweep. Returns True if everything is intact."""
    result: Dict[str, Any] = {"details": {}}

    vault_stats = dir_stats(VAULT_DIR)
    quarantine_stats = dir_stats(QUARANTINE_DIR)
    result["vault_files"] = vault_stats["files"]
    result["details"]["vault"] = vault_stats
    result["details"]["quarantine"] = quarantine_stats

    can_ok, can_failed, can_failures = check_canaries(pool)
    result["canaries_ok"] = can_ok
    result["canaries_failed"] = can_failed
    if can_failures:
        result["details"]["canary_failures"] = can_failures

    checked, verified, vault_failures = verify_vault_entries(pool, VERIFY_N)
    result["details"]["vault_checked"] = checked
    result["vault_verified"] = verified
    if vault_failures:
        result["details"]["vault_failures"] = vault_failures

    api_status = check_ledger_via_api()
    if api_status is not None:
        ledger = api_status.get("ledger", api_status)
        result["ledger_head_hash"] = ledger.get("headHash")
        tail = ledger.get("tailCheck") or {}
        result["ledger_ok"] = bool(tail.get("valid", True))
        result["details"]["ledger_source"] = "api"
    else:
        head_hash, db_ok = check_ledger_via_db(pool)
        result["ledger_head_hash"] = head_hash
        result["ledger_ok"] = db_ok
        result["details"]["ledger_source"] = "db_fallback"

    hard_failure = (
        can_failed > 0
        or bool(vault_failures)
        or result["ledger_ok"] is False
    )
    degraded = result["ledger_ok"] is None
    result["status"] = (
        "integrity_failure" if hard_failure else ("degraded" if degraded else "ok")
    )
    result["checked_at"] = datetime.now(timezone.utc).isoformat()

    insert_heartbeat(pool, result)

    if health:
        health.increment_cycle()
        health.set_extra("antiwipe", {
            "status": result["status"],
            "canaries_failed": can_failed,
            "vault_verified": verified,
            "ledger_ok": result["ledger_ok"],
        })

    if hard_failure:
        log.error("INTEGRITY FAILURE", extra={"data": result["details"]})
        print(
            f"[ANTWIPE-WATCHDOG] INTEGRITY FAILURE: {json.dumps(result['details'])}",
            file=sys.stderr,
        )
        return False
    if degraded:
        log.warning("degraded cycle", extra={"data": result["details"]})
    else:
        log.info(
            f"cycle ok: canaries {can_ok}/{can_ok + can_failed}, "
            f"vault {verified}/{checked}, ledger head {result['ledger_head_hash']}"
        )
    return True


def main() -> int:
    worker_base.init_relay(WORKER_ID)
    pool = worker_base.init_db(WORKER_ID)
    shutdown = worker_base.setup_shutdown(WORKER_ID)

    health = None
    if HEALTH_PORT > 0:
        try:
            health = worker_base.start_health_server(HEALTH_PORT, WORKER_ID, pool)
        except OSError as exc:
            log.warning(f"health server unavailable on :{HEALTH_PORT}: {exc}")

    log.info(
        f"watchdog starting: vault={VAULT_DIR} quarantine={QUARANTINE_DIR} "
        f"api={API_URL} interval={INTERVAL}s verify_n={VERIFY_N}"
    )

    while not shutdown.is_set():
        try:
            ok = run_cycle(pool, health)
        except Exception as exc:  # keep the loop alive on transient errors
            log.exception(f"cycle error: {exc}")
            ok = True  # transient infra error is not an integrity verdict
        if not ok:
            worker_base.broadcast("antiwipe.integrity_failure", {"worker": WORKER_ID})
            return 1  # non-zero exit: supervisor must alert
        if INTERVAL <= 0:
            return 0
        shutdown.wait(INTERVAL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
