#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP PostgreSQL Backup Script
# ─────────────────────────────────────────────────────────────────────────────
# Performs a compressed pg_dump and optionally uploads to S3.
#
# Usage:
#   ./scripts/backup-postgres.sh                    # local backup only
#   ./scripts/backup-postgres.sh --upload-s3        # backup + upload to S3
#   ./scripts/backup-postgres.sh --verify           # verify latest backup
#
# Environment variables:
#   PG_HOST          (default: localhost)
#   PG_PORT          (default: 5432)
#   PG_USER          (default: ndsep_user)
#   PG_DB            (default: ndsep_db)
#   PGPASSWORD       (required for non-local)
#   BACKUP_DIR       (default: /var/backups/ndsep)
#   BACKUP_RETENTION (default: 30 days)
#   S3_BUCKET        (required for --upload-s3)
#   S3_PREFIX        (default: ndsep-backups)
#   ENCRYPTION_KEY   (optional: encrypt backup at rest with openssl)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-ndsep_user}"
PG_DB="${PG_DB:-ndsep_db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ndsep}"
BACKUP_RETENTION="${BACKUP_RETENTION:-30}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-ndsep-backups}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${PG_DB}_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
LOG_FILE="${BACKUP_DIR}/backup.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$BACKUP_DIR"

# ── Verify mode ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--verify" ]]; then
  LATEST=$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -1)
  if [[ -z "$LATEST" ]]; then
    log "ERROR: No backup files found in ${BACKUP_DIR}"
    exit 1
  fi
  log "Verifying latest backup: $LATEST"
  # Check integrity
  if sha256sum -c "${LATEST}.sha256" 2>/dev/null; then
    log "Checksum OK"
  else
    log "ERROR: Checksum verification failed!"
    exit 1
  fi
  # Test restore to temporary database
  VERIFY_DB="ndsep_verify_${TIMESTAMP}"
  log "Creating temporary database ${VERIFY_DB} for restore test..."
  createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$VERIFY_DB" 2>/dev/null || true
  if gunzip -c "$LATEST" | psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$VERIFY_DB" -q 2>/dev/null; then
    TABLE_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$VERIFY_DB" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
    log "Restore test PASSED — ${TABLE_COUNT} tables restored"
    dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$VERIFY_DB" 2>/dev/null || true
    exit 0
  else
    log "ERROR: Restore test FAILED"
    dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$VERIFY_DB" 2>/dev/null || true
    exit 1
  fi
fi

# ── Backup ──────────────────────────────────────────────────────────────────
log "Starting backup of ${PG_DB}@${PG_HOST}:${PG_PORT}"

pg_dump \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U "$PG_USER" \
  -d "$PG_DB" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --verbose \
  2>>"$LOG_FILE" | gzip -9 > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# ── Checksum ────────────────────────────────────────────────────────────────
sha256sum "$BACKUP_FILE" > "$CHECKSUM_FILE"
log "Checksum written to ${CHECKSUM_FILE}"

# ── Encrypt (optional) ─────────────────────────────────────────────────────
if [[ -n "${ENCRYPTION_KEY:-}" ]]; then
  openssl enc -aes-256-cbc -salt -pbkdf2 \
    -in "$BACKUP_FILE" \
    -out "${BACKUP_FILE}.enc" \
    -pass "env:ENCRYPTION_KEY"
  rm "$BACKUP_FILE"
  BACKUP_FILE="${BACKUP_FILE}.enc"
  log "Backup encrypted with AES-256-CBC"
fi

# ── Upload to S3 (optional) ────────────────────────────────────────────────
if [[ "${1:-}" == "--upload-s3" ]] && [[ -n "$S3_BUCKET" ]]; then
  S3_KEY="${S3_PREFIX}/$(date +%Y/%m)/${BACKUP_FILE##*/}"
  log "Uploading to s3://${S3_BUCKET}/${S3_KEY}"
  aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
    --storage-class STANDARD_IA \
    --sse aws:kms
  aws s3 cp "$CHECKSUM_FILE" "s3://${S3_BUCKET}/${S3_KEY}.sha256" \
    --storage-class STANDARD_IA \
    --sse aws:kms
  log "Upload complete"
fi

# ── Retention cleanup ──────────────────────────────────────────────────────
log "Cleaning backups older than ${BACKUP_RETENTION} days..."
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz*" -mtime +"$BACKUP_RETENTION" -delete -print | wc -l)
log "Deleted ${DELETED} old backup file(s)"

# ── Summary ────────────────────────────────────────────────────────────────
log "Backup summary:"
log "  File:      ${BACKUP_FILE}"
log "  Size:      ${BACKUP_SIZE}"
log "  Retention: ${BACKUP_RETENTION} days"
log "  S3:        ${S3_BUCKET:-(local only)}"
log "─── Backup complete ───"
