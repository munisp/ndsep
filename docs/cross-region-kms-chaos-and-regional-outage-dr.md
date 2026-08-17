# Cross-Region KMS Health, Staging Chaos, and Regional-Outage Recovery

AWS KMS multi-Region keys replicate key material and do not expose a universal per-key replication-lag metric. Monitor the **actual recovery capability** instead: replica `DescribeKey` state, sentinel envelope `ReEncrypt`/`Decrypt` success, operation latency, and KMS invalid-state/denial rates. A stale or unavailable replica must pause recovery/replay; it must not generate substitute keys or retry plaintext handling.

## Metrics and automated remediation

```yaml
groups:
  - name: idlr-kms-replica-health
    rules:
      - record: idlr:kms_replica_sentinel_success:5m
        expr: min_over_time(idlr_kms_replica_sentinel_success[5m])
      - alert: IDLRKMSReplicaUnavailable
        expr: idlr:kms_replica_sentinel_success:5m == 0 or max(idlr_kms_replica_key_enabled) == 0
        for: 5m
        labels: { severity: page, rollback: "true" }
        annotations: { summary: "KMS replica cannot complete staging sentinel envelope re-encryption" }
      - alert: IDLRKMSCrossRegionLatencyHigh
        expr: histogram_quantile(0.95, sum(rate(idlr_kms_reencrypt_duration_seconds_bucket[10m])) by (le,region)) > 2
        for: 10m
        labels: { severity: ticket }
```

The alert webhook should call the rollout controller with `pause_recovery=true` and cohort `0`, annotate the active incident, and page the recovery owner. It must not attempt key creation, key promotion, or envelope re-encryption automatically.

## Staging-only chaos harness

Use a local Toxiproxy sidecar/gateway in an isolated cluster namespace. Do not shape traffic to real production KMS endpoints.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${ALLOW_STAGING_CHAOS:?Must equal yes}"; [[ "$ALLOW_STAGING_CHAOS" == yes ]]
: "${KUBE_CONTEXT:?}"; [[ "$KUBE_CONTEXT" == *staging* ]] || { echo "staging context required" >&2; exit 64; }
: "${TOXIPROXY_URL:?}"; mode="${1:?latency|loss|reset|clear}"
case "$mode" in
 latency) curl -fsS -X POST "$TOXIPROXY_URL/proxies/kms/toxics" -H content-type:application/json -d '{"name":"kms-latency","type":"latency","stream":"downstream","attributes":{"latency":1500,"jitter":250}}' ;;
 loss) curl -fsS -X POST "$TOXIPROXY_URL/proxies/kms/toxics" -H content-type:application/json -d '{"name":"kms-loss","type":"limit_data","stream":"downstream","attributes":{"bytes":1}}' ;;
 reset) curl -fsS -X POST "$TOXIPROXY_URL/proxies/kms/toxics" -H content-type:application/json -d '{"name":"kms-reset","type":"reset_peer","stream":"downstream","attributes":{"timeout":100}}' ;;
 clear) curl -fsS -X DELETE "$TOXIPROXY_URL/proxies/kms/toxics/kms-latency" || true; curl -fsS -X DELETE "$TOXIPROXY_URL/proxies/kms/toxics/kms-loss" || true; curl -fsS -X DELETE "$TOXIPROXY_URL/proxies/kms/toxics/kms-reset" || true ;;
 *) exit 64 ;;
esac
```

Expected assertions are that rewraps time out or fail closed, queue items transition to retry (not replay or dead-letter until retry policy is exhausted), KMS sentinel alerts fire, and the rollout controller pauses replay.

## Regional-outage high-throughput replay drill

1. Preload only synthetic staging queue records across a known range of idempotency keys; capture audit-chain heads and outbox offsets.
2. Route replay workers in primary region to zero replicas and block the primary replay endpoint in the staging ingress layer. Never delete KMS keys or database data.
3. Confirm the regional health controller sets cohort `0`, stops primary leases, and records an incident/recovery audit event.
4. Verify secondary-region KMS sentinel, PostgreSQL replica/PITR recovery endpoint, broker consumer group, workload role, and audit signing key replica are healthy.
5. Promote secondary **only through the approved runbook**. Start one secondary canary worker and run a bounded set of original idempotency keys.
6. Compare submitted/replayed/dead-letter counts, audit-chain heads, broker offsets, and consumer dedupe records. Any duplicate side effect or failed signature aborts the drill.
7. Increase secondary cohort progressively only after all rollback gates pass. Keep primary disabled until region recovery is complete and a reverse-failover drill succeeds.

The drill passes only if every synthetic submission has exactly one durable server result, every audit chain verifies, no plaintext envelope crosses regions, dead-letter reasons are explained, and time objectives are recorded.
