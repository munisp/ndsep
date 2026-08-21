#!/usr/bin/env bash
# Preview-first deployment of the durable DPCO notification outbox.
# Default mode performs validation only. --apply requires an explicit confirmation.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apply=false
confirm=""
compose_files=("-f" "$root/docker-compose.production.yml" "-f" "$root/compose.dpco-notification-outbox.yml")

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy_dpco_notification_outbox.sh [--apply --confirm ndsep-dpco-notification-outbox]

Required environment variables (inject through the approved secret manager):
  DATABASE_URL                       Staging/production database for Drizzle migration
  DPCO_NOTIFICATION_DATABASE_URL     Outbox service PostgreSQL DSN
  DPCO_NOTIFICATION_PROVIDER_URL     Authoritative notification provider URL
  DPCO_NOTIFICATION_INTERNAL_TOKEN   Shared internal service credential
  POSTGRES_PASSWORD                  Required by docker-compose.production.yml

Default behavior is read-only validation and compose rendering. --apply will run the
existing Drizzle migration runner and then create/update the outbox service. Never use
this script with compose.contract-simulation.yml or test-provider emulator settings.
USAGE
}

while (($#)); do
  case "$1" in
    --apply) apply=true ;;
    --confirm)
      shift
      confirm="${1:-}"
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if "$apply" && [[ "$confirm" != "ndsep-dpco-notification-outbox" ]]; then
  echo 'Refusing write operation: use --apply --confirm ndsep-dpco-notification-outbox' >&2
  exit 64
fi

require_non_placeholder() {
  local name="$1" value="${!1:-}"
  if [[ -z "$value" ]] || grep -Eqi 'change_me|set_from_secret_manager|example\.invalid|localhost|127\.0\.0\.1|placeholder' <<<"$value"; then
    echo "$name must be supplied as a non-placeholder deployment value" >&2
    return 1
  fi
}

for variable in DATABASE_URL DPCO_NOTIFICATION_DATABASE_URL DPCO_NOTIFICATION_PROVIDER_URL DPCO_NOTIFICATION_INTERNAL_TOKEN POSTGRES_PASSWORD; do
  require_non_placeholder "$variable"
done

[[ "${NODE_ENV:-production}" == "production" ]] || {
  echo 'NODE_ENV must be production for this deployment command' >&2
  exit 64
}
[[ "${NDSEP_ALLOW_TEST_PROVIDER_EMULATORS:-false}" != "true" ]] || {
  echo 'Test-provider emulators are forbidden for this deployment command' >&2
  exit 64
}

command -v docker >/dev/null || { echo 'docker is required' >&2; exit 69; }
command -v pnpm >/dev/null || { echo 'pnpm is required' >&2; exit 69; }
command -v psql >/dev/null || { echo 'psql is required for schema assertions' >&2; exit 69; }

printf '%s\n' '== Compose render =='
docker compose "${compose_files[@]}" config --quiet
printf '%s\n' '== Required schema contract =='
grep -E 'CREATE TABLE IF NOT EXISTS dpco_notification_outbox|unique_idempotency|claim_idx' \
  "$root/drizzle/0115_dpco_notification_outbox.sql" >/dev/null

if ! "$apply"; then
  cat <<'PREVIEW'
PREVIEW_ONLY=PASS
No migration or container deployment was performed.
To apply after change approval:
  scripts/deploy_dpco_notification_outbox.sh --apply --confirm ndsep-dpco-notification-outbox
PREVIEW
  exit 0
fi

printf '%s\n' '== Apply Drizzle migrations =='
(
  cd "$root"
  pnpm exec drizzle-kit migrate --config drizzle.config.ts
)

printf '%s\n' '== Assert durable outbox schema =='
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT
    CASE WHEN to_regclass('public.dpco_notification_outbox') IS NOT NULL THEN 'table=present' ELSE 'table=missing' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='dpco_notification_outbox_claim_idx') THEN 'claim_index=present' ELSE 'claim_index=missing' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dpco_notification_outbox_unique_idempotency') THEN 'idempotency_constraint=present' ELSE 'idempotency_constraint=missing' END;
" | tee /tmp/ndsep-dpco-outbox-schema-assertion.txt
grep -Fq 'table=present|claim_index=present|idempotency_constraint=present' /tmp/ndsep-dpco-outbox-schema-assertion.txt || {
  echo 'Durable outbox schema assertion failed' >&2
  exit 1
}

printf '%s\n' '== Deploy and wait for readiness =='
docker compose "${compose_files[@]}" up -d --build dpco-notification-outbox-service
for _ in $(seq 1 30); do
  if docker compose "${compose_files[@]}" ps --format json dpco-notification-outbox-service \
    | grep -Fq 'healthy'; then
    echo 'OUTBOX_DEPLOYMENT=PASS'
    exit 0
  fi
  sleep 2
done

echo 'Outbox service did not become healthy within 60 seconds' >&2
docker compose "${compose_files[@]}" logs --tail=200 dpco-notification-outbox-service >&2 || true
exit 1
