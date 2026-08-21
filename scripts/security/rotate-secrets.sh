#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# NDSEP Secret Rotation Script
# Rotates JWT secrets, database passwords, and API keys
# Usage: ./security/rotate-secrets.sh [--dry-run] [--component <name>]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=false
COMPONENT="all"
LOG_FILE="/var/log/ndsep/secret-rotation-$(date +%Y%m%d-%H%M%S).log"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --component) COMPONENT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
warn() { log "WARN: $*"; }
error() { log "ERROR: $*"; exit 1; }

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || LOG_FILE="/tmp/ndsep-secret-rotation-$(date +%Y%m%d).log"

log "=== NDSEP Secret Rotation ==="
log "Component: $COMPONENT"
log "Dry run: $DRY_RUN"

# ─────────────────────────────────────────────────────────────────────────────
# Helper: Generate cryptographically secure random secret
# ─────────────────────────────────────────────────────────────────────────────
generate_secret() {
  local length="${1:-64}"
  openssl rand -base64 "$length" | tr -d '\n/+=' | head -c "$length"
}

generate_hex() {
  local length="${1:-32}"
  openssl rand -hex "$length"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. JWT Secret Rotation
# ─────────────────────────────────────────────────────────────────────────────
rotate_jwt() {
  log "[JWT] Rotating JWT signing secret..."
  local new_secret
  new_secret=$(generate_secret 64)
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[JWT] DRY RUN — would set JWT_SECRET to: ${new_secret:0:8}..."
    return
  fi
  
  # Update in environment (platform-specific)
  # For Manus platform: use the secrets management API
  # For Kubernetes: kubectl create secret generic ndsep-secrets --from-literal=JWT_SECRET="$new_secret" --dry-run=client -o yaml | kubectl apply -f -
  log "[JWT] New JWT_SECRET generated (length: ${#new_secret})"
  log "[JWT] ACTION REQUIRED: Update JWT_SECRET in your secrets manager"
  echo "JWT_SECRET=$new_secret" >> /tmp/ndsep-new-secrets.env
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Database Password Rotation
# ─────────────────────────────────────────────────────────────────────────────
rotate_db() {
  log "[DB] Rotating database password..."
  local new_password
  new_password=$(generate_secret 32)
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DB] DRY RUN — would rotate ndsep_user password"
    return
  fi
  
  # Check if psql is available
  if command -v psql &>/dev/null && [[ -n "${DATABASE_URL:-}" ]]; then
    log "[DB] Updating PostgreSQL password..."
    psql "$DATABASE_URL" -c "ALTER USER ndsep_user WITH PASSWORD '$new_password';" || warn "[DB] Failed to update DB password via psql"
  fi
  
  log "[DB] New DB password generated"
  log "[DB] ACTION REQUIRED: Update DATABASE_URL in your secrets manager"
  echo "DB_PASSWORD=$new_password" >> /tmp/ndsep-new-secrets.env
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. Worker Relay Token Rotation
# ─────────────────────────────────────────────────────────────────────────────
rotate_relay_token() {
  log "[RELAY] Rotating worker relay authentication token..."
  local new_token
  new_token=$(generate_hex 32)
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[RELAY] DRY RUN — would rotate WORKER_RELAY_TOKEN"
    return
  fi
  
  log "[RELAY] New relay token generated"
  log "[RELAY] ACTION REQUIRED: Update WORKER_RELAY_TOKEN in all worker configs"
  echo "WORKER_RELAY_TOKEN=$new_token" >> /tmp/ndsep-new-secrets.env
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. mTLS Certificate Renewal Check
# ─────────────────────────────────────────────────────────────────────────────
check_cert_expiry() {
  log "[MTLS] Checking certificate expiry..."
  local cert_dir="${CERT_DIR:-./certs}"
  
  if [[ -d "$cert_dir" ]]; then
    find "$cert_dir" -name "*.crt" | while read -r cert; do
      local expiry
      expiry=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)
      local expiry_epoch
      expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)
      local now_epoch
      now_epoch=$(date +%s)
      local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      
      if [[ $days_left -lt 30 ]]; then
        warn "[MTLS] Certificate expiring in $days_left days: $cert"
        log "[MTLS] ACTION REQUIRED: Run ./security/mtls/generate-certs.sh to renew"
      else
        log "[MTLS] Certificate OK ($days_left days remaining): $(basename $cert)"
      fi
    done
  else
    warn "[MTLS] Certificate directory not found: $cert_dir"
    log "[MTLS] Run ./security/mtls/generate-certs.sh to generate certificates"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. Redis Password Rotation
# ─────────────────────────────────────────────────────────────────────────────
rotate_redis() {
  log "[REDIS] Rotating Redis authentication password..."
  local new_password
  new_password=$(generate_secret 32)
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[REDIS] DRY RUN — would rotate REDIS_PASSWORD"
    return
  fi
  
  log "[REDIS] New Redis password generated"
  log "[REDIS] ACTION REQUIRED: Update REDIS_URL in your secrets manager"
  echo "REDIS_PASSWORD=$new_password" >> /tmp/ndsep-new-secrets.env
}

# ─────────────────────────────────────────────────────────────────────────────
# Main execution
# ─────────────────────────────────────────────────────────────────────────────
rm -f /tmp/ndsep-new-secrets.env

case "$COMPONENT" in
  all)
    rotate_jwt
    rotate_db
    rotate_relay_token
    rotate_redis
    check_cert_expiry
    ;;
  jwt) rotate_jwt ;;
  db) rotate_db ;;
  relay) rotate_relay_token ;;
  redis) rotate_redis ;;
  certs) check_cert_expiry ;;
  *) error "Unknown component: $COMPONENT. Use: all|jwt|db|relay|redis|certs" ;;
esac

log ""
log "=== Rotation Complete ==="
if [[ -f /tmp/ndsep-new-secrets.env ]]; then
  log "New secrets written to: /tmp/ndsep-new-secrets.env"
  log "IMPORTANT: Update these values in your secrets manager, then delete this file"
  log "           rm -f /tmp/ndsep-new-secrets.env"
fi
log "Rotation log: $LOG_FILE"
