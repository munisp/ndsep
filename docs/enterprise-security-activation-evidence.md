# Enterprise Security Activation Evidence

The security artifacts in this repository implement layered control contracts; they do not prove that Caddy, APISIX, OpenAppSec, Keycloak, OPA, a CDN, or a SIEM is operating in any environment. A production change record must link each activation to independently reviewable evidence.

| Threat category | Implemented code/artifact | Required activation evidence |
|---|---|---|
| Volumetric and API DDoS | Caddy request-body cap, APISIX shared Redis limiting, APISIX concurrency limits, application fallback rate limiter, PDB and network policy | CDN/WAF contract, rate-limit load test, gateway/Redis failover result, 429/error-budget alert test, DDoS runbook owner. |
| Credential abuse | Keycloak realm security template, OIDC PKCE, account brute-force parameters, short token policy, server MFA claim enforcement for sensitive actions | MFA enrollment result, passkey/TOTP recovery drill, issuer/JWKS/audience validation trace, disabled direct grants, administrator session review. |
| Authorization bypass | OPA deny-by-default policy, APISIX OIDC/OPA plugin contract, server role enforcement, MFA admin wrapper | Signed policy bundle checksum, OPA test output, fail-closed OPA outage test, gateway route review, broken-object-level-authorization penetration test. |
| Insider misuse | Tamper-evident configuration ledger, signed receipt/audit controls, notification history, MFA step-up, receipt dual/bulk safeguards | KMS/HSM audit-key custody, independent ledger verification, privileged-access review, two-person approval records for high-risk changes, SIEM alert delivery. |
| WAF and exploit defense | OpenAppSec attachment contract, Caddy headers, APISIX request controls, bounded parser body sizes | WAF policy export, tuning approval, prevention-mode verification, false-positive review, patched image/SBOM and vulnerability scan report. |

> A configuration value indicating `WAF_ENFORCEMENT=openappsec` or `EDGE_GATEWAY_ENFORCEMENT=apisix` is only a readiness gate. It is **not** evidence that a live gateway, WAF, policy engine, or identity authority has been deployed or tested.

No combination of controls guarantees that a platform is “bullet proof.” The release owner must review residual risk, maintain incident response and recovery capabilities, and retest controls after material changes.
