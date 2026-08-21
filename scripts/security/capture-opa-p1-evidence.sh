#!/usr/bin/env bash
#
# Collects a bounded evidence package for a simulated OPA fail-closed P1 event.
# Default mode prints the capture plan only. Capture mode performs read-only
# Prometheus HTTPS queries and read-only kubectl get/log operations. It never
# changes Kubernetes resources or alters OPA/APISIX policy.
#
# Example:
#   EVIDENCE_MODE=plan ./scripts/security/capture-opa-p1-evidence.sh
#   EVIDENCE_MODE=capture CONFIRM_READ_ONLY_EVIDENCE=YES \
#     EVIDENCE_NAMESPACE=ndsep-staging \
#     EVIDENCE_INCIDENT_ID=opa-p1-drill-20260820T120000Z \
#     EVIDENCE_PROMETHEUS_URL=https://prometheus.staging.ndsep.gov.ng \
#     ./scripts/security/capture-opa-p1-evidence.sh
#
set -euo pipefail
umask 077

EVIDENCE_MODE="${EVIDENCE_MODE:-plan}"
EVIDENCE_NAMESPACE="${EVIDENCE_NAMESPACE:-ndsep-staging}"
EVIDENCE_INCIDENT_ID="${EVIDENCE_INCIDENT_ID:-opa-p1-evidence-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_PROMETHEUS_URL="${EVIDENCE_PROMETHEUS_URL:-}"
EVIDENCE_OUTPUT_ROOT="${EVIDENCE_OUTPUT_ROOT:-./evidence}"
EVIDENCE_SINCE="${EVIDENCE_SINCE:-20m}"
EVIDENCE_LOG_TAIL="${EVIDENCE_LOG_TAIL:-500}"

fail() {
  printf 'OPA P1 EVIDENCE COLLECTION FAILED: %s\n' "$*" >&2
  exit 1
}

require() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "${value// }" ]] || fail "${name} is required in capture mode"
}

redact() {
  # Best-effort log sanitation before an evidence bundle is written. The source
  # services must still perform their own structured PII/token redaction.
  sed -E \
    -e 's/(Bearer)[[:space:]]+[^[:space:]"]+/\1 [REDACTED]/gI' \
    -e 's/("?(authorization|token|access_token|refresh_token)"?[[:space:]]*[:=][[:space:]]*"?)[^",[:space:]]+/\1[REDACTED]/gI' \
    -e 's/(otp|totp|password)[[:space:]]*[:=][[:space:]]*[^[:space:],"]+/\1=[REDACTED]/gI'
}

write_query() {
  local filename="$1"
  local query="$2"
  curl --silent --show-error --fail --get --max-time 10 \
    --data-urlencode "query=${query}" \
    "${EVIDENCE_PROMETHEUS_URL%/}/api/v1/query" \
    >"${EVIDENCE_DIR}/prometheus/${filename}.json"
}

print_plan() {
  cat <<PLAN
OPA P1 EVIDENCE COLLECTION PLAN (no requests or cluster mutations will be made)

Scope guard:
  namespace: ${EVIDENCE_NAMESPACE}
  incident/exercise ID: ${EVIDENCE_INCIDENT_ID}
  output root: ${EVIDENCE_OUTPUT_ROOT}
  log window: ${EVIDENCE_SINCE}; tail cap: ${EVIDENCE_LOG_TAIL}

Capture package:
  - UTC manifest, incident metadata, and collector version
  - Prometheus snapshots: OPA up, API up, alert state, OPA outcomes, duration,
    and APISIX 429 summary
  - Read-only deployment/pod metadata and image digests
  - Bounded canary/API/OPA logs passed through token/OTP/password redaction
  - SHA-256 file manifest for chain-of-custody verification

No raw bearer token, cookie, OTP seed, Secret value, request body, pod exec,
resource mutation, OPA policy change, APISIX config change, or service restart
is part of this collector.
PLAN
}

if [[ "${EVIDENCE_MODE}" == "plan" ]]; then
  print_plan
  exit 0
fi

[[ "${EVIDENCE_MODE}" == "capture" ]] || fail "EVIDENCE_MODE must be plan or capture"
[[ "${CONFIRM_READ_ONLY_EVIDENCE:-}" == "YES" ]] || fail "set CONFIRM_READ_ONLY_EVIDENCE=YES to capture"
[[ "${EVIDENCE_NAMESPACE}" == *staging* ]] || fail "EVIDENCE_NAMESPACE must be a staging namespace"
require EVIDENCE_PROMETHEUS_URL
command -v kubectl >/dev/null 2>&1 || fail "kubectl is required in capture mode"
command -v curl >/dev/null 2>&1 || fail "curl is required in capture mode"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required in capture mode"
case "${EVIDENCE_PROMETHEUS_URL}" in
  https://*staging*) ;;
  *) fail "EVIDENCE_PROMETHEUS_URL must be an HTTPS staging hostname" ;;
