#!/usr/bin/env bash
set -euo pipefail

# Preview-first pre-production rollout for migration 0117 and Mojaloop callback mTLS.
# Default behavior is read-only. Apply requires an explicit confirmation token.
# Required tools: kubectl, pnpm, psql, git.
# Required environment: PREPROD_NAMESPACE, PREPROD_CONTEXT, DATABASE_URL,
# MOJALOOP_CALLBACK_HMAC_SECRET, MOJALOOP_CALLBACK_MTLS_SUBJECT_DN.

MODE=preview
CONFIRM=""
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MTLS_CA_SECRET="mojaloop-client-ca"
MTLS_INGRESS="infra/k8s/mojaloop-callback-mtls-ingress.yaml"
MTLS_NETWORK_POLICY="infra/k8s/mojaloop-callback-networkpolicy.yaml"

usage() {
  cat <<'EOF'
Usage:
  rollout_preprod_financial_mtls.sh --dry-run
  rollout_preprod_financial_mtls.sh --apply --confirm PREPROD_FINANCIAL_MTLS

Required environment:
  PREPROD_NAMESPACE             Kubernetes namespace, e.g. ndsep-preprod
  PREPROD_CONTEXT               Exact kubectl context name
  DATABASE_URL                  Pre-production PostgreSQL URL, supplied via secret manager/CI
  MOJALOOP_CALLBACK_HMAC_SECRET Secret-manager value, >= 32 chars, never printed
  MOJALOOP_CALLBACK_MTLS_SUBJECT_DN Exact approved client certificate subject DN
  MOJALOOP_CLIENT_CA_FILE       PEM CA file used by the ingress mTLS secret
Optional:
  PREPROD_API_DEPLOYMENT        Defaults to ndsep-api
  PREPROD_API_HEALTH_URL        Defaults to https://api-preprod.ndsep.nitda.gov.ng/health
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) MODE=preview ;;
    --apply) MODE=apply ;;
    --confirm) shift; CONFIRM="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

: "${PREPROD_NAMESPACE:?PREPROD_NAMESPACE is required}"
: "${PREPROD_CONTEXT:?PREPROD_CONTEXT is required}"
: "${DATABASE_URL:?DATABASE_URL must be injected from the pre-production secret manager}"
: "${MOJALOOP_CALLBACK_HMAC_SECRET:?MOJALOOP_CALLBACK_HMAC_SECRET must be injected from the pre-production secret manager}"
: "${MOJALOOP_CALLBACK_MTLS_SUBJECT_DN:?MOJALOOP_CALLBACK_MTLS_SUBJECT_DN is required}"
: "${MOJALOOP_CLIENT_CA_FILE:?MOJALOOP_CLIENT_CA_FILE must point to the approved provider CA PEM}"

PREPROD_API_DEPLOYMENT="${PREPROD_API_DEPLOYMENT:-ndsep-api}"
PREPROD_API_HEALTH_URL="${PREPROD_API_HEALTH_URL:-https://api-preprod.ndsep.nitda.gov.ng/health}"

