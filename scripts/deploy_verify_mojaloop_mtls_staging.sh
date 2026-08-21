#!/usr/bin/env bash
set -euo pipefail

# Preview-first staging deployment for Mojaloop callback mTLS controls.
# No production contexts are accepted. Apply requires an explicit token.

CONTEXT="${STAGING_CONTEXT:-}"
NAMESPACE="${STAGING_NAMESPACE:-ndsep}"
CONFIRM=""
DRY_RUN=1
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INGRESS_FILE="$REPO_ROOT/infra/k8s/mojaloop-callback-mtls-ingress.yaml"
NETWORK_POLICY_FILE="$REPO_ROOT/infra/k8s/mojaloop-callback-networkpolicy.yaml"
INGRESS_NAME="ndsep-mojaloop-callback"
NETWORK_POLICY_NAME="ndsep-api-callback-ingress-only"
API_LABEL="app=ndsep-api"
INGRESS_CONTROLLER_NAMESPACE="${INGRESS_CONTROLLER_NAMESPACE:-ingress-nginx}"
EXPECTED_HOST="${EXPECTED_CALLBACK_HOST:-callbacks.ndsep.nitda.gov.ng}"

usage() {
  cat <<'USAGE'
Usage:
  deploy_verify_mojaloop_mtls_staging.sh --dry-run --context CONTEXT [--namespace NS]
  deploy_verify_mojaloop_mtls_staging.sh --apply --confirm APPLY_MOJALOOP_MTLS_STAGING --context CONTEXT [--namespace NS]

Required apply safeguards:
  STAGING_CONTEXT or --context must be a non-production Kubernetes context.
  The exact confirmation token must be APPLY_MOJALOOP_MTLS_STAGING.

Optional variables:
  INGRESS_CONTROLLER_NAMESPACE=ingress-nginx
  EXPECTED_CALLBACK_HOST=callbacks.ndsep.nitda.gov.ng
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --apply) DRY_RUN=0; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --context) CONTEXT="${2:-}"; shift 2 ;;
    --namespace) NAMESPACE="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 2; }
[[ -n "$CONTEXT" ]] || { echo "staging Kubernetes context is required" >&2; exit 2; }
[[ "$CONTEXT" != "production" && "$CONTEXT" != *prod* ]] || { echo "refusing production-like context: $CONTEXT" >&2; exit 2; }
[[ -s "$INGRESS_FILE" && -s "$NETWORK_POLICY_FILE" ]] || { echo "mTLS manifests are missing" >&2; exit 2; }

K=(kubectl --context "$CONTEXT" --namespace "$NAMESPACE")

printf '%s\n' "== context =="
"${K[@]}" config current-context
"${K[@]}" auth can-i get ingress "$INGRESS_NAME"
"${K[@]}" auth can-i get networkpolicy "$NETWORK_POLICY_NAME"

printf '%s\n' "== client-side manifest validation =="
"${K[@]}" apply --dry-run=client -f "$INGRESS_FILE"
"${K[@]}" apply --dry-run=client -f "$NETWORK_POLICY_FILE"
printf '%s\n' "== server-side manifest validation =="
"${K[@]}" apply --dry-run=server -f "$INGRESS_FILE"
"${K[@]}" apply --dry-run=server -f "$NETWORK_POLICY_FILE"

if ((DRY_RUN)); then
  printf '%s\n' "DRY-RUN PASSED: no Kubernetes resource was changed"
  exit 0
fi

[[ "$CONFIRM" == "APPLY_MOJALOOP_MTLS_STAGING" ]] || {
  echo "exact confirmation token required for apply" >&2
  exit 2
}

printf '%s\n' "== apply =="
"${K[@]}" apply -f "$INGRESS_FILE"
"${K[@]}" apply -f "$NETWORK_POLICY_FILE"

printf '%s\n' "== rollout and object verification =="
"${K[@]}" get ingress "$INGRESS_NAME" -o yaml
"${K[@]}" get networkpolicy "$NETWORK_POLICY_NAME" -o yaml
"${K[@]}" rollout status deployment/ndsep-api --timeout=120s
"${K[@]}" get endpoints ndsep-api -o wide

HOST=$("${K[@]}" get ingress "$INGRESS_NAME" -o jsonpath='{.spec.rules[0].host}')
[[ "$HOST" == "$EXPECTED_HOST" ]] || { echo "unexpected callback host: $HOST" >&2; exit 1; }

SECRET_TYPE=$("${K[@]}" get secret mojaloop-client-ca -o jsonpath='{.type}')
[[ "$SECRET_TYPE" == "Opaque" || "$SECRET_TYPE" == "kubernetes.io/tls" ]] || {
  echo "unexpected mojaloop-client-ca secret type: $SECRET_TYPE" >&2
  exit 1
}

printf '%s\n' "APPLY PASSED: mTLS ingress and callback network policy are present"
printf '%s\n' "NEXT: run scripts/validate_mojaloop_mtls_staging.sh with staging-only certificates and HMAC"