esac
[[ "${EVIDENCE_LOG_TAIL}" =~ ^[1-9][0-9]*$ ]] || fail "EVIDENCE_LOG_TAIL must be a positive integer"
[[ "${EVIDENCE_LOG_TAIL}" -le 1000 ]] || fail "EVIDENCE_LOG_TAIL must not exceed 1000"

EVIDENCE_DIR="${EVIDENCE_OUTPUT_ROOT%/}/${EVIDENCE_INCIDENT_ID}"
[[ ! -e "${EVIDENCE_DIR}" ]] || fail "refusing to overwrite existing evidence directory ${EVIDENCE_DIR}"
mkdir -p "${EVIDENCE_DIR}/prometheus" "${EVIDENCE_DIR}/kubernetes" "${EVIDENCE_DIR}/logs"

cat >"${EVIDENCE_DIR}/README.md" <<README
# OPA P1 Evidence Package

- Incident/exercise ID: ${EVIDENCE_INCIDENT_ID}
- Captured at (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Kubernetes namespace: ${EVIDENCE_NAMESPACE}
- Log window: ${EVIDENCE_SINCE}; tail cap: ${EVIDENCE_LOG_TAIL}
- Collector: scripts/security/capture-opa-p1-evidence.sh

This package contains bounded, read-only operational evidence. It must remain in
approved restricted incident storage. Before sharing outside the response team,
review the log files for residual sensitive information despite best-effort
redaction.
README

kubectl config current-context >"${EVIDENCE_DIR}/kubernetes/context.txt"
kubectl -n "${EVIDENCE_NAMESPACE}" get deployment ndsep-api-opa-outage-canary \
  -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"\t"}{.image}{"\n"}{end}' \
  >"${EVIDENCE_DIR}/kubernetes/outage-canary-images.tsv"
kubectl -n "${EVIDENCE_NAMESPACE}" get pods \
  -l app=ndsep-api-opa-outage-canary \
  -o wide >"${EVIDENCE_DIR}/kubernetes/outage-canary-pods.txt"
kubectl -n "${EVIDENCE_NAMESPACE}" get pods \
  -l app=ndsep-api \
  -o wide >"${EVIDENCE_DIR}/kubernetes/normal-api-pods.txt"
kubectl -n "${EVIDENCE_NAMESPACE}" get pods \
  -l app=opa \
  -o wide >"${EVIDENCE_DIR}/kubernetes/opa-pods.txt" || true

write_query 'opa-up' 'up{job="opa"}'
write_query 'normal-api-up' 'up{job="ndsep-api"}'
write_query 'opa-alert-state' 'ALERTS{alertname=~"OPAFailClosedDenialsSpike|OPAPolicyTimeouts|OPAServiceDown"}'
write_query 'opa-outcomes-5m' 'sum by (outcome) (increase(ndsep_opa_decisions_total[5m]))'
write_query 'opa-fail-closed-spike-5m' 'sum(increase(ndsep_opa_decisions_total{outcome=~"unconfigured|unavailable|http_error|malformed|timeout"}[5m]))'
write_query 'opa-mean-decision-duration' 'sum(rate(ndsep_opa_decision_duration_seconds_sum[5m])) / clamp_min(sum(rate(ndsep_opa_decision_duration_seconds_count[5m])), 0.001)'
write_query 'apisix-429-ratio' '100 * sum(rate(apisix_http_status{code="429"}[5m])) / clamp_min(sum(rate(apisix_http_status[5m])), 0.1)'

kubectl -n "${EVIDENCE_NAMESPACE}" logs deployment/ndsep-api-opa-outage-canary \
  --since="${EVIDENCE_SINCE}" --tail="${EVIDENCE_LOG_TAIL}" 2>&1 \
  | redact >"${EVIDENCE_DIR}/logs/outage-canary.log"
kubectl -n "${EVIDENCE_NAMESPACE}" logs -l app=ndsep-api \
  --since="${EVIDENCE_SINCE}" --tail="${EVIDENCE_LOG_TAIL}" --prefix 2>&1 \
  | redact >"${EVIDENCE_DIR}/logs/normal-api.log" || true
kubectl -n "${EVIDENCE_NAMESPACE}" logs -l app=opa \
  --since="${EVIDENCE_SINCE}" --tail="${EVIDENCE_LOG_TAIL}" --prefix 2>&1 \
  | redact >"${EVIDENCE_DIR}/logs/opa.log" || true

(
  cd "${EVIDENCE_DIR}"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS
)
printf 'EVIDENCE PACKAGE READY: %s\n' "${EVIDENCE_DIR}"
printf 'Review, encrypt at rest, and attach only to restricted incident storage.\n'
