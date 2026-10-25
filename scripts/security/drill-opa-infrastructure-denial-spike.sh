#!/usr/bin/env bash
#
# NDSEP OPA fail-closed P1 drill
#
# Default mode is a non-mutating plan. Execute mode makes bounded read-only
# HTTPS calls only to a predeployed *isolated staging outage-canary API* that
# has an intentionally unreachable OPA dependency. It never pauses, scales,
# patches, restarts, or deletes shared OPA, APISIX, or NDSEP API resources.
#
# Examples:
#   DRILL_MODE=plan ./scripts/security/drill-opa-infrastructure-denial-spike.sh
#   DRILL_MODE=execute CONFIRM_ISOLATED_OPA_CANARY=YES \
#     DRILL_NAMESPACE=ndsep-staging \
#     DRILL_CANARY_URL=https://opa-outage-canary.staging.ndsep.gov.ng \
#     DRILL_MFA_TOKEN='<short-lived staging token>' \
#     DRILL_PROMETHEUS_URL=https://prometheus.staging.ndsep.gov.ng \
#     ./scripts/security/drill-opa-infrastructure-denial-spike.sh
#
set -euo pipefail

DRILL_MODE="${DRILL_MODE:-plan}"
DRILL_NAMESPACE="${DRILL_NAMESPACE:-ndsep-staging}"
DRILL_CANARY_DEPLOYMENT="${DRILL_CANARY_DEPLOYMENT:-ndsep-api-opa-outage-canary}"
DRILL_CANARY_PATH="${DRILL_CANARY_PATH:-/trpc/securityAudit.getLatest?input=%7B%22json%22%3Anull%7D}"
DRILL_REQUEST_COUNT="${DRILL_REQUEST_COUNT:-10}"
DRILL_OBSERVE_SECONDS="${DRILL_OBSERVE_SECONDS:-150}"

fail() {
  printf 'OPA P1 DRILL FAILED: %s\n' "$*" >&2
  exit 1
}

require() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "${value// }" ]] || fail "${name} is required in execute mode"
}

print_plan() {
  cat <<PLAN
OPA P1 DRILL PLAN (no requests or cluster mutations will be made)

Scope guard:
  namespace: ${DRILL_NAMESPACE}
  isolated deployment: ${DRILL_CANARY_DEPLOYMENT}
  requests: ${DRILL_REQUEST_COUNT} read-only privileged canary queries

Runbook sequence:
  1. Open an exercise ticket and declare this a staging-only authorization-availability drill.
  2. Verify the namespace name contains "staging" and the isolated outage-canary deployment is ready.
  3. Issue ${DRILL_REQUEST_COUNT} requests to the preconfigured outage-canary. Each must return HTTP 403.
  4. Confirm Prometheus observes >= ${DRILL_REQUEST_COUNT} non-normal OPA decision outcomes and the alert rule transitions Pending then Firing after its two-minute hold interval.
  5. Preserve redacted metrics/log evidence. Do not disable OPA or modify the shared policy service.
  6. Run the no-MFA 403 and fresh-MFA 200 staging verification canaries against the normal staging API after the exercise.
  7. Close only after the normal staging API remains healthy and the drill evidence has been attached.

To perform the bounded canary-only drill, set DRILL_MODE=execute and CONFIRM_ISOLATED_OPA_CANARY=YES.
PLAN
}

if [[ "${DRILL_MODE}" == "plan" ]]; then
  print_plan
  exit 0
fi

[[ "${DRILL_MODE}" == "execute" ]] || fail "DRILL_MODE must be plan or execute"
[[ "${CONFIRM_ISOLATED_OPA_CANARY:-}" == "YES" ]] || fail "set CONFIRM_ISOLATED_OPA_CANARY=YES to execute"
[[ "${DRILL_NAMESPACE}" == *staging* ]] || fail "DRILL_NAMESPACE must be a staging namespace"
require DRILL_CANARY_URL
require DRILL_MFA_TOKEN
require DRILL_PROMETHEUS_URL
command -v kubectl >/dev/null 2>&1 || fail "kubectl is required in execute mode"
command -v curl >/dev/null 2>&1 || fail "curl is required in execute mode"

case "${DRILL_CANARY_URL}" in
  https://*staging*) ;;
  *) fail "DRILL_CANARY_URL must be an HTTPS staging hostname" ;;
esac
case "${DRILL_PROMETHEUS_URL}" in
  https://*staging*) ;;
  *) fail "DRILL_PROMETHEUS_URL must be an HTTPS staging hostname" ;;
esac
[[ "${DRILL_REQUEST_COUNT}" =~ ^[1-9][0-9]*$ ]] || fail "DRILL_REQUEST_COUNT must be a positive integer"
[[ "${DRILL_REQUEST_COUNT}" -le 20 ]] || fail "DRILL_REQUEST_COUNT must not exceed 20"

printf 'Checking isolated canary deployment %s in %s...\n' "${DRILL_CANARY_DEPLOYMENT}" "${DRILL_NAMESPACE}"
kubectl -n "${DRILL_NAMESPACE}" get deployment "${DRILL_CANARY_DEPLOYMENT}" >/dev/null
kubectl -n "${DRILL_NAMESPACE}" rollout status "deployment/${DRILL_CANARY_DEPLOYMENT}" --timeout=60s

exercise_id="opa-p1-drill-$(date -u +%Y%m%dT%H%M%SZ)"
canary_url="${DRILL_CANARY_URL%/}${DRILL_CANARY_PATH}"
printf 'Starting bounded outage-canary exercise %s; no shared service will be mutated.\n' "${exercise_id}"

for i in $(seq 1 "${DRILL_REQUEST_COUNT}"); do
  status="$(curl --silent --show-error --output /tmp/ndsep-opa-p1-drill-body --write-out '%{http_code}' --max-time 8 \
    -H "Authorization: Bearer ${DRILL_MFA_TOKEN}" \
    -H "X-Request-ID: ${exercise_id}-${i}" \
    -H 'Accept: application/json' \
    "${canary_url}")" || fail "outage-canary request ${i} could not be completed"
  [[ "${status}" == "403" ]] || fail "outage-canary request ${i} expected HTTP 403, got ${status}"
  grep -Fq 'Policy decision denied or unavailable' /tmp/ndsep-opa-p1-drill-body \
    || fail "outage-canary request ${i} lacked the fail-closed denial envelope"
  printf 'PASS outage-canary request %s/%s: HTTP 403\n' "${i}" "${DRILL_REQUEST_COUNT}"
done
rm -f /tmp/ndsep-opa-p1-drill-body

query='sum(increase(ndsep_opa_decisions_total{outcome=~"unconfigured|unavailable|http_error|malformed|timeout"}[5m]))'
printf 'Waiting %ss for Prometheus scrape/rule evaluation; expected query: %s\n' "${DRILL_OBSERVE_SECONDS}" "${query}"
sleep "${DRILL_OBSERVE_SECONDS}"

metrics_response="$(curl --silent --show-error --fail --get --max-time 8 \
  --data-urlencode "query=${query}" \
  "${DRILL_PROMETHEUS_URL%/}/api/v1/query")" \
  || fail "Prometheus query could not be completed"
printf '%s\n' "${metrics_response}" | grep -Fq '"status":"success"' \
  || fail "Prometheus did not return a successful query response"
printf 'PASS Prometheus query returned successfully; verify the numeric result is >= %s and the alert state is Pending/Firing.\n' "${DRILL_REQUEST_COUNT}"
printf 'DRILL COMPLETE: attach the redacted metrics response, alert timeline, and normal-api canary evidence to %s.\n' "${exercise_id}"
