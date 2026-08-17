# Staging PITR Recovery Drill and Multi-Region KMS Federation

## Staging-only PITR failure drill

> Never run these actions against the production cluster. Use a separately named recovery project/account, an isolated PostgreSQL endpoint, and synthetic or masked staging data.

1. Freeze writes by setting the staging replay cohort to `0`, pausing workers, and recording the chosen recovery target UTC timestamp `T`.
2. Capture evidence: current WAL LSN, migration version, queue/outbox counts, audit-chain head hashes, broker offsets, and KMS key versions.
3. Simulate failure by revoking **only the staging application database role** or stopping the staging database endpoint. Do not corrupt data deliberately.
4. Restore a new, isolated cluster from the latest base backup plus WAL to `T - 60 seconds`; never restore over the failed cluster.
5. Run the schema migration checker in read-only mode, then compare row counts, audit-chain heads, outbox IDs, and replay idempotency keys against the captured evidence.
6. Run `verifyChain` on every affected recovery chain. Reconcile events after `T` from the signed outbox/broker stream using idempotent event IDs; do not re-create ledger events manually.
7. Run the replay/network/KMS drill suite against the restored endpoint. Promote only after security, data owner, and release owner sign the evidence package.
8. Shift a staging canary cohort to the restored endpoint, observe queue age/dead-letter/KMS metrics for one hour, then retire the failed staging cluster only after the exercise report is approved.

### Acceptance thresholds

| Check | Required outcome |
|---|---|
| RPO | Measured against `T`; no unexplained loss outside documented recovery point |
| RTO | Meet the organisation’s approved staging objective; record actual duration |
| Audit integrity | All chain hashes and KMS signatures verify |
| Replay safety | No duplicate side effects; original idempotency keys return original results |
| Recovery | No plaintext DEK or payload leaves device/KMS boundaries |

## Multi-region KMS and workload identity federation

Choose one cloud per environment of record. The examples below use **AWS** terms; use equivalent primitives in another cloud rather than mixing providers.

### 1. Establish KMS topology

Create a multi-Region symmetric encryption key for envelope encryption and a multi-Region asymmetric signing key for audit events in a primary staging region. Replicate both keys to the secondary staging region. Record immutable aliases such as `alias/idlr/staging/recovery-encryption` and `alias/idlr/staging/audit-signing`; application configuration refers only to aliases.

Key policy principles are: deny plaintext `kms:Decrypt` to CI and broker roles; allow `kms:Sign` only to the audit signer; allow `kms:GenerateDataKeyWithoutPlaintext` and re-encryption only to the recovery service; require `kms:ViaService` where possible; enable CloudTrail data events; and use explicit region/account conditions.

### 2. Configure GitHub OIDC federation

Create an IAM OIDC provider for `https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. Create separate roles for staging deployment, recovery service, audit signer, migration, and read-only drill inspection. Each role trust policy must restrict `token.actions.githubusercontent.com:sub` to one repository plus environment/branch, and `aud` to `sts.amazonaws.com`.

```json
{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Principal":{"Federated":"arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},"StringLike":{"token.actions.githubusercontent.com:sub":"repo:munisp/ndsep:environment:staging"}}}]
}
```

The GitHub workflow uses `permissions: { id-token: write, contents: read }` and assumes the narrowly scoped role. It must never receive static AWS keys or a KMS plaintext key.

### 3. Bind regional services

Deploy a recovery API and audit signer in each staging region with their own workload role. Each service gets only the regional replica key ARN and a region-scoped PostgreSQL/broker endpoint. Cross-region failover changes the service endpoint and uses the matching KMS key replica; it must not copy keys or envelopes manually.

### 4. Required environment variables

```dotenv
ENVIRONMENT=staging
AWS_REGION=eu-west-1
KMS_RECOVERY_KEY_ALIAS=alias/idlr/staging/recovery-encryption
KMS_AUDIT_SIGNING_KEY_ALIAS=alias/idlr/staging/audit-signing
KMS_KEY_REPLICA_REGION=eu-central-1
POSTGRES_REPLAY_URL=postgresql://<workload-role-authenticated-endpoint>/idlr_staging
BROKER_AUDIT_TOPIC=idlr.staging.audit.v1
RECOVERY_WEBAUTHN_RP_ID=staging.idlr.example.ng
RECOVERY_WEBAUTHN_ORIGINS=https://staging.idlr.example.ng
```

Do not place passwords, private keys, or KMS key material in these variables. Store provider endpoints and non-secret identifiers in deployment configuration; deliver secrets only through the cloud secret manager with workload-role access and environment-scoped resource policies.

### 5. Federation validation

For each workload role, run an isolated staging test that confirms: its OIDC token can assume only the intended role; it cannot assume a sibling role; it cannot decrypt arbitrary KMS ciphertext; it can perform only its permitted KMS action against the regional alias; CloudTrail contains the assumed-role session; and failover to the secondary region preserves envelope rewrap and audit-sign verification.
