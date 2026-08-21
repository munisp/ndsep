#!/usr/bin/env bash
set -euo pipefail

# Automated, evidence-preserving quarantine response. Read-only by default.
# It never edits outbox/ledger rows. --freeze requires explicit confirmation.
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PREPROD_NAMESPACE:?PREPROD_NAMESPACE is required}"

MODE=report
CONFIRM=""
EVIDENCE_DIR="${EVIDENCE_DIR:-/secure/evidence/ndsep-financial-quarantine}"
API_DEPLOYMENT="${API_DEPLOYMENT:-ndsep-api}"

usage() {
  cat <<'EOF'
Usage:
  respond_financial_transfer_quarantine.sh --report
  respond_financial_transfer_quarantine.sh --freeze --confirm FREEZE_NDSEP_FUNDS

Environment:
  DATABASE_URL       PostgreSQL URL from the secret manager
  PREPROD_NAMESPACE  Kubernetes namespace (or production namespace in an approved incident)
  API_DEPLOYMENT     Defaults to ndsep-api
  EVIDENCE_DIR       Defaults to /secure/evidence/ndsep-financial-quarantine
EOF
}

while (($#)); do
  case "$1" in
    --report) MODE=report ;;
    --freeze) MODE=freeze ;;
    --confirm) shift; CONFIRM="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$EVIDENCE_DIR/quarantine-$STAMP.txt"

{
  printf 'NDSEP financial quarantine report\nUTC=%s\nnamespace=%s\napi_deployment=%s\n' "$STAMP" "$PREPROD_NAMESPACE" "$API_DEPLOYMENT"
  printf '\n== Outbox state counts ==\n'
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
    "SELECT state, count(*) FROM financial_transfer_outbox GROUP BY state ORDER BY state;"
  printf '\n== Quarantined rows ==\n'
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
    "SELECT id, transfer_reference, transfer_kind, amount_minor, currency, state, attempts, lease_owner, lease_expires_at, left(coalesce(last_error,''),400) AS last_error, created_at, updated_at FROM financial_transfer_outbox WHERE state IN ('reconciliation_required','dead_letter') ORDER BY updated_at;"
  printf '\n== Recent provider observations ==\n'
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
    "SELECT transfer_reference, provider, observed_state, action, response_sha256, left(coalesce(detail,''),400) AS detail, created_at FROM financial_provider_reconciliation WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at;"
  printf '\n== API pod metadata ==\n'
  kubectl -n "$PREPROD_NAMESPACE" get pods -l app=ndsep-api -o wide
  printf '\n== Recent API quarantine logs ==\n'
  kubectl -n "$PREPROD_NAMESPACE" logs -l app=ndsep-api --since=30m --all-containers=true | grep -E 'FinancialOutbox|reconciliation_required|dead_letter|provider conflict' || true
} > "$REPORT"

sha256sum "$REPORT" > "$REPORT.sha256"
printf 'Evidence report: %s\nEvidence hash: %s\n' "$REPORT" "$REPORT.sha256"

if [[ "$MODE" == report ]]; then
  printf 'REPORT ONLY: no Kubernetes or financial state was changed.\n'
  exit 0
fi

[[ "$CONFIRM" == "FREEZE_NDSEP_FUNDS" ]] || {
  echo "Refusing freeze: pass --confirm FREEZE_NDSEP_FUNDS" >&2
  exit 1
}

# This is an operational containment action, not a financial-state mutation.
kubectl -n "$PREPROD_NAMESPACE" scale deployment/"$API_DEPLOYMENT" --replicas=0
kubectl -n "$PREPROD_NAMESPACE" rollout status deployment/"$API_DEPLOYMENT" --timeout=120s || true
printf 'FUNDS-MOVEMENT CONTAINMENT APPLIED: API deployment scaled to zero. Preserve evidence and begin provider reconciliation.\n'
