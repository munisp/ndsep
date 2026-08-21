# Post-Incident Review: Mojaloop mTLS Handshake or Certificate-Rotation Failure

## Incident metadata

| Field | Value |
|---|---|
| Incident ID |  |
| Change/rotation ID |  |
| Start/end UTC |  |
| Environment/cluster |  |
| Callback hostname | callbacks.ndsep.nitda.gov.ng |
| Affected provider/CA fingerprint |  |
| Incident commander |  |
| Security lead |  |
| Payment-operations lead |  |
| Severity |  |

## Executive summary

Describe what failed, which control detected it, the customer/provider impact, whether any callback was accepted without the intended mTLS/HMAC controls, and whether any financial transfer entered an ambiguous or quarantined state.

## Impact and safety determination

| Question | Evidence/answer |
|---|---|
| Were any transfers duplicated? |  |
| Were any transfers settled without a valid callback? |  |
| Were any callbacks accepted from an untrusted certificate? |  |
| Were any pseudo-header or forwarded-IP spoof attempts observed? |  |
| Number of callbacks rejected |  |
| Number of transfers quarantined |  |
| Number of dead-letter/manual-review cases |  |
| Provider-side truth confirmed? |  |
| Financial freeze applied? |  |

## Timeline

Record UTC timestamps for certificate issuance, secret-manager update, ingress rollout, first handshake failure, first alert, containment, provider notification, certificate correction, successful canary, and freeze removal.

## Technical evidence

Attach redacted copies of:

| Evidence | Location/hash |
|---|---|
| Ingress and Gateway resource YAML |  |
| NetworkPolicy/AuthorizationPolicy |  |
| Ingress/controller logs |  |
| API callback security logs |  |
| Certificate subject, issuer, validity, and SHA-256 fingerprints |  |
| CA bundle version/fingerprint |  |
| Secret-manager audit events |  |
| Prometheus alert timeline |  |
| Callback event/outbox/quarantine rows |  |
| Provider lookup responses |  |
| HMAC verification results |  |

Never attach private keys, HMAC values, full customer payloads, or unredacted certificate bodies.

## Failure classification

Select all that apply: ☐ missing client certificate; ☐ untrusted CA; ☐ wrong subject/SAN; ☐ expired certificate; ☐ not-yet-valid certificate; ☐ server certificate expiry; ☐ secret propagation delay; ☐ ingress controller reload failure; ☐ mTLS header spoof attempt; ☐ X-Forwarded-For spoof attempt; ☐ invalid HMAC; ☐ provider callback outage; ☐ network-policy denial; ☐ application verifier failure; ☐ certificate rotation procedure failure.

## Root cause and contributing factors

Document the primary technical cause, why monitoring did or did not detect it, why deployment safeguards did or did not stop promotion, whether provider and platform certificate inventories agreed, and whether the incident exposed an undocumented dependency or unsafe fallback.

## Containment and recovery review

Confirm that new funds movement was frozen where required, ambiguous transfers were quarantined rather than retried blindly, provider truth was queried by immutable reference, no direct SQL state edits were used, the last approved certificate/CA version was preserved, and a canary callback passed before normal traffic resumed.

## Corrective actions

| Action | Owner | Priority | Due date | Evidence/PR |
|---|---|---|---|---|
|  |  | P0/P1/P2 |  |  |

## Required regression tests

The closure evidence must include valid certificate/HMAC, missing certificate, wrong/untrusted certificate, expired certificate, wrong subject-DN, missing verified identity, pseudo-header spoof, X-Forwarded-For override, invalid HMAC, duplicate callback event, and callback during certificate rotation. Record exact HTTP/TLS status and log correlation IDs from staging and production canary tests.

## Closure checklist

- [ ] Provider and platform certificate fingerprints reconciled.
- [ ] Certificate validity and rotation owner documented.
- [ ] mTLS ingress is enforcing client verification.
- [ ] Application subject-DN allowlist is present and non-placeholder.
- [ ] Public ingress strips trust headers and forwarded-IP overrides.
- [ ] Network/AuthorizationPolicy permits only the approved gateway identity.
- [ ] HMAC secret remains valid, non-placeholder, and was not exposed.
- [ ] No callback was accepted during the unsafe interval.
- [ ] All affected transfers have authoritative provider disposition.
- [ ] Quarantine/dead-letter counts returned to baseline or have approved manual cases.
- [ ] Alerts and dashboards were updated if detection was inadequate.
- [ ] Staging regression suite passed after the fix.
- [ ] Production canary passed after the fix.
- [ ] Security, payment operations, platform, database, and independent reviewers approved closure.
- [ ] Follow-up actions have owners and due dates.

## Final decision

☐ Closed — no unresolved financial or security impact.  
☐ Monitoring — technical issue corrected; follow-up actions remain.  
☐ Open — unresolved provider truth, financial exposure, or security control gap.

**Approver:**  
**Timestamp UTC:**  
