# NDSEP Defense-in-Depth Security Hardening Baseline

**Scope:** External cyber threats, denial-of-service abuse, credential compromise, and insider misuse.
**Security claim:** This baseline materially reduces attack surface and makes privileged operations fail closed. It does **not** make any system “bullet proof.” Production resilience still depends on real deployment validation, patching, incident response, upstream DDoS capacity, and independent security review.

> The control model is layered: public traffic terminates at Caddy; APISIX authenticates and rate-limits; the OpenAppSec attachment inspects requests inline; Keycloak authenticates and enforces MFA enrollment; local PBAC, Permify, and OPA each evaluate authorization; PostgreSQL, audit trails, and observability retain evidence. An attacker or insider must bypass multiple independently configured controls rather than one role check or one gateway rule.

## Implemented controls

| Threat class | Implemented control | Enforcement result |
|---|---|---|
| Internet scanning and direct service exposure | Production Compose removes host-published ports from all services except Caddy on 80/443. A deterministic utility prevents future accidental worker, database, admin, or observability port publication. | Internal services are reachable only over `ndsep-internal`. |
| TLS, browser attacks, proxy header spoofing | Caddy is the sole public edge; HSTS, CSP, anti-framing, MIME protection, strict request-size limits, and replacement of forwarding headers are configured. | Clients cannot reach APISIX or Keycloak administration directly; IP rate keys originate at Caddy. |
| API abuse and DDoS amplification | APISIX exposes only a narrow health route anonymously, requires OIDC bearer tokens on API/tRPC routes, enforces per-client request rate and count limits, limits upstream timeouts, and returns no anonymous catch-all route. | Authentication and 429 limits occur before the application. Volumetric DDoS still requires upstream CDN/WAF/network capacity. |
| Application-layer attacks and bots | OpenAppSec uses the supported APISIX attachment image plus an inline agent sharing IPC, local prevent-mode policy, bounded parser ceilings, anti-bot inspection, and redacted event logging. | Request allow/block decisions are returned inline to APISIX; management-state fallback is not presented as WAF state. |
| Credential theft and brute force | Keycloak realm disables password grant, shortens access/session lifetimes, enables permanent brute-force lockout, requires TOTP enrollment, enables WebAuthn registration, enables PKCE S256, removes wildcard redirects, and removes remote authorization-resource management. | Credentials alone are insufficient for privileged production actions after MFA enrollment. |
| Privileged insider misuse | Admin, approval, deletion, and export procedures require authenticated identity, local PBAC, Permify relationship authorization, and an OPA allow decision. OPA production decisions include a verified MFA signal extracted only from the signed Keycloak token. | Missing/indeterminate OPA, Permify, or MFA decisions deny the request. |
| Token forgery and decode-only trust | `keycloakAuth` session creation now delegates to the cryptographic Keycloak verifier; authorization-code and refresh paths no longer build sessions from decoded payloads. | Algorithm, key ID, RS256 signature, issuer, audience, expiry, and not-before are checked before session use. |
| Insecure deployment defaults | Production Compose requires CORS, Keycloak hostname/admin identity, APISIX key, Grafana credentials, and public host. The environment template lists OPA, Redis, Keycloak issuer, and WAF settings explicitly. | Missing values stop structural deployment rather than silently defaulting to wildcard CORS or default administrators. |
| Observability and evidence | WAF event bodies/headers are not copied into its logs; security controls retain health and denial signals. | Incident evidence is available without intentionally duplicating sensitive request content. |

## Architecture and operational boundaries

The OpenAppSec integration is not a generic HTTP management API. In the documented APISIX Docker deployment, the APISIX attachment and OpenAppSec agent cooperate over a shared IPC namespace; the agent performs inspection and returns an allow/block result to the attachment. The production Compose file follows that model. [1]

The current sandbox cannot prove live edge enforcement because it cannot provide the required production DNS/TLS, real Keycloak realm, OpenAppSec container lifecycle, external DDoS traffic controls, or a bridge-capable FalkorDB CI runner. The local validation proves source, type, policy, and Compose structure only. A production change window must execute the live negative test suite before declaring the controls active.

## Mandatory live negative tests before release

| Test | Expected result |
|---|---|
| Request directly to APISIX/Keycloak admin/worker host port | Network connection refused or unreachable from outside the internal network. |
| API request without bearer token | APISIX denies before application execution. |
| API request over client-specific rate/count budget | APISIX returns 429 and records a gateway metric. |
| Known-safe injection simulation against protected staging route | OpenAppSec policy blocks or records according to the approved prevent-mode policy; event is retained without request body. |
| Keycloak admin/approval/export/delete with password but no completed MFA | OPA denies the action because signed MFA assurance is absent. |
| OPA, Permify, or Redis/Keycloak dependency interruption | Privileged or revoked-session request denies; no operation reaches durable mutation. |
| Cross-tenant resource request by a valid authenticated user | PBAC/Permify deny and audit signal is present. |
| Gateway upstream outage | Gateway returns a controlled failure; Caddy and APISIX do not reveal infrastructure details. |
| High-volume load test | Upstream capacity controls and edge/CDN limits remain within approved SLOs; no overload bypass is accepted. |

## Remaining security gates

1. Place Caddy behind a DDoS-capable upstream provider or national network edge with volumetric scrubbing, connection limits, BGP/anycast protections, and a tested incident contact. Application-layer limits alone cannot absorb a large volumetric attack.
2. Confirm Keycloak token mapping produces a signed `amr` value such as `otp` or `webauthn` after MFA. The OPA policy deliberately denies privileged production requests when this assurance is absent.
3. Execute the OpenAppSec/APISIX attachment integration in staging and retain prevent-mode, false-positive, agent-health, and rollback evidence.
4. Store all production credentials in an approved secrets manager, rotate them, and prohibit container environment dumps in logs/support bundles.
5. Add independent penetration testing, access review, privileged-session monitoring, immutable audit-log retention, and a practiced incident-response exercise. No code change substitutes for these operational controls.

## References

[1] [APISIX + open-appsec: ML-Based WAF Protection](https://apisix.apache.org/blog/2024/10/22/apisix-integrates-with-open-appsec/)
[2] [open-appsec Kubernetes and APISIX deployment guidance](https://docs.openappsec.io/getting-started/start-with-kubernetes)
