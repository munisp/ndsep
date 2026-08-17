# Production Rollout, Monitoring, and SQLCipher Upgrade Runbook

## Release pipeline

| Gate | Required evidence | Rollback trigger |
|---|---|---|
| Build | Pinned native SQLCipher build, TypeScript, unit tests, secret scan | Build or signature failure |
| Native integration | iOS and Android SQLCipher/keychain/keystore replay tests | Any integrity, idempotency, or recovery test failure |
| Staging migration | PostgreSQL ledger migration + backfill reconciliation | Count/hash mismatch or blocked foreign key |
| Shadow mode | Replay endpoint accepts no writes or feature-flagged canary subjects | Error rate, conflict rate, or KMS denial spike |
| Canary | 1% of enrolled field users, replay and recovery enabled | Dead-letter spike, data integrity alert, P95 latency breach |
| Progressive rollout | 10% → 25% → 50% → 100%, each with acceptance window | Any critical alert or failed recovery drill |

The release pipeline should never deploy KMS recovery and offline replay to all devices at once. Keep independent feature flags for queue creation, replay worker, KMS rewrap, and reviewer dead-letter console.

## Metrics and dashboard configuration

Instrument application metrics with these names and labels:

```text
idlr_queue_depth{operation,state,app_version}
idlr_queue_replay_total{operation,outcome,error_code}
idlr_queue_dead_letter_total{operation,error_code}
idlr_queue_oldest_age_seconds{operation}
idlr_kms_rewrap_total{outcome,reason}
idlr_kms_decrypt_duration_seconds_bucket{operation}
idlr_replay_idempotency_conflict_total{operation}
idlr_sqlcipher_integrity_failure_total{platform,app_version}
```

### Prometheus alert rules

```yaml
groups:
  - name: idlr-offline-replay
    rules:
      - alert: IDLRDeadLetterRateHigh
        expr: sum(rate(idlr_queue_dead_letter_total[15m])) / clamp_min(sum(rate(idlr_queue_replay_total[15m])), 1) > 0.02
        for: 15m
        labels: { severity: page }
        annotations:
          summary: "Offline replay dead-letter rate exceeds 2%"
      - alert: IDLROldQueueBacklog
        expr: max(idlr_queue_oldest_age_seconds) > 21600
        for: 30m
        labels: { severity: ticket }
        annotations:
          summary: "A replay item has been queued longer than six hours"
      - alert: IDLRKMSLatencyHigh
        expr: histogram_quantile(0.95, sum(rate(idlr_kms_decrypt_duration_seconds_bucket[10m])) by (le)) > 1.5
        for: 10m
        labels: { severity: page }
        annotations:
          summary: "KMS decrypt p95 exceeds 1.5 seconds"
      - alert: IDLRSQLCipherIntegrityFailure
        expr: increase(idlr_sqlcipher_integrity_failure_total[5m]) > 0
        labels: { severity: critical }
        annotations:
          summary: "SQLCipher integrity failure detected; pause replay and investigate"
```

### Grafana dashboard panels

```json
{
  "title": "IDLR Offline Replay and KMS",
  "panels": [
    {"title":"Queue depth by state","type":"timeseries","targets":[{"expr":"sum(idlr_queue_depth) by (state)"}]},
    {"title":"Replay success rate","type":"stat","targets":[{"expr":"sum(rate(idlr_queue_replay_total{outcome=\"succeeded\"}[1h])) / clamp_min(sum(rate(idlr_queue_replay_total[1h])), 1)"}]},
    {"title":"Dead letters by code","type":"bargauge","targets":[{"expr":"sum(increase(idlr_queue_dead_letter_total[24h])) by (error_code)"}]},
    {"title":"KMS decrypt p95","type":"timeseries","targets":[{"expr":"histogram_quantile(0.95, sum(rate(idlr_kms_decrypt_duration_seconds_bucket[5m])) by (le))"}]},
    {"title":"Idempotency conflicts","type":"timeseries","targets":[{"expr":"sum(rate(idlr_replay_idempotency_conflict_total[5m]))"}]}
  ]
}
```

## Structured log contract and queries

Every replay/recovery log must include `correlation_id`, hashed `subject_id`, `queue_id`, `operation`, `outcome`, `error_code`, `attempt`, `key_version`, and `app_version`. Never log plaintext payloads, DEKs, document contents, or full device identifiers.

```logql
{service="idlr-replay"} | json | outcome="dead_letter" | stats count() by (error_code, operation)
{service="idlr-recovery"} | json | event="kms_rewrap" | quantile_over_time(0.95, duration_ms[15m])
{service="idlr-replay"} | json | error_code="IDEMPOTENCY_COLLISION" | line_format "{{.correlation_id}} {{.queue_id}} {{.operation}}"
{service="idlr-replay"} | json | outcome="queued" | unwrap queue_age_seconds | quantile_over_time(0.95, queue_age_seconds[1h])
```

## SQLCipher client schema migrations

Maintain a `queue_schema_version` table and execute migrations in a single SQLCipher transaction. Back up the encrypted database file before destructive changes, require `cipher_integrity_check` after every migration, and do not advance the stored app migration version until the integrity check passes.

```ts
type Migration = { version: number; up: (db: CipherDb) => Promise<void> };
const migrations: Migration[] = [
  { version: 1, up: (db) => db.exec(BASE_QUEUE_SCHEMA) },
  { version: 2, up: async (db) => {
      await db.exec("alter table stakeholder_submission_queue add column request_hash text");
      await db.exec("create index if not exists queue_state_due_idx on stakeholder_submission_queue(state, next_attempt_at)");
    } },
];

export async function migrateCipherQueue(db: CipherDb) {
  const version = await db.scalar<number>("select coalesce(max(version), 0) from queue_schema_version");
  for (const migration of migrations.filter((m) => m.version > version)) {
    await db.transaction(async () => {
      await migration.up(db);
      const check = await db.query("pragma cipher_integrity_check");
      if (!check.every((row) => row.cipher_integrity_check === "ok")) throw new Error("CIPHER_MIGRATION_INTEGRITY_FAILED");
      await db.exec("insert into queue_schema_version(version, applied_at) values (?, ?)", [migration.version, new Date().toISOString()]);
    });
  }
}
```

If a migration fails, the app retains the previous encrypted database, stops replay, records a redacted migration failure, and prompts recovery/support. Never drop a queue table or recreate an empty database as an automatic upgrade fallback.
