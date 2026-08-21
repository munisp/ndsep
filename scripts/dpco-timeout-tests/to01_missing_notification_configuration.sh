#!/usr/bin/env bash
# TO-01: Missing DPCO_NOTIFICATION_URL must fail closed before any delivery intent is created.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
: "${DPCO_TEST_TENANT_ID:?set DPCO_TEST_TENANT_ID}"

case_name="TO-01"
key="$(new_uuid)"
response_file="$RESULT_DIR/${case_name}-${key}.json"

# The restart hook must unset DPCO_NOTIFICATION_URL in the API process when passed __UNSET__.
restart_api_with_notification_url "__UNSET__"
trpc_send_notification "dpco-licence-expiry-30d" "entity-${key}" "$key" "$response_file"
assert_http_error "$response_file" "DPCO notification service is not configured"
assert_zero_outbox_rows "$DPCO_TEST_TENANT_ID" "$key"
write_summary "$case_name" "$response_file"

echo "${case_name} PASS: missing notification configuration failed closed; evidence=${response_file}.summary"
