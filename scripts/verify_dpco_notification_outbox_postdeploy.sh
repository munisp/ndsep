#!/usr/bin/env bash
# Verify a deployed DPCO notification outbox. Default checks are read-only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_files=("-f" "$root/docker-compose.production.yml" "-f" "$root/compose.dpco-notification-outbox.yml")
exercise_mutation=false
confirm=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/verify_dpco_notification_outbox_postdeploy.sh
  scripts/verify_dpco_notification_outbox_postdeploy.sh --exercise-mutation --confirm ndsep-dpco-outbox-test-notification

Default mode is read-only: checks container health and durable outbox schema.
The mutation mode writes an outbox intent and can cause an external notification provider
to deliver a test event. Use it only in an approved staging environment.
USAGE
}

while (($#)); do
  case "$1" in
    --exercise-mutation) exercise_mutation=true ;;
    --confirm) shift; confirm="${1:-}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if "$exercise_mutation" && [[ "$confirm" != "ndsep-dpco-outbox-test-notification" ]]; then
  echo 'Refusing external-delivery test: use --exercise-mutation --confirm ndsep-dpco-outbox-test-notification' >&2
  exit 64
fi

: "${DATABASE_URL:?DATABASE_URL is required for read-only schema assertions}"
command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }
command -v psql >/dev/null || { echo 'psql is required' >&2; exit 69; }

docker compose "${compose_files[@]}" ps --format json dpco-notification-outbox-service \
  | grep -Fq 'healthy' || { echo 'Outbox service is not healthy' >&2; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT status, count(*) FROM dpco_notification_outbox GROUP BY status ORDER BY status;
" | tee /tmp/ndsep-dpco-outbox-status.txt
printf 'OUTBOX_READ_ONLY_VERIFICATION=PASS\n'

if ! "$exercise_mutation"; then
  exit 0
fi

# The process environment is used inside the already-running API container. Do not
# print its internal token. The idempotency key is unique and test-labelled.
docker compose "${compose_files[@]}" exec -T ndsep-api node <<'NODE'
(async () => {
  const crypto = require("node:crypto");
  const token = process.env.DPCO_NOTIFICATION_INTERNAL_TOKEN;
  if (!token) throw new Error("DPCO_NOTIFICATION_INTERNAL_TOKEN is unavailable in ndsep-api");
  const key = crypto.randomUUID();
  const response = await fetch("http://dpco-notification-outbox-service:8340/api/dpco/notifications/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-NDSEP-Internal-Token": token,
      "X-NDSEP-Tenant-ID": "staging-outbox-verification",
      "X-NDSEP-Actor-ID": "release-verifier",
    },
    body: JSON.stringify({
      rule_id: "staging-outbox-contract-check",
      entity_id: key,
      event_data: { test_only: true, source: "postdeploy-verifier" },
    }),
  });
  const payload = await response.json();
  if (response.status !== 202 || !["pending", "processing", "delivered"].includes(payload.status)) {
    throw new Error(`Unexpected outbox response: ${response.status} ${JSON.stringify(payload)}`);
  }
  console.log(`OUTBOX_MUTATION_ACCEPTED status=${payload.status} reused=${payload.reused}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
