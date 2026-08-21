#!/usr/bin/env bash
set -euo pipefail

# Read-only PostgreSQL -> Prometheus textfile exporter.
# The node-exporter textfile collector should scrape the output directory.
: "${DATABASE_URL:?DATABASE_URL is required}"
OUTPUT_FILE="${OUTPUT_FILE:-/var/lib/node_exporter/textfile_collector/ndsep_financial_outbox.prom}"
TMP_FILE="${OUTPUT_FILE}.$$"
mkdir -p "$(dirname "$OUTPUT_FILE")"
trap 'rm -f "$TMP_FILE"' EXIT

read -r reconciliation dead_letter stale_leases oldest_seconds provider_conflicts lookup_failures < <(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    WITH counts AS (
      SELECT
        count(*) FILTER (WHERE state = 'reconciliation_required')::bigint AS reconciliation,
        count(*) FILTER (WHERE state = 'dead_letter')::bigint AS dead_letter,
        count(*) FILTER (
          WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
        )::bigint AS stale_leases,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN(updated_at) FILTER (WHERE state IN ('reconciliation_required','dead_letter')))),
          0
        )::bigint AS oldest_seconds
      FROM financial_transfer_outbox
    ), conflicts AS (
      SELECT count(*)::bigint AS provider_conflicts
      FROM (
        SELECT transfer_reference
        FROM financial_provider_reconciliation
        GROUP BY transfer_reference
        HAVING bool_or(observed_state = 'committed') AND bool_or(observed_state = 'aborted')
      ) conflicting
    ), failures AS (
      SELECT count(*) FILTER (WHERE action = 'lookup_failed' AND created_at >= NOW() - INTERVAL '5 minutes')::bigint
      FROM financial_provider_reconciliation
    )
    SELECT reconciliation, dead_letter, stale_leases, oldest_seconds,
           (SELECT provider_conflicts FROM conflicts),
           (SELECT count FROM failures)
    FROM counts;"
)

cat > "$TMP_FILE" <<EOF
# HELP ndsep_financial_outbox_reconciliation_required Financial intents awaiting authoritative provider reconciliation.
# TYPE ndsep_financial_outbox_reconciliation_required gauge
ndsep_financial_outbox_reconciliation_required ${reconciliation}
# HELP ndsep_financial_outbox_dead_letter Financial intents requiring manual review.
# TYPE ndsep_financial_outbox_dead_letter gauge
ndsep_financial_outbox_dead_letter ${dead_letter}
# HELP ndsep_financial_outbox_stale_leases Leased financial intents past their lease expiry.
# TYPE ndsep_financial_outbox_stale_leases gauge
ndsep_financial_outbox_stale_leases ${stale_leases}
# HELP ndsep_financial_outbox_oldest_reconciliation_seconds Age of the oldest quarantined financial intent.
# TYPE ndsep_financial_outbox_oldest_reconciliation_seconds gauge
ndsep_financial_outbox_oldest_reconciliation_seconds ${oldest_seconds}
# HELP ndsep_financial_provider_conflict_total Transfers with conflicting authoritative provider observations.
# TYPE ndsep_financial_provider_conflict_total gauge
ndsep_financial_provider_conflict_total ${provider_conflicts}
# HELP ndsep_financial_reconciliation_lookup_failure_total Provider lookup failures observed in the last five minutes.
# TYPE ndsep_financial_reconciliation_lookup_failure_total gauge
ndsep_financial_reconciliation_lookup_failure_total ${lookup_failures}
EOF
chmod 0644 "$TMP_FILE"
mv -f "$TMP_FILE" "$OUTPUT_FILE"
trap - EXIT
