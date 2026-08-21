# Dual-Approval Recovery Controller Activation Contract

## Implemented controller boundary

The server now persists recovery authorizations, registered credential metadata, immutable approvals, replay attempts, and append-only hash-chained recovery audit events in PostgreSQL. A recovery authorization binds exactly one queue identifier, payload SHA-256 digest, idempotency key, and device fingerprint. It expires after ten minutes and cannot be altered after creation.

Each approval is verified with `@simplewebauthn/server` against the authorization-specific challenge, configured HTTPS origin, RP ID, stored credential public key, and monotonic authenticator counter. The database rejects duplicate approving subjects and duplicate approval roles. A request reaches `authorized` only after both a **security engineer** and a distinct **planning supervisor** provide fresh user-verified assertions.

The replay step is server-only. It re-encrypts the stored envelope using AWS KMS `ReEncrypt`, preserves the request binding as KMS encryption context, and sends the resulting ciphertext to a single HTTPS, allowlisted replay-worker endpoint using the durable idempotency key. A failed KMS or worker call returns the authorization to `authorized`, records a failure event, and does not mark the request consumed. Only a successful worker response transitions it to `consumed`.

## Required production configuration

| Setting | Purpose | Requirement |
|---|---|---|
| `RECOVERY_AUDIT_POSTGRES_URL` | Isolated durable recovery state | PostgreSQL with the controller migration account permissions. |
| `RECOVERY_WEBAUTHN_ORIGIN` | WebAuthn expected origin | HTTPS only; hostname must equal `RECOVERY_WEBAUTHN_RP_ID`. |
| `RECOVERY_WEBAUTHN_RP_ID` | WebAuthn relying-party ID | Registered with the approver-facing security portal. |
| `RECOVERY_KMS_REGION` and `RECOVERY_KMS_KEY_ID` | Envelope re-encryption destination | Runtime workload identity needs `kms:ReEncrypt` for the approved key. |
| `RECOVERY_REPLAY_URL` | Controlled replay worker | HTTPS only; its hostname must appear in `RECOVERY_REPLAY_ALLOWED_HOSTS`. |
| `RECOVERY_REPLAY_SHARED_SECRET` | Worker authentication | Inject from a secret manager; never expose to the mobile client. |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL` | Keycloak token verification | HTTPS, approved realm/client, and agency claims including recovery roles. |

## Default state and activation evidence

The current default environment intentionally has no Keycloak issuer, KMS key, WebAuthn origin, or replay worker configuration. Recovery status therefore reports **unavailable**; the UI exposes no request, approval, local simulation, or replay bypass. Configuration completeness is intentionally distinct from operational verification: entering settings does not mark a KMS identity or replay worker as live.

Before enabling operational recovery, perform and retain evidence for a staging drill in which two separate enrolled passkeys approve the same device-bound request, KMS re-encrypts the envelope under the destination key, the allowlisted worker receives one idempotent delivery, and the audit chain verifies. A rejected assertion, stale counter, duplicate role, distinct-device mismatch, KMS denial, worker timeout, and duplicate delivery must each remain non-consuming and auditable.
