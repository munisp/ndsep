#!/usr/bin/env bash
# Shared helpers for TO-01 through TO-03.
# Required environment is supplied by a protected file outside Git.
set -euo pipefail

: "${DPCO_TEST_API_BASE_URL:?set DPCO_TEST_API_BASE_URL}"
: "${DPCO_TEST_BEARER_TOKEN:?set DPCO_TEST_BEARER_TOKEN}"
: "${DPCO_TEST_DATABASE_URL:?set DPCO_TEST_DATABASE_URL}"
: "${DPCO_TEST_API_RESTART_HOOK:?set DPCO_TEST_API_RESTART_HOOK to an executable hook}"

RESULT_DIR="${DPCO_TEST_RESULT_DIR:-/tmp/ndsep-dpco-timeout-tests}"
mkdir -p "$RESULT_DIR"
chmod 700 "$RESULT_DIR"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "required command missing: $1" >&2; exit 127; }
}

for command in curl psql python3 date; do require_command "$command"; done

new_uuid() {
  cat /proc/sys/kernel/random/uuid
}

restart_api_with_notification_url() {
  local notification_url="$1"
  # The hook is responsible for restarting only the isolated test API process and
  # for applying DPCO_NOTIFICATION_URL. It must not print protected environment values.
  "$DPCO_TEST_API_RESTART_HOOK" "$notification_url"
}

trpc_send_notification() {
  local rule_id="$1"
  local entity_id="$2"
  local idempotency_key="$3"
  local response_file="$4"
  local body_file="${response_file}.request.json"
  python3 - "$rule_id" "$entity_id" "$idempotency_key" >"$body_file" <<'PY'
import json, sys
print(json.dumps({"json": {
    "ruleId": sys.argv[1],
    "entityId": sys.argv[2],
    "idempotencyKey": sys.argv[3],
    "eventData": {"test_run": "timeout-fail-closed"},
}}))
PY

  local started_ms finished_ms elapsed_ms http_status
  started_ms="$(date +%s%3N)"
  http_status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' \
    --max-time 8 \
    --request POST \
    --header "Authorization: Bearer ${DPCO_TEST_BEARER_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data-binary "@$body_file" \
    "${DPCO_TEST_API_BASE_URL%/}/api/trpc/dpco.sendNotification")"
  finished_ms="$(date +%s%3N)"
  elapsed_ms=$((finished_ms - started_ms))
  printf '%s\n' "$http_status" >"${response_file}.status"
  printf '%s\n' "$elapsed_ms" >"${response_file}.elapsed_ms"
}

assert_http_error() {
  local response_file="$1"
  local expected_fragment="$2"
  local status elapsed
  status="$(cat "${response_file}.status")"
  elapsed="$(cat "${response_file}.elapsed_ms")"
  [[ "$status" =~ ^(500|502|503)$ ]] || { echo "expected server error, got HTTP $status" >&2; cat "$response_file" >&2; exit 1; }
  grep -Fq "$expected_fragment" "$response_file" || { echo "expected error fragment not found: $expected_fragment" >&2; cat "$response_file" >&2; exit 1; }
  # The current router uses a five-second outbound timeout. Allow scheduler/HTTP overhead,
  # but fail an unbounded wait.
  (( elapsed <= 6500 )) || { echo "operation exceeded bounded timeout: ${elapsed}ms" >&2; exit 1; }
}

outbox_count_for_key() {
  local tenant_id="$1"
  local key="$2"
  psql "$DPCO_TEST_DATABASE_URL" --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 \
    --set=tenant_id="$tenant_id" --set=idempotency_key="$key" \
    -c "SELECT count(*) FROM dpco_notification_outbox WHERE tenant_id = :'tenant_id' AND idempotency_key = :'idempotency_key'::uuid;" | tr -d '[:space:]'
}

assert_zero_outbox_rows() {
  local tenant_id="$1"
  local key="$2"
  local count
  count="$(outbox_count_for_key "$tenant_id" "$key")"
  [[ "$count" == "0" ]] || { echo "expected zero outbox rows for failed API request, got $count" >&2; exit 1; }
}

write_summary() {
  local name="$1"
  local response_file="$2"
  {
    printf 'case=%s\n' "$name"
    printf 'http_status=%s\n' "$(cat "${response_file}.status")"
    printf 'elapsed_ms=%s\n' "$(cat "${response_file}.elapsed_ms")"
    printf 'response_sha256=%s\n' "$(sha256sum "$response_file" | awk '{print $1}')"
  } >"${response_file}.summary"
}
