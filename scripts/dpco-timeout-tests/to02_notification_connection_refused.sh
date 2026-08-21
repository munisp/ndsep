#!/usr/bin/env bash
# TO-02: Refused DPCO notification upstream connection must fail closed within the five-second request bound.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
: "${DPCO_TEST_TENANT_ID:?set DPCO_TEST_TENANT_ID}"

case_name="TO-02"
key="$(new_uuid)"
response_file="$RESULT_DIR/${case_name}-${key}.json"
# TCP port 9 is deliberately not listened to by the isolated test setup. Override if the host reserves it.
refused_url="${DPCO_TEST_REFUSED_NOTIFICATION_URL:-http://127.0.0.1:9}"

restart_api_with_notification_url "$refused_url"
trpc_send_notification "dpco-licence-expiry-30d" "entity-${key}" "$key" "$response_file"
assert_http_error "$response_file" "DPCO notification service is unavailable"
assert_zero_outbox_rows "$DPCO_TEST_TENANT_ID" "$key"
write_summary "$case_name" "$response_file"

echo "${case_name} PASS: refused upstream failed closed; evidence=${response_file}.summary"
