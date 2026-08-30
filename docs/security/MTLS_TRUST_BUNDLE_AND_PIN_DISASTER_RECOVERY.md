# NDSEP mTLS Trust Bundle and SPKI Pin Disaster Recovery & Rotation Procedure

## 1. Purpose, boundary and operating rule

This procedure governs the private PKI material used by the NDSEP evidence publisher, Elastic ingest gateway, SIEM correlation adapter, internal observation endpoint, and CBN supervisory API gateway. It covers normal certificate and issuer rotation, pinset rotation, compromise, loss of trust-distribution service, failed rotation and recovery verification.

> **Operating rule:** No recovery action may downgrade to unauthenticated TLS, a static bearer token, an unpinned public CA, a client-controlled identity header, or a dashboard-originated evidence update. If the cryptographic channel is unavailable, retain the event in the durable outbox and make the supervisory state explicit; do not manufacture a success path.

A trust bundle is the set of CA certificates a workload accepts for a trust domain.[1] The design uses separate private trust domains and an **active-plus-next** SPKI pinset for each mTLS relationship. Key management, compromise recovery and cryptoperiod decisions must be documented in the organization’s key-management plan; NIST SP 800-57 supplies general key-management guidance but does not replace organization-specific approval or regulatory requirements.[2]

## 2. Systems, custody and recovery objectives

| Asset | Source of truth | Custodian | Backup/recovery control | Recovery objective |
|---|---|---|---|---|
| Offline root CA key | HSM/offline ceremony record | PKI security officer + two key custodians | Dual-control, geographically separate encrypted recovery material; no application access. | Reconstitute only under key-compromise/disaster ceremony. |
| Online issuing CA key | HSM/KMS-equivalent with non-exportable key policy | PKI operations | Separate standby issuer under same approved recovery policy; audited issuance log. | Issue replacement workload certificates. |
| Workload leaf/SVID | Workload identity control plane | Platform security | Short-lived and automatically renewable; never restore a copied private key. | Reissue for the same authorized URI SAN. |
| Trust bundle | Signed versioned configuration in protected repository + secret/config distribution | PKI operations | Last known-good bundle and signed digest retained in immutable evidence archive. | Restore trusted issuers, never reinstate a compromised issuer. |
| SPKI pinset | Signed configuration bundle, independently hashed and logged | PKI operations + platform security | Current, next and last-known-good **non-compromised** version stored immutably. | Validate controlled rotation without pin-induced outage. |
| Pinset signing key | HSM/KMS-equivalent, distinct from CA keys | Security architecture | Emergency recovery/key ceremony record. | Sign emergency replacement configuration only after dual control. |
| Issuance, bundle and pinset audit trail | Evidence ledger + immutable object archive + transparency log | Evidence custodian | Hash-verified backup and periodic restore test. | Prove what trust state was in force at a given time. |

### 2.1 Roles and separation of duties

| Role | May do | Must not do alone |
|---|---|---|
| **PKI operations lead** | Initiate normal rotation, issue a pre-approved next issuer/leaf, prepare trust bundle. | Activate root/issuer/pin change without platform and security approval. |
| **Platform security lead** | Validate URI SAN policy, gateway config, workload rollout and telemetry. | Generate/export CA or pinset signing keys. |
| **Evidence custodian** | Record bundle/pin hashes, approvals, timestamps and verification outcome. | Change live certificates, pins or workload authorization. |
| **Incident Commander (IC)** | Declare compromise/outage, authorize incident path and bounded containment. | Unilaterally waive identity/pinning controls. |
| **Two key custodians** | Perform offline-root/recovery ceremony under documented quorum. | Act individually or use production leaf keys. |
| **Change approver** | Approve planned rotation/change window. | Approve their own key-generation or evidence verification. |

## 3. Immutable configuration record

Every trust-bundle and pinset version must be canonicalized, hashed, signed, time-stamped, appended to the evidence ledger and logged before deployment. Required metadata is:

