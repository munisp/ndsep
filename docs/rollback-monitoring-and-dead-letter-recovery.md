# Rollback Monitoring and Controlled Dead-Letter Recovery

## Prometheus rules for automatic rollback triggers

```yaml
groups:
  - name: idlr-replay-rollback-triggers
    rules:
      - record: idlr:replay_dead_letter_rate_15m
        expr: sum(rate(idlr_queue_dead_letter_total[15m])) / clamp_min(sum(rate(idlr_queue_replay_total[15m])), 1)
      - record: idlr:replay_oldest_queue_age_seconds
        expr: max(idlr_queue_oldest_age_seconds)
      - alert: IDLRReplayDeadLetterRollback
        expr: idlr:replay_dead_letter_rate_15m > 0.02
        for: 15m
        labels: { severity: page, rollback: "true" }
        annotations:
          summary: "Dead-letter rate above 2%; pause progressive replay rollout"
      - alert: IDLRReplayQueueDeadlockRollback
        expr: idlr:replay_oldest_queue_age_seconds > 21600 and sum(rate(idlr_queue_replay_total{outcome="succeeded"}[30m])) == 0
        for: 30m
        labels: { severity: page, rollback: "true" }
        annotations:
          summary: "Replay queue stalled for over six hours with no successful replays"
      - alert: IDLRKMSRevocationSpike
        expr: sum(increase(idlr_kms_rewrap_total{outcome="denied"}[10m])) > 5
        for: 5m
        labels: { severity: critical, rollback: "true" }
        annotations:
          summary: "KMS recovery denials elevated; stop recovery and replay workers"
      - alert: IDLRSQLCipherIntegrityFailure
        expr: increase(idlr_sqlcipher_integrity_failure_total[5m]) > 0
        labels: { severity: critical, rollback: "true" }
        annotations:
          summary: "SQLCipher integrity failure; quarantine affected queue and disable replay"
```

## Grafana dashboard JSON panels

```json
{
  "title": "IDLR Automated Rollback Triggers",
  "refresh": "30s",
  "panels": [
    {"id":1,"title":"Rollback status","type":"stat","targets":[{"expr":"max(idlr_replay_feature_cohort)"}],"thresholds":{"steps":[{"color":"green","value":0},{"color":"red","value":1}]}},
    {"id":2,"title":"Dead-letter rate (15m)","type":"timeseries","targets":[{"expr":"idlr:replay_dead_letter_rate_15m"}],"fieldConfig":{"defaults":{"thresholds":{"steps":[{"color":"green","value":0},{"color":"red","value":0.02}]}}}},
    {"id":3,"title":"Oldest queue age","type":"timeseries","targets":[{"expr":"idlr:replay_oldest_queue_age_seconds"}],"fieldConfig":{"defaults":{"unit":"s","thresholds":{"steps":[{"color":"green","value":0},{"color":"orange","value":14400},{"color":"red","value":21600}]}}}},
    {"id":4,"title":"KMS denials","type":"bargauge","targets":[{"expr":"sum(increase(idlr_kms_rewrap_total{outcome=\"denied\"}[1h])) by (reason)"}]},
    {"id":5,"title":"Dead letters by error code","type":"table","targets":[{"expr":"sum(increase(idlr_queue_dead_letter_total[1h])) by (error_code,operation)"}]},
    {"id":6,"title":"Integrity failures","type":"stat","targets":[{"expr":"sum(increase(idlr_sqlcipher_integrity_failure_total[24h]))"}]}
  ]
}
```

## Controlled recovery after KMS revocation

KMS revocation does not authorize an engineer to extract or manually decrypt a payload. The only safe recovery path is an explicit, dual-control state transition after the KMS access issue is remediated.

1. **Contain:** feature flag disables recovery and replay workers; preserve the dead-letter and KMS audit evidence.
2. **Investigate:** security engineer checks KMS/CloudTrail audit logs, envelope version, issuer/MFA/device attestation, queue payload hash, and whether revocation is intentional or compromise-related. No plaintext is opened.
3. **Approve:** a security engineer and compliance/release approver jointly create a signed recovery authorization scoped to one queue ID, subject, device fingerprint, envelope version, and expiry.
4. **Recover:** user completes fresh MFA on an attested device. Recovery service performs KMS rewrap to that device public key, never returning a plaintext DEK.
5. **Verify:** client opens SQLCipher, runs integrity check, recomputes payload hash, and compares the idempotency key/server request hash.
6. **Replay once:** the reviewer console issues `replay_authorized` state with the dual-approval audit IDs. Device replay uses the original immutable idempotency key. A matching prior server result marks it succeeded; a hash mismatch or integrity failure returns it to dead letter.
7. **Close:** record result, revoke the one-time recovery authorization, preserve all audit events, and only re-enable rollout after rollback gates clear.

### Minimal dead-letter state model

```text
dead_letter → investigation_open → recovery_authorized → recovery_verified → replay_authorized → succeeded
                                  ↘ recovery_denied / integrity_failed → dead_letter
```

The `replay_authorized` state must have a database uniqueness constraint on `(queue_id, recovery_authorization_id)` and expire quickly. Any direct replay call lacking a valid authorization is rejected with `FORBIDDEN`.
