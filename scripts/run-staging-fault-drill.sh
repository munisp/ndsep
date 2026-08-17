#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_DRILL_URL:?Set STAGING_DRILL_URL to localhost or an isolated staging namespace}"
: "${STAGING_DRILL_TOKEN:?Set a short-lived drill token}"
mode="$1"
case "$mode" in network_partition|kms_revoked|dead_letter_spike|queue_deadlock|healthy) ;; *) echo "invalid mode" >&2; exit 64;; esac
curl --fail-with-body -X POST "$STAGING_DRILL_URL/__drill/mode" \
  -H "Authorization: Bearer $STAGING_DRILL_TOKEN" -H "Content-Type: application/json" \
  --data "{\"mode\":\"$mode\"}"
echo "Injected staging-only fault mode: $mode"
