#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP PostgreSQL Restore Script
# ─────────────────────────────────────────────────────────────────────────────
# Restores a PostgreSQL database from a backup file created by backup-postgres.sh.
#
# Usage:
#   ./scripts/restore-postgres.sh <backup_file>                  # restore from local file
#   ./scripts/restore-postgres.sh --from-s3 <s3_key>             # restore from S3
#   ./scripts/restore-postgres.sh --latest                       # restore latest local backup
#   ./scripts/restore-postgres.sh --pitr "2026-05-01 12:00:00"   # point-in-time recovery
#
# Environment variables:
#   PG_HOST, PG_PORT, PG_USER, PG_DB, PGPASSWORD, BACKUP_DIR, S3_BUCKET
#   ENCRYPTION_KEY  (required if backup is encrypted)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-ndsep_user}"
PG_DB="${PG_DB:-ndsep_db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ndsep}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-ndsep-backups}"

log() { echo "[$(date -Iseconds)] $*"; }

# ── Determine backup file ──────────────────────────────────────────────────
BACKUP_FILE=""
PITR_TARGET=""

if [[ "${1:-}" == "--latest" ]]; then
  BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -1)
  if [[ -z "$BACKUP_FILE" ]]; then
    log "ERROR: No backup files found in ${BACKUP_DIR}"
    exit 1
  fi
  log "Using latest backup: ${BACKUP_FILE}"

elif [[ "${1:-}" == "--from-s3" ]]; then
  S3_KEY="${2:?ERROR: S3 key required}"
  BACKUP_FILE="${BACKUP_DIR}/$(basename "$S3_KEY")"
  log "Downloading from s3://${S3_BUCKET}/${S3_KEY}"
  aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "$BACKUP_FILE"

elif [[ "${1:-}" == "--pitr" ]]; then
  PITR_TARGET="${2:?ERROR: Target timestamp required (e.g. '2026-05-01 12:00:00')}"
  log "Point-in-time recovery to: ${PITR_TARGET}"
  log "NOTE: PITR requires WAL archiving to be enabled. See infra/postgres/wal-archiving.conf"
  # For PITR, PostgreSQL uses recovery.conf / recovery.signal
  # This script creates the recovery configuration
  cat > /tmp/ndsep_recovery.conf <<EOF
restore_command = 'cp ${BACKUP_DIR}/wal/%f %p'
recovery_target_time = '${PITR_TARGET}'
recovery_target_action = 'promote'
EOF
  log "Recovery config written to /tmp/ndsep_recovery.conf"
  log "To apply: copy to PostgreSQL data directory and restart"
  log "  cp /tmp/ndsep_recovery.conf \$PGDATA/recovery.conf"
  log "  touch \$PGDATA/recovery.signal"
  log "  pg_ctl restart -D \$PGDATA"
  exit 0

else
  BACKUP_FILE="${1:?ERROR: Backup file path required}"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  log "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# ── Verify checksum ─────────────────────────────────────────────────────────
if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  if sha256sum -c "${BACKUP_FILE}.sha256"; then
    log "Checksum verification PASSED"
  else
    log "ERROR: Checksum verification FAILED — backup may be corrupted"
    exit 1
  fi
fi

# ── Decrypt if needed ──────────────────────────────────────────────────────
if [[ "$BACKUP_FILE" == *.enc ]]; then
  if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
    log "ERROR: ENCRYPTION_KEY required to decrypt backup"
    exit 1
  fi
  DECRYPTED="${BACKUP_FILE%.enc}"
  openssl enc -aes-256-cbc -d -pbkdf2 \
    -in "$BACKUP_FILE" \
    -out "$DECRYPTED" \
    -pass "env:ENCRYPTION_KEY"
  BACKUP_FILE="$DECRYPTED"
  log "Backup decrypted"
fi

# ── Confirm ─────────────────────────────────────────────────────────────────
log "WARNING: This will DROP and recreate database '${PG_DB}' on ${PG_HOST}:${PG_PORT}"
log "Press Ctrl+C within 5 seconds to abort..."
sleep 5

# ── Restore ─────────────────────────────────────────────────────────────────
log "Dropping existing database..."
dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" --if-exists "$PG_DB"

log "Creating fresh database..."
createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$PG_DB"

log "Restoring from ${BACKUP_FILE}..."
gunzip -c "$BACKUP_FILE" | psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -q

# ── Verify ─────────────────────────────────────────────────────────────────
TABLE_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
ROW_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT SUM(n_live_tup) FROM pg_stat_user_tables")

log "Restore complete:"
log "  Tables: ${TABLE_COUNT}"
log "  Rows:   ${ROW_COUNT:-0}"
log "─── Restore complete ───"
