# Dual-Approval Threat Model and Enterprise Attestation Policy

| Threat or bypass vector | Mandatory control | Audit evidence |
|---|---|---|
| One approver impersonates both roles | Require two distinct subjects, roles, WebAuthn credential IDs, and attestation-enrolled devices | Both assertions, subjects, credential IDs, counters |
| Approval replay | Bind canonical digest to authorization ID, queue/payload hash, idempotency key, target device, nonce, and expiry; consume once in a serializable transaction | Authorization state and consumption event |
| Payload substitution | Store SHA-256 payload hash at dead-letter time; compare before rewrap and replay | Hash comparison event |
| Device substitution | Bind target device public-key fingerprint and require device attestation at recovery | Device fingerprint and attestation result |
| Clone or downgraded authenticator | Verify WebAuthn counter monotonicity, FIDO Metadata status, AAGUID policy, UV, and phishing-resistant origin/RP ID | MDS version, AAGUID, counter, origin/RP ID |
| KMS compromise | Disable recovery/replay, revoke envelopes, rotate KEK, require fresh device rewrap and dual recovery approval | KMS/Cloud audit logs and new envelope ID |
| Privileged API bypass | Enforce role, WebAuthn assertion, authorization state, device binding, and payload hash in the same service transaction | Denial/audit event |

## Attestation and metadata policy

The enterprise verifier must fetch the signed FIDO Metadata Service BLOB over a pinned TLS path, validate the BLOB signature against the FIDO Metadata root, retain only current non-revoked entries, and record the BLOB `nextUpdate` version. Registration fails closed if metadata is stale, an authenticator status is compromised/revoked, user verification is absent, or the attestation format is not permitted.

```ts
export const attestationPolicy = {
  rpId: process.env.RECOVERY_WEBAUTHN_RP_ID!,
  origins: process.env.RECOVERY_WEBAUTHN_ORIGINS!.split(","),
  requireUserVerification: true,
  allowedFormats: ["packed", "android-key", "android-safetynet", "apple"],
  allowedAaguids: new Set((process.env.RECOVERY_ALLOWED_AAGUIDS ?? "").split(",").filter(Boolean)),
  minMetadataFreshnessHours: 24,
};

export function enforceEnterpriseAuthenticator(metadata: {aaguid:string; statusReports:{status:string}[]; nextUpdate:Date}, attestation: {fmt:string; userVerified:boolean}) {
  if (!attestation.userVerified) throw new Error("USER_VERIFICATION_REQUIRED");
  if (!attestationPolicy.allowedFormats.includes(attestation.fmt)) throw new Error("ATTESTATION_FORMAT_DENIED");
  if (!attestationPolicy.allowedAaguids.has(metadata.aaguid)) throw new Error("AAGUID_NOT_ENROLLED");
  if (metadata.nextUpdate.getTime() < Date.now()) throw new Error("MDS_STALE");
  if (metadata.statusReports.some(s => ["REVOKED","ATTESTATION_KEY_COMPROMISE","USER_KEY_PHYSICAL_COMPROMISE"].includes(s.status))) throw new Error("AUTHENTICATOR_REVOKED");
}
```

AAGUID allowlists are enterprise enrollment policy, not a substitute for signature verification. They should contain only approved hardware/managed platform authenticator models and be changed via dual-approved configuration with an audit event.
