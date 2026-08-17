# Rollout Error Budgets and Dual-Approval Replay Authorization

## Recording rules and alert policy

```yaml
groups:
  - name: idlr-rollout-error-budgets
    interval: 30s
    rules:
      - record: idlr:replay_attempt_rate:5m
        expr: sum(rate(idlr_queue_replay_total[5m]))
      - record: idlr:replay_failure_rate:5m
        expr: sum(rate(idlr_queue_replay_total{outcome=~"dead_letter|failed"}[5m])) / clamp_min(idlr:replay_attempt_rate:5m, 1)
      - record: idlr:replay_success_rate:5m
        expr: sum(rate(idlr_queue_replay_total{outcome="succeeded"}[5m])) / clamp_min(idlr:replay_attempt_rate:5m, 1)
      - record: idlr:replay_error_budget_remaining:1h
        expr: clamp_min(1 - (sum(increase(idlr_queue_replay_total{outcome=~"dead_letter|failed"}[1h])) / clamp_min(sum(increase(idlr_queue_replay_total[1h])), 1)) / 0.02, 0)
      - alert: IDLRReplayErrorBudgetExhausted
        expr: idlr:replay_error_budget_remaining:1h == 0
        for: 10m
        labels: { severity: page, rollback: "true" }
        annotations: { summary: "Offline replay 2% hourly failure budget exhausted" }
      - alert: IDLRRolloutCohortDeadlock
        expr: max(idlr_queue_oldest_age_seconds) > 21600 and idlr:replay_success_rate:5m == 0
        for: 30m
        labels: { severity: page, rollback: "true" }
        annotations: { summary: "Rollout cohort queue deadlocked" }
```

## Grafana dashboard JSON

```json
{
  "title": "IDLR Replay Rollout Error Budget",
  "refresh": "30s",
  "time": {"from":"now-6h","to":"now"},
  "templating": {"list":[{"name":"cohort","type":"query","query":"label_values(idlr_replay_feature_cohort,cohort)","includeAll":true}]},
  "panels": [
    {"id":1,"title":"Cohort enabled","type":"stat","targets":[{"expr":"max(idlr_replay_feature_cohort{cohort=~\"$cohort\"})"}]},
    {"id":2,"title":"Error budget remaining (1h)","type":"gauge","targets":[{"expr":"idlr:replay_error_budget_remaining:1h"}],"fieldConfig":{"defaults":{"min":0,"max":1,"thresholds":{"steps":[{"color":"red","value":0},{"color":"orange","value":0.25},{"color":"green","value":0.75}]}}}},
    {"id":3,"title":"Replay outcomes","type":"timeseries","targets":[{"expr":"sum(rate(idlr_queue_replay_total{cohort=~\"$cohort\"}[5m])) by (outcome)"}]},
    {"id":4,"title":"Dead-letter rate","type":"timeseries","targets":[{"expr":"idlr:replay_failure_rate:5m"}],"fieldConfig":{"defaults":{"unit":"percentunit","thresholds":{"steps":[{"color":"green","value":0},{"color":"red","value":0.02}]}}}},
    {"id":5,"title":"Oldest queue age","type":"timeseries","targets":[{"expr":"max(idlr_queue_oldest_age_seconds{cohort=~\"$cohort\"})"}],"fieldConfig":{"defaults":{"unit":"s","thresholds":{"steps":[{"color":"green","value":0},{"color":"red","value":21600}]}}}},
    {"id":6,"title":"Rollback trigger events","type":"table","targets":[{"expr":"sum(increase(idlr_rollout_rollback_total[6h])) by (reason,cohort)"}]}
  ]
}
```

## PostgreSQL authorization model

```sql
create table dead_letter_recovery_authorizations (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null,
  payload_hash char(64) not null,
  idempotency_key uuid not null,
  owner_subject varchar(255) not null,
  target_device_fingerprint char(64) not null,
  nonce bytea not null unique,
  status varchar(32) not null check (status in ('pending','authorized','consumed','expired','denied')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table dead_letter_recovery_approvals (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references dead_letter_recovery_authorizations(id) on delete restrict,
  approver_subject varchar(255) not null,
  approver_role varchar(80) not null,
  credential_id bytea not null,
  webauthn_signature bytea not null,
  signed_digest char(64) not null,
  signed_at timestamptz not null default now(),
  unique(authorization_id, approver_subject)
);
```

Two approvals must be from distinct subjects and roles: `security_engineer` and `planning_supervisor` (or a defined compliance role). Both WebAuthn assertions sign the canonical SHA-256 digest of `authorizationId|queueId|payloadHash|idempotencyKey|deviceFingerprint|expiresAt|nonce`. The server verifies origin, RP ID, challenge, credential ownership, and signature counter before storing an approval.

```ts
async function approveRecovery(tx: PgTx, ctx: EnterpriseContext, input: { authorizationId: string; assertion: WebAuthnAssertion }) {
  assertEnterpriseRole(ctx, ["security_engineer", "planning_supervisor"]);
  const auth = await lockAuthorization(tx, input.authorizationId); // SELECT ... FOR UPDATE
  if (auth.status !== "pending" || auth.expiresAt <= new Date()) throw forbidden("Recovery authorization unavailable");
  const digest = canonicalRecoveryDigest(auth);
  const credential = await loadCredentialForSubject(tx, ctx.subject, input.assertion.credentialId);
  await verifyWebAuthnAssertion({ assertion: input.assertion, credential, expectedChallenge: digest, expectedOrigin: RECOVERY_RP_ORIGIN, expectedRpId: RECOVERY_RP_ID });
  await tx.insert(recoveryApprovals).values({ authorizationId: auth.id, approverSubject: ctx.subject, approverRole: ctx.role, credentialId: credential.id, webauthnSignature: input.assertion.signature, signedDigest: digest });
  const approvals = await tx.select().from(recoveryApprovals).where(eq(recoveryApprovals.authorizationId, auth.id));
  if (hasDistinctRequiredRoles(approvals)) await tx.update(recoveryAuthorizations).set({ status: "authorized" }).where(eq(recoveryAuthorizations.id, auth.id));
}

async function consumeAuthorizedReplay(tx: PgTx, ctx: AuthContext, authorizationId: string, deviceFingerprint: string) {
  const auth = await lockAuthorization(tx, authorizationId);
  if (auth.status !== "authorized" || auth.expiresAt <= new Date() || auth.ownerSubject !== ctx.subject || auth.targetDeviceFingerprint !== deviceFingerprint) throw forbidden("Replay authorization invalid");
  await tx.update(recoveryAuthorizations).set({ status: "consumed", consumedAt: new Date() }).where(eq(recoveryAuthorizations.id, auth.id));
  return auth; // caller replays original idempotency key exactly once
}
```

`consumeAuthorizedReplay` and the idempotent replay insertion must run in the same serializable PostgreSQL transaction. The authorization is consumed before sending success to the device; a retry with the same key returns the original server result, not another side effect.
