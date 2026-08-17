# Staging Fault Drills and Progressive Rollback

Run the mock server only in a localhost or isolated staging namespace. The `/__drill/mode` endpoint must not be compiled or reachable in production.

```bash
NODE_ENV=staging pnpm tsx scripts/mock-replay-drill-server.ts
STAGING_DRILL_URL=http://127.0.0.1:4010 STAGING_DRILL_TOKEN=<short-lived-token> \
  ./scripts/run-staging-fault-drill.sh network_partition
```

The recovery and replay test clients should then receive `503 NETWORK_UNAVAILABLE`; verify they reschedule instead of dead-lettering immediately. Repeat with `kms_revoked`, `dead_letter_spike`, and `queue_deadlock`; reset with `healthy`.

The progressive rollout gate queries Prometheus before each cohort. It automatically sets the replay feature cohort to `0` when any of these conditions occurs: dead-letter rate exceeds 2% for the 15-minute window, oldest queued item exceeds six hours, or a SQLCipher integrity failure occurs. This **disables new replay activity**; it does not delete queue data, roll back PostgreSQL ledger events, or destroy KMS envelopes.

For a production rollback, the release controller must also write an immutable deployment audit event, page the designated release owner, preserve dashboard/log links, and require human approval before a later re-enable. A queue deadlock alert should trigger the same pause even if the computed dead-letter rate remains low.
