# Production Provider Onboarding

## Default deployment posture

The current default deployment is intentionally **fail closed**. No external identity, document-intelligence, liveness, land-registry, OIDC, or managed-signing provider is assumed to exist. Each provider health record therefore reports `unavailable` until its endpoint and credentials are supplied. The application must not represent this state as a verification result.

| Capability | Default status | Live behavior before onboarding |
|---|---|---|
| Docling document conversion | Unavailable | Document screening can use the existing model-assisted review path only; no Docling claim is displayed. |
| Liveness | Unavailable | A selfie may be screened as assistive-only, but it cannot verify a blink-turn-smile challenge or identity. |
| NIN verification | Unavailable | No NIN claim is checked against NIMC. |
| CAC verification | Unavailable | No CAC claim is checked against CAC VAS or an authorized bridge. |
| State title verification | Unavailable | No parcel or title reference is checked against an official state registry. |
| Enterprise authorization | Unavailable | Trust-sensitive API actions reject the request unless an enterprise principal is present. |
| Managed audit signing | Unavailable | Audit exports remain unsigned; no transient key is generated. |

## Required provider onboarding

### Enterprise OIDC

Configure a Keycloak, Authentik, or equivalent OpenID Connect issuer that emits an `agency_id` claim and an `agency_roles` claim. The supported role values are `applicant`, `mining_reviewer`, `petroleum_reviewer`, `environment_reviewer`, and `planning_supervisor`. Set `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL`; retain local enterprise access only for explicitly marked development environments.

### Document intelligence

Deploy Docling Serve on protected persistent compute. Docling documents its `POST /v1/convert/source` endpoint with base64 file sources, OCR controls, and an optional `X-Api-Key` control.[1] Configure `DOCLING_SERVICE_URL` and, if enabled, `DOCLING_SERVICE_API_KEY`. The deployment should restrict network access, impose document-size and timeout limits, retain audit logs, and define data-retention policies before personal documents are processed.

### Liveness and KYC

The included live adapter supports Dojah’s documented image liveness endpoint when `DOJAH_APP_ID` and `DOJAH_SECRET_KEY` are configured.[2] Its result is recorded as provider-backed liveness evidence, not a completed identity verification. A true active-video challenge should be implemented using the selected provider’s approved SDK and callback workflow; Smile ID, for example, documents asynchronous verification requests that complete through a callback carrying status, message, and reason.[3]

### NIN, CAC, and land-title verification

NIMC documents NVS as a VPN-protected SOAP service requiring approved access and credentials.[4] CAC VAS documents business validation services, while the NIBSS/CAC collaboration describes selected-super-agent access to CAC data.[5] [6] Do not place guessed public endpoints in the application. Instead, deploy a controlled internal bridge for each authority, normalize its result into `verified`, `not_verified`, or `requires_review`, and configure the corresponding URL/token pair:

| Authority | Configuration | Bridge responsibility |
|---|---|---|
| NIMC NVS | `NIMC_NVS_BRIDGE_URL`, `NIMC_NVS_BRIDGE_TOKEN` | VPN/SOAP protocol isolation, consent checks, NIN result normalization, audit reference. |
| CAC VAS / authorized CAC bridge | `CAC_VAS_BRIDGE_URL`, `CAC_VAS_BRIDGE_TOKEN` | RC lookup/validation, result normalization, data minimization, audit reference. |
| State land registry | `STATE_REGISTRY_BRIDGE_URL`, `STATE_REGISTRY_BRIDGE_TOKEN` | State-specific authorization, title-reference lookup, provenance, and uncertainty reporting. |

### Managed audit signing

For deployment, set `AUDIT_SIGNING_MODE=service`, `AUDIT_SIGNING_SERVICE_URL`, `AUDIT_SIGNING_SERVICE_TOKEN`, `AUDIT_PUBLIC_KEY`, and `AUDIT_PUBLIC_KEY_ID`. The managed service must expose `POST /v1/signatures`, accept the SHA-256 digest plus key ID, and return a base64 RSA-SHA256 signature. Keep private signing keys in the selected HSM/KMS; the application must never generate or persist substitute private keys.

## References

[1]: https://docling-project.github.io/docling/usage/api_server/ "Docling API Server"
[2]: https://docs.dojah.io/docs/biometrics/liveness-check "Dojah Liveness Check API"
[3]: https://docs.usesmileid.com/ "Smile ID Overview"
[4]: https://nimc.gov.ng/nimc-verification-service-api "NIMC Verification Service API"
[5]: https://vas.cac.gov.ng/ "CAC VAS API Integrated Service"
[6]: https://nibss-plc.com.ng/nibss-and-cac-launch-api-integration-platform-to-streamline-business-services-and-enhance-data-verification/ "NIBSS and CAC API Integration Platform"