```yaml
apiVersion: ndsep.io/v1
kind: MtlsTrustConfiguration
metadata:
  configurationId: "mtls-[relationship]-[monotonic-version]"
spec:
  relationship: "siem-correlation-adapter_to_internal-observation-gateway"
  trustDomain: "spiffe://ndsep.prod"
  expectedClientUriSans:
    - "spiffe://ndsep.prod/ns/observability/sa/siem-correlation-adapter"
  expectedServerUriSans:
    - "spiffe://ndsep.prod/ns/supervisory/sa/internal-observation-gateway"
  acceptedIssuers:
    - issuerId: "ndsep-runtime-intermediate-2026a"
      caCertificateSha256: "<hex>"
      spkiSha256: "<base64>"
      state: active
      validUntil: "<RFC3339 UTC>"
    - issuerId: "ndsep-runtime-intermediate-2026b"
      caCertificateSha256: "<hex>"
      spkiSha256: "<base64>"
      state: next
      validAfter: "<RFC3339 UTC>"
  rotation:
    overlapEndsAt: "<RFC3339 UTC>"
    lastKnownGoodConfigurationId: "mtls-[relationship]-[prior-version]"
    rollbackAllowed: true
    rollbackProhibitedIssuerIds: []
  approval:
    changeId: "CHG-[id]"
    pkOperationsApprover: "<subject/reference>"
    platformSecurityApprover: "<subject/reference>"
  evidence:
    canonicalSha256: "<hex>"
    configurationSignatureReference: "<restricted DSSE/COSE reference>"
    timestampReference: "<restricted RFC 3161 token reference>"
    transparencyLogReference: "<inclusion/consistency proof reference>"
```

A configuration is eligible for rollout only if its signature, timestamp, approval, `active`/`next` issuer identities, overlap interval and required SANs pass verifier policy. The gateway/publisher emits the `configurationId`, peer certificate serial and peer SPKI hash on every accepted/rejected connection. This makes a future audit able to determine the exact trust configuration used for an event.

## 4. Planned rotation procedure

### 4.1 Pre-rotation gate — T−14 to T−7 days

1. **Open a controlled change** that names the relationship, issuer/pinset version, affected namespaces, rollback owner, maintenance window, leaf-certificate maximum lifetime, and overlap end time. Confirm whether any counterpart has additional bilateral requirements.
2. **Inventory live trust state** from gateway/publisher metrics and evidence records: leaf serials, issuer IDs, URI SANs, pinset version, signature key ID, certificate expiry, CA expiry, and workload rollout coverage. Reconcile it to the immutable configuration record. Any mismatch is an `evidence_gap` and blocks activation.
3. **Generate the next issuing CA key in the approved HSM/KMS-equivalent**, with dual control and a documented key identifier. Do not export the private key. Submit its public certificate/SPKI to the configuration review. For routine leaf rotation, issue a next leaf from the existing issuer rather than copying/reusing the old private key.
4. **Create the active-plus-next signed configuration bundle**. Retain the current active issuer/pin and add the approved next issuer/pin. Do not remove the current issuer/pin during this phase.
5. **Run acceptance tests in an isolated staging environment** with both active and next issuer chains. Validate: correct URI SAN accepts; wrong SAN rejects; inactive/revoked issuer rejects; active and next accepted during overlap; token `cnf.x5t#S256` binding accepts only the matching TLS client certificate; unpinned server fails before HTTP; and an invalid configuration signature is rejected.

### 4.2 Deploy next trust state — T−7 to T−2 days

6. **Sign, time-stamp and transparency-log the approved configuration**. The evidence custodian validates the configuration digest and proof references. Record the decision as an append-only event.
7. **Distribute the active-plus-next trust bundle and pinset** through the approved secret/config distribution system. Deploy first to a canary gateway and canary publisher. Reload dynamically where supported; otherwise rolling-restart only the canary. Never overwrite a configuration file in place without a versioned record.
8. **Verify canary bidirectional mTLS**. Check TLS 1.3 negotiated, peer chain/URI SAN valid, current `configurationId` present in logs, correct SPKI pin, certificate-bound token accepted, and no fall back to an alternative authentication route.
9. **Expand rollout in bounded waves**. Between waves, compare accepted/rejected handshakes, certificate-expiry metrics, publisher outbox depth, gateway HTTP errors, and evidence-verifier results. Stop on unexpected rejects or unexplained outbox growth; retain the existing active issuer/pin.
10. **Issue/renew next workload leaf certificates** only for authorized workload URI SANs. Validate that every new leaf is selected by the intended workload and that no workload still depends on a certificate scheduled to expire before the planned overlap ends.

### 4.3 Activate new issuer/pin — T−2 to T+0

