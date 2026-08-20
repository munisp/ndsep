# IDLR-PTS Enterprise Security Threat Model

**Status:** Target-environment implementation contract. It is not a security certification and does not imply immunity from compromise.  
**Scope:** Public API edge, administrator surfaces, mobile/PWA clients, identity, payments, evidence storage, provider bridges, and operational tooling.

## Security objective

IDLR-PTS must preserve confidentiality, integrity, availability, accountability, and lawful authorization for land, permit, payment, evidence, and stakeholder records. The platform must fail closed whenever a required trust decision, provider identity, policy decision, or cryptographic key is unavailable. “Ready,” “verified,” or “settled” must never be inferred from a simulator, configuration presence, or client-supplied assertion.

## Trust boundaries and threats

| Boundary | Principal threats | Required control outcome |
|---|---|---|
| Internet edge | DDoS, credential stuffing, bot abuse, request smuggling, API enumeration | CDN/L4 protection, Caddy TLS edge, APISIX identity-aware rate limits, bounded request sizes/timeouts, WAF in prevention mode after tuning. |
| Identity plane | Phishing, stolen sessions, weak administrator authentication, role escalation | Keycloak realm isolation, WebAuthn/TOTP step-up MFA, PKCE, short tokens, token audience/issuer checks, session revocation, privileged-action reauthentication. |
| API and policy plane | Broken object authorization, confused deputy, policy bypass, mass data extraction | APISIX OIDC validation, OPA deny-by-default authorization, server-side enterprise-role checks, signed policy bundles, request/audit correlation. |
| Provider and payment plane | Spoofed callbacks, compromised bridge credentials, settlement fraud, replay | Provider mTLS or authenticated endpoints, signature verification, idempotency, independent transaction re-verification, dual control, restricted egress, secrets/KMS. |
| Administrator and insider plane | Excess privilege, malicious configuration changes, evidence tampering, unreviewed bulk action | Least privilege/PBAC, MFA step-up, immutable/tamper-evident audit events, configuration signing, dual approval for high-risk actions, just-in-time access, review alerts. |
| Data and worker plane | Ransomware, exfiltration, data loss, poisoned queues | Encrypted object storage, scoped workload identity, backups/PITR and restore drills, malware scanning, append-only records, dead-letter quarantine, network segmentation. |

## Design principles

The planned edge uses Caddy for TLS termination and controlled reverse proxying, while APISIX owns API-level OIDC enforcement, distributed rate limiting, request validation, and observability. Caddy can serve HTTPS automatically when it has a valid hostname, while APISIX supports shared Redis-backed rate-limiting policies for multi-instance enforcement.[1] [2]

Keycloak is the identity authority, not an optional UI dependency. The target realm requires protected administrator access and MFA/step-up flows. Keycloak supports passkeys, recovery codes, and TOTP/HOTP; production activation must use an approved MFA policy rather than relying on this repository’s emulator.[3]

OPA is the policy decision point for fine-grained authorization. The API gateway and services must deny when OPA is unavailable for protected operations; the OPA administrative API must remain private and policy bundles must be signed and versioned. OPA’s HTTP authorization model is based on the caller sending structured request context to a policy decision endpoint.[4]

## Residual-risk acceptance criteria

No release may claim “bullet proof” security. Before production, the accountable security owner must accept documented residual risk only after independent penetration testing, threat detection tuning, backup restore testing, DDoS exercise evidence, Keycloak MFA enrollment evidence, policy test results, key-custody approval, provider onboarding evidence, and 24/7 incident ownership are recorded. A security control that is present only in a Compose file, Kubernetes manifest, or emulator remains **unactivated** until those target-environment checks are completed.

## References

[1]: https://caddyserver.com/docs/quick-starts/reverse-proxy "Caddy reverse proxy and HTTPS documentation"
[2]: https://apisix.apache.org/docs/apisix/plugins/limit-req/ "Apache APISIX limit-req documentation"
[3]: https://www.keycloak.org/docs/latest/server_admin/ "Keycloak Server Administration Guide"
[4]: https://www.openpolicyagent.org/docs/latest/http-api-authorization/ "Open Policy Agent HTTP API authorization"
