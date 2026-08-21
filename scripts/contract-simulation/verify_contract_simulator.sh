#!/usr/bin/env bash
# Verifies the explicit test-only contract simulator. Never pass real identifiers.
set -euo pipefail

: "${NDSEP_CONTRACT_SIMULATOR_URL:=http://127.0.0.1:8346}"
: "${NDSEP_CONTRACT_SIMULATOR_TOKEN:?set a test-only bridge token}"
result_dir="${NDSEP_CONTRACT_SIMULATOR_RESULT_DIR:-/tmp/ndsep-contract-simulator}"
mkdir -p "$result_dir"
chmod 700 "$result_dir"

headers="$result_dir/headers.txt"
health="$result_dir/health.json"
curl --fail --silent --show-error --dump-header "$headers" --output "$health" \
  "${NDSEP_CONTRACT_SIMULATOR_URL%/}/health"
grep -qi '^X-NDSEP-Simulation: true' "$headers"
grep -Fq '"simulation":true' "$health"

identity="$result_dir/identity.json"
identity_headers="$result_dir/identity.headers.txt"
status="$(curl --silent --show-error --output "$identity" --dump-header "$identity_headers" --write-out '%{http_code}' \
  --request POST \
  --header "Authorization: Bearer ${NDSEP_CONTRACT_SIMULATOR_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data '{"id_type":"nin","id_value":"TEST-NIN-NOT-A-REAL-IDENTIFIER","purpose":"contract-test-only"}' \
  "${NDSEP_CONTRACT_SIMULATOR_URL%/}/v1/identity/verify")"
[[ "$status" == "200" ]] || { echo "identity simulator returned HTTP $status" >&2; exit 1; }
grep -qi '^X-NDSEP-Simulation: true' "$identity_headers"
grep -Fq '"simulation":true' "$identity"
grep -Eq '"verified":(true|false)' "$identity"

printf 'simulation_contract=PASS\nhealth_sha256=%s\nidentity_sha256=%s\n' \
  "$(sha256sum "$health" | awk '{print $1}')" \
  "$(sha256sum "$identity" | awk '{print $1}')" \
  > "$result_dir/summary.txt"
cat "$result_dir/summary.txt"
