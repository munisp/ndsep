# Staging Recovery Drill and Workload Identity

## Staging recovery drill

1. Confirm the PostgreSQL review ledger migration, a KMS recovery key, private envelope store, monitoring, and a test stakeholder/device enrollment exist in staging.
2. Queue a profile and document while the device is offline. Record queue ID, server request hash, and current KMS key version; do not record plaintext payloads.
3. Enable network, confirm one idempotent replay, then enqueue a second record and simulate SecureStore invalidation.
4. Confirm replay stops with `RECOVERY_REQUIRED`; verify no request reached the replay endpoint.
5. Authenticate with a fresh MFA session on a second attested test device. Request KMS rewrap and confirm an audit record is created.
6. Open the SQLCipher queue, run `cipher_integrity_check`, replay the queued record, and confirm one PostgreSQL ledger event and no duplicate idempotency entry.
7. Simulate corrupted ciphertext and confirm `PAYLOAD_INTEGRITY_FAILED`, a dead-letter record, zero outbound calls, and a dashboard alert.
8. Revoke the test device and verify the recovery API denies a new rewrap. Capture logs, metrics, KMS audit evidence, and user-facing state before closing the drill.

Any missing audit record, duplicate ledger event, successful replay after corruption, or recovery without MFA is a failed drill and blocks rollout.

## AWS workload identity example

Create an IAM OIDC provider for `token.actions.githubusercontent.com`. The staging/production deploy roles trust only the `munisp/ndsep` repository, `production` branch, and the named GitHub environment. Do not use long-lived AWS keys.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
      "StringLike": {"token.actions.githubusercontent.com:sub": "repo:munisp/ndsep:environment:production"}
    }
  }]
}
```

Split identities: **deploy role** may deploy/flip feature flags but cannot decrypt KMS envelopes; **recovery service role** may use only the specific KMS key and envelope prefix; **migration role** may alter only the review-ledger schema; and **application role** has CRUD only on required PostgreSQL tables. Enable CloudTrail/KMS audit logging and deny all wildcard KMS decrypt permissions.

## Secret configuration

Use environment variables only for identifiers and endpoints. Retrieve secrets at runtime through workload identity and a secret manager.

| Variable | Staging | Production |
|---|---|---|
| `POSTGRES_REVIEW_LEDGER_URL_SECRET_ID` | staging secret reference | production secret reference |
| `KMS_PROVIDER` | `aws-kms` | `aws-kms` |
| `KMS_KEY_ID` | staging KMS ARN | production KMS ARN |
| `RECOVERY_ENVELOPE_STORE` | private staging bucket URI | private production bucket URI |
| `RECOVERY_OIDC_ISSUER` | staging issuer | production issuer |
| `RECOVERY_OIDC_AUDIENCE` | staging recovery audience | production recovery audience |
| `RECOVERY_REQUIRE_MFA` | `true` | `true` |
| `REPLAY_FEATURE_FLAG` | `shadow` | cohort percentage controlled |

Never expose plaintext database URLs, KMS keys, provider webhooks, or recovery envelopes to GitHub Actions logs, mobile clients, or application environment files.

## Native validation

Use signed custom iOS/Android development builds containing SQLCipher. Validate enqueue, offline replay, SecureStore invalidation, KMS rewrap, cipher integrity, corrupted payload quarantine, idempotency collision, and device revocation on real iOS and Android devices. Expo Go and PWA preview do not validate native SQLCipher, Keychain, Keystore, or background replay behavior.