[[ -r "$MOJALOOP_CLIENT_CA_FILE" ]] || { echo "CA file is not readable" >&2; exit 1; }
(( ${#MOJALOOP_CALLBACK_HMAC_SECRET} >= 32 )) || { echo "HMAC secret is shorter than 32 characters" >&2; exit 1; }
[[ "$MOJALOOP_CALLBACK_MTLS_SUBJECT_DN" != *CHANGE_ME* ]] || { echo "mTLS subject is a placeholder" >&2; exit 1; }
[[ "$MOJALOOP_CALLBACK_MTLS_SUBJECT_DN" != *example.invalid* ]] || { echo "mTLS subject is not an approved production identity" >&2; exit 1; }

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

current_context="$(kubectl config current-context)"
[[ "$current_context" == "$PREPROD_CONTEXT" ]] || {
  echo "Refusing: current kubectl context '$current_context' != PREPROD_CONTEXT '$PREPROD_CONTEXT'" >&2
  exit 1
}

kubectl auth can-i get deployment/"$PREPROD_API_DEPLOYMENT" -n "$PREPROD_NAMESPACE" >/dev/null
kubectl auth can-i patch deployment/"$PREPROD_API_DEPLOYMENT" -n "$PREPROD_NAMESPACE" >/dev/null
kubectl auth can-i create secret -n "$PREPROD_NAMESPACE" >/dev/null
kubectl auth can-i create ingress -n "$PREPROD_NAMESPACE" >/dev/null
kubectl auth can-i create networkpolicy -n "$PREPROD_NAMESPACE" >/dev/null

printf '%s\n' '== Pre-production target ==' "context=$PREPROD_CONTEXT" "namespace=$PREPROD_NAMESPACE" "deployment=$PREPROD_API_DEPLOYMENT"
printf '%s\n' '== Source checks =='
git -C "$REPO_ROOT" diff --check
pnpm --dir "$REPO_ROOT" exec prettier --check \
  server/financialTransferOutbox.ts server/mojaloopCallback.ts \
  infra/k8s/ingress.yaml infra/k8s/mojaloop-callback-mtls-ingress.yaml \
  infra/k8s/mojaloop-callback-networkpolicy.yaml

printf '%s\n' '== Database connectivity and migration status =='
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT current_database(), current_user, current_setting('server_version');"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT to_regclass('financial_transfer_outbox'), to_regclass('financial_provider_reconciliation'), to_regclass('payment_settlement_events');"

printf '%s\n' '== Kubernetes dry-run manifests =='
kubectl -n "$PREPROD_NAMESPACE" apply --dry-run=server -f "$REPO_ROOT/$MTLS_INGRESS"
kubectl -n "$PREPROD_NAMESPACE" apply --dry-run=server -f "$REPO_ROOT/$MTLS_NETWORK_POLICY"

if [[ "$MODE" == preview ]]; then
  echo "PREVIEW ONLY: no migration, secret, ingress, network-policy, or deployment was changed."
  exit 0
fi

[[ "$CONFIRM" == "PREPROD_FINANCIAL_MTLS" ]] || {
  echo "Refusing apply: pass --confirm PREPROD_FINANCIAL_MTLS" >&2
  exit 1
}

printf '%s\n' '== Backup metadata and migration lock =='
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT 'backup_required_before_apply', clock_timestamp();"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT pg_advisory_lock(hashtext('ndsep:preprod:migration:0117'));"
trap 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_advisory_unlock(hashtext('\''ndsep:preprod:migration:0117'\''));" >/dev/null || true' EXIT

# The repository migration runner is authoritative and records the migration journal.
DATABASE_URL="$DATABASE_URL" pnpm --dir "$REPO_ROOT" db:push

printf '%s\n' '== Applying the mTLS CA secret =='
kubectl -n "$PREPROD_NAMESPACE" create secret generic "$MTLS_CA_SECRET" \
  --from-file=ca.crt="$MOJALOOP_CLIENT_CA_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -

printf '%s\n' '== Applying mTLS ingress and network policy =='
kubectl -n "$PREPROD_NAMESPACE" apply -f "$REPO_ROOT/$MTLS_INGRESS"
kubectl -n "$PREPROD_NAMESPACE" apply -f "$REPO_ROOT/$MTLS_NETWORK_POLICY"

printf '%s\n' '== Restarting API and waiting for readiness =='
kubectl -n "$PREPROD_NAMESPACE" rollout restart deployment/"$PREPROD_API_DEPLOYMENT"
kubectl -n "$PREPROD_NAMESPACE" rollout status deployment/"$PREPROD_API_DEPLOYMENT" --timeout=180s

printf '%s\n' '== Post-deployment checks =='
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT to_regclass('financial_transfer_outbox'), to_regclass('financial_provider_reconciliation'), to_regclass('payment_settlement_events');"
kubectl -n "$PREPROD_NAMESPACE" get ingress,networkpolicy,secret "$MTLS_CA_SECRET"
kubectl -n "$PREPROD_NAMESPACE" describe ingress mojaloop-callback-mtls
curl --fail --silent --show-error --max-time 10 "$PREPROD_API_HEALTH_URL" >/tmp/ndsep-preprod-health.json
cat /tmp/ndsep-preprod-health.json
printf '%s\n' 'APPLY COMPLETE: perform the signed mTLS callback matrix before enabling provider traffic.'