11. **Change issuer states** in a new signed configuration: `next → active`; `active → retiring`. Keep both pins/trust anchors during overlap. The publisher and gateway must accept old/new certificates only while they are both explicitly authorized.
12. **Monitor for one full declared overlap interval**. Reconcile the issuer ID and pinset ID of successful handshakes to expected rollout coverage. Treat a connection to an issuer not in the active/retiring set as a critical security incident.
13. **Prove recovery readiness**: test connection using the new leaf/issuer and simulate one old-leaf request at the scheduled retirement boundary in staging. The expected result is allow during overlap and reject after retirement.

### 4.4 Retire old issuer/pin — only after overlap end

14. Confirm all of the following: every active workload reports new issuer/pin; maximum old-leaf lifetime + clock skew has elapsed; no delayed outbox client still uses old identity; independent verifier confirms new bundle/pinset integrity; and no open incident blocks retirement.
15. Create/sign/log the retirement configuration with the old issuer/SPKI pin removed. `rollbackAllowed` is false for any issuer marked compromised. Roll out by canary and wave as above.
16. Revoke/destroy the retired key according to the approved cryptographic key-management plan. Retain public certificate, bundle/pin metadata, issuance record, revocation record and destruction/retirement attestation—not private key material.
17. Close the change only after the evidence custodian signs an event linking the prior/current configuration IDs, approval, verification tests, retirement proof and final handover.

## 5. Controlled rollback for a failed planned rotation

Rollback is permitted only when **neither** the prior issuer/key nor its pin is suspected of compromise or revocation. It restores the last signed, valid, non-compromised active-plus-next bundle, never an unverified configuration or arbitrary certificate.

| Trigger | Immediate action | Do not do | Exit condition |
|---|---|---|---|
| Next issuer leaf rejected because of incorrect SAN/EKU/chain. | Stop rollout, keep prior active issuer; restore last known-good configuration to affected wave; reissue corrected next leaf. | Remove all trust anchors, disable client-certificate requirement, or use bearer fallback. | Staging validates corrected active-plus-next config; evidence/event record links failed and corrected attempt. |
| New pin causes unexpected connection failures. | Restore last signed **non-compromised** pinset only; hold affected outbox records. | Pin a single emergency leaf or edit pins manually on each host. | Canary accepts expected pinned identity and rejects unauthorized identity. |
| Trust-config distributor is unavailable. | Freeze configuration changes; serve signed cached version within its policy validity; maintain outbox/retry. | Accept expired configuration indefinitely or bypass pin check. | Distributor integrity and signed version restored; cross-check all consuming workloads. |
| Issuer not compromised but activation window missed. | Extend overlap through a newly signed/time-stamped configuration and change approval. | Allow an expired certificate or backdate approval. | Updated overlap record validates and rollout completes. |

## 6. Emergency compromise and disaster recovery

### 6.1 Declare and stabilize — first 15 minutes

1. Acknowledge the alert, open P0/P1 incident and identify the suspected asset: leaf, issuer, root, pinset signing key, trust distributor, gateway, or configuration repository. Preserve network, issuance, gateway, HSM/KMS and configuration access logs.
2. **Freeze issuance and configuration deployment** for the affected trust relationship. Protect logs/evidence store from retention/deletion tasks. Do not turn off TLS verification or Gatekeeper fail-closed policy as a containment shortcut.
3. Evidence custodian records the last known accepted `configurationId`, issuer ID, SPKI pin set, certificate serials, event hashes, times and current outbox depth. Label unverified facts as hypotheses.
4. The IC and PKI operations determine impact: client identities, server identities, authorized URI SANs, affected data stream/gateway, last valid proof of possession and potential cross-trust-domain effect.

### 6.2 Contain — first 60 minutes

