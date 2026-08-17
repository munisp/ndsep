#!/usr/bin/env bash
set -euo pipefail
environment="$1"; cohort="$2"
: "${PROMETHEUS_URL:?Set Prometheus URL}"
: "${PROMETHEUS_BEARER_TOKEN:?Set short-lived Prometheus token}"
query() { curl -fsS -G "$PROMETHEUS_URL/api/v1/query" -H "Authorization: Bearer $PROMETHEUS_BEARER_TOKEN" --data-urlencode "query=$1"; }
dead_letter_rate=$(query 'sum(rate(idlr_queue_dead_letter_total[15m])) / clamp_min(sum(rate(idlr_queue_replay_total[15m])), 1)' | jq -r '.data.result[0].value[1] // "0"')
oldest_age=$(query 'max(idlr_queue_oldest_age_seconds)' | jq -r '.data.result[0].value[1] // "0"')
integrity_failures=$(query 'increase(idlr_sqlcipher_integrity_failure_total[5m])' | jq -r '.data.result[0].value[1] // "0"')
if awk "BEGIN {exit !($dead_letter_rate > .02 || $oldest_age > 21600 || $integrity_failures > 0)}"; then
  echo "ROLLBACK: dead_letter_rate=$dead_letter_rate oldest_age=$oldest_age integrity_failures=$integrity_failures" >&2
  ./scripts/deploy-replay.sh "$environment" 0
  # Emit an immutable deployment event here and page the release owner via configured notifier.
  exit 1
fi
echo "Rollout gate passed for ${environment} cohort ${cohort}"