| Compromised asset | Containment | Mandatory cryptographic action |
|---|---|---|
| **Leaf client certificate/private key** | Quarantine target workload; disable its identity issuance/registration; revoke token sessions. | Reissue a replacement leaf with the same authorized URI SAN only after workload integrity review; old `x5t`-bound tokens must be rejected. |
| **Leaf server certificate/private key** | Remove affected gateway from traffic; use an already approved healthy replica only if its identity/pin verifies. | Reissue server leaf; update certificate serial revocation and verify correct server SPKI. |
| **Issuing CA key** | Disable issuer immediately; block chains to that issuer at all gateways/publishers; quarantine workloads using it. | Create new intermediate key/issuer under recovery chain; publish emergency active-plus-next configuration with the compromised issuer removed. |
| **Root CA key** | Escalate to root-key recovery ceremony; isolate all dependent trust relationships according to pre-approved scope. | Establish new root/intermediate hierarchy and migrate each relationship; do not reuse the compromised root/pin. |
| **Pinset signing key** | Stop acceptance of newly signed pin configurations from the key; freeze config distribution. | Generate replacement config-signing key through dual control; pre-authorize new verifier trust anchor, then sign a new bundle. |
| **Trust-bundle distributor/config repository** | Disable writes; preserve forensic snapshot and serve only last verified configuration inside validity window. | Rebuild from signed, immutable configuration record; verify digest/signature/time/transparency proof before consumption. |

### 6.3 Recover trust — 1 to 24 hours

5. Generate replacement key(s) in approved HSM/KMS process. For root compromise, convene the documented dual-custodian recovery ceremony; record attendees, quorum, ceremony hash, new public material digest and key IDs. Never reconstruct a private key in an application host.
6. Build a new signed configuration. In a compromise, **do not include the old issuer/pin as `active` or `next`**. The previous trust path is not a rollback candidate. Use a dedicated emergency migration relationship only if it has been pre-approved and independently verified.
7. Update gateway/publisher trust stores by canary, validating each replacement peer’s URI SAN, chain, EKU, SPKI pin, certificate-bound token and policy authorization. Use the durable outbox to retain unsent Elastic projection records. The supervisory API must show `evidence_gap`/service state rather than fabricate delivery status.
8. Reissue leaves to all authorized workload identities. Revoke short-lived tokens tied to old certificates and force fresh token acquisition. Check that current tokens have `cnf.x5t#S256` matching the new client certificate.
9. Move traffic only after independent PKI operations and platform-security verification. Complete a fresh integrity verification for any event whose operational delivery observation occurred during the compromised trust window.

### 6.4 Evidence, notification and closure — 24 hours onward

10. Append signed incident/rotation records linking compromised asset, detection time, containment, superseding trust configuration, certificate serials, pinset IDs, verified tests and residual gaps. Obtain trusted timestamp and append-only transparency proofs.
11. Compliance/counsel decide notification duties based on verified scope and the applicable CBN/legal requirements. Do not claim a CBN report was submitted, received or acknowledged unless a recipient-bound verified receipt exists.
12. Destroy/revoke compromised material, audit the HSM/KMS policy changes, run a post-incident root-cause review, and schedule a repeat staging test. Close only when every affected configuration references a valid successor and all required evidence gaps are resolved or formally tracked.

## 7. Disaster-recovery test schedule and evidence

| Test | Frequency set by owner | Expected proof |
|---|---|---|
| Next issuer/pin canary rotation. | At least before each planned issuer rotation and after trust-distributor change. | Signed test configuration, mTLS logs showing old/new overlap, acceptance/rejection records. |
| Leaf loss/reissue. | Per security test plan. | Quarantine/reissue event, new cert serial, failed old-cert/token attempts. |
| Pin mismatch denial. | Per release environment / staging change. | Connection fails before HTTP, no ledger append, security audit event. |
| Expired config/distributor failure. | Per resilience test plan. | Last valid config handling within allowed lifetime, outbox retention and alert evidence. |
| Issuer compromise tabletop. | At least annually or on major PKI change. | Incident decision log, emergency configuration chain and recovery findings. |
| Restore signed bundle/pin from immutable archive. | Per backup/DR plan. | Hash/signature/timestamp/transparency verification and controlled deploy evidence. |

The evidence custodian signs the DR test closure record only after verifying canonical document hashes, required approvals, configuration and signature key IDs, timestamps, pinset/issuer transitions, test outputs and transparency proofs.

## References

[1] [SPIFFE Concepts](https://spiffe.io/docs/latest/spiffe/concepts/)
[2] [NIST SP 800-57 Part 1: Recommendation for Key Management](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final)
[3] [IETF RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://datatracker.ietf.org/doc/html/rfc8705)
[4] [OWASP: Certificate and Public Key Pinning](https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning)
[5] [NDSEP mTLS pinning and authentication design](mtls-pinning-and-authentication.md)
