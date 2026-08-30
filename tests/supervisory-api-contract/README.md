# NDSEP CBN Supervisory API Contract Tests

## Purpose and safety boundary

This package validates the **read-only** CBN supervisory API contract after it is implemented behind the approved staging gateway. It has two layers:

| Layer | Command | Network access | Purpose |
|---|---|---|---|
| Local contract tests | `npm run test:unit` | None. | Validates response-schema shape, fail-closed proof semantics, data minimization, page limit and prohibition of client-supplied scope. |
| Staging integration tests | `npm run test:integration` | Only to the explicit `CBN_TEST_BASE_URL` using mTLS. | Validates all documented read endpoints, mTLS/authorization error behavior, scope concealment, method rejection, verifier failure and optional SSE fixture. |

The tests never call a production endpoint, do not send a body, and never invoke a report-delivery or state-changing endpoint. The configured base URL must resolve to a controlled staging gateway and use non-production certificates, client identity and test records. The suite does not create a CBN submission and does not infer a compliance conclusion from test completion.

## Required staging configuration

Use a protected CI secret store or a short-lived workload identity. Never place a real key, access token, pin, or certificate in `.env`, source control, chat, a test artifact, or the dashboard.

| Variable | Required | Description |
|---|---:|---|
| `RUN_CBN_CONTRACT_TESTS=true` | Yes for network tests. | Explicit opt-in that prevents accidental execution. |
| `CBN_TEST_BASE_URL` | Yes | Approved **HTTPS staging** API origin; for example `https://supervisory-api.staging.internal`. |
| `CBN_TEST_EXPECTED_RELEASE_DIGEST` | Yes | Full `sha256:<64 hex>` candidate image digest. The gateway must return it in `X-NDSEP-Release-Digest` on each tested success response. |
| `CBN_TEST_CA_FILE` | Yes | Absolute path to the non-production private-CA trust bundle. |
| `CBN_TEST_CLIENT_CERT_FILE` | Yes | Absolute path to the approved short-lived test client certificate. |
| `CBN_TEST_CLIENT_KEY_FILE` | Yes | Absolute path to the corresponding private key; mounted read-only at runtime. |
| `CBN_TEST_SERVER_SPKI_PINS` | Yes | Comma-separated base64 SHA-256 SPKI pins for active and next gateway identity. |
| `CBN_TEST_OAUTH_TOKEN` | Yes | Short-lived staging access token bound to `CBN_TEST_CLIENT_CERT_FILE` and scoped `ndsep.supervisory.read`. |
| `CBN_TEST_EVENT_ID_AUTHORIZED` | Yes | Test event inside the test client’s authorized portfolio. |
| `CBN_TEST_EVENT_ID_OUT_OF_SCOPE` | Yes | Existing test event outside the test client’s assigned portfolio. |
| `CBN_TEST_EVENT_ID_INTEGRITY_UNAVAILABLE` | Yes | Special fixture that safely produces a `503` from the verifier path. |
| `CBN_TEST_OAUTH_TOKEN_WRONG_SCOPE` | Yes | Short-lived test token without `ndsep.supervisory.read`; expects `403`. |
| `CBN_TEST_OAUTH_TOKEN_INVALID` | Yes | Expired or intentionally invalid non-production token; expects `401`. |
| `CBN_TEST_BAD_SERVER_SPKI_PINS` | Yes | Deliberately incorrect base64 pins; validates that pin mismatch prevents HTTP request. |
| `CBN_TEST_SSE_SAMPLE_FILE` | Yes | Path to a captured redacted JSON payload of one staging SSE notice; must contain no sensitive material. The protected workflow derives it from `CBN_STAGING_SUPERVISORY_API_SSE_SAMPLE_B64`. |

The OAuth token must be certificate-bound. The gateway validates its `cnf.x5t#S256` value against the client certificate used for the TLS handshake. A bearer token alone is an authentication failure. RFC 8705 specifies this mutual-TLS and certificate-bound token relationship and requires a resource server to reject a certificate/token mismatch.[1]

## Execution sequence

1. Review the target and require an approved staging change. Verify that `CBN_TEST_BASE_URL` is a staging DNS name and that the mounted client certificate belongs to the test workload—not a real CBN user.
2. Deploy the supervisory API backed by the non-production PostgreSQL evidence projection. Seed only redacted fixtures: one event in the caller’s portfolio, one event out of scope, and one verifier-unavailable fixture. Capture one minimized/redacted SSE notice fixture. Seed no raw evidence links, personal data, credentials or actual CBN reports.
3. Deploy the gateway from the exact candidate OCI digest and configure it to return `X-NDSEP-Release-Digest: ${CBN_TEST_EXPECTED_RELEASE_DIGEST}` on supervisory success responses. Configure TLS 1.3, client-certificate requirement, expected URI SAN, private-CA trust bundle, active-plus-next SPKI pins, and certificate-bound access-token validation. See the companion mTLS design.
4. Run local tests first. They do not require any environment variables:

   ```bash
   cd /home/ubuntu/ndsep-supervisory-api-contract-tests
   npm run test:unit
   ```

5. Inject staging-only credential files/variables through the CI secret mount. Do not echo them.
6. Run the integration suite:

   ```bash
   cd /home/ubuntu/ndsep-supervisory-api-contract-tests
   npm run test:integration
   ```

7. Retain only the test report, test target, commit/digest, test start/end time, result, and sanitized request IDs. Place no HTTP body, access token, private key, raw event, CBN report content, or certificate in artifacts.
8. A run with any skipped network test is a failed/incomplete acceptance result. Remove/expire the test token and short-lived test certificate. Review gateway and PostgreSQL audit events to confirm the tests were read-only and portfolio-scoped.

## Required endpoint behavior

| Test | Endpoint / condition | Required result |
|---|---|---|
| Summary | `GET /v1/break-glass/summary` | `200`, request ID, evidence timestamp and exact candidate-digest headers, schema-valid scope-limited counts. |
| List | `GET /v1/break-glass/events?limit=50` | `200`, no more than 100 minimized events and no sensitive fields. |
| Detail | `GET /v1/break-glass/events/{authorizedId}` | `200`, ETag, permitted detail and source-derived evidence status. |
| Integrity | `GET /v1/break-glass/events/{authorizedId}/integrity` | `200`; `verified` only if all six mandatory proof checks pass. |
| No token | Any protected endpoint without token. | `401`, no supervisory payload. |
| Wrong scope | Summary with bound token lacking scope. | `403`, no counts. |
| Outside portfolio | `GET /events/{outOfScopeId}` | `404`, no event/evidence disclosure. |
| Client scope attempt | Query includes `institution_id`, `org_id`, `bank_id` or equivalent. | Client test refuses to issue request; server must also reject an actual attempt and audit it. |
| Write attempt | `POST /v1/break-glass/events` | `405`, no state change. |
| Invalid identifier | `GET /events/not-a-uuid` | `400`, no evidence disclosure. |
| Verifier outage | Integrity endpoint for safe unavailable fixture. | `503`, never a `verified` response. |
| Pin mismatch | Correct CA/client but incorrect SPKI pins. | TLS connection fails before HTTP. |
| SSE notice | Redacted captured fixture. | Only the five minimized fields; client re-fetches detail. |

## CI gate

Run `npm run test:unit` on every pull request that changes the OpenAPI contract, dashboard API, evidence-status logic, RLS query layer, or SIEM mapping. Run `npm run test:integration` only after the staging environment is created from the candidate immutable image digest and the approved, short-lived test identity is injected. The promotion gate must require both suites, plus the existing direct final-digest scan, signature/attestation verification and Gatekeeper policy tests. Every listed negative test is mandatory. A skipped network test is not a successful acceptance result and blocks promotion until the required staging fixture/identity is available.

## Relationship to the OpenAPI contract

The schema validator encodes the response/data-minimization rules from `/home/ubuntu/ndsep-elastic-cbn-integration/api/ndsep-cbn-supervisory-openapi.yaml`. The test source must be changed in the same pull request as any contract change. The authoritative supervisory source remains the PostgreSQL evidence projection; Elastic document delivery is surfaced only as `elasticProjection` correlation state.

## References

[1] [IETF RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://datatracker.ietf.org/doc/html/rfc8705)
[2] [NDSEP mTLS pinning and authentication design](../ndsep-elastic-cbn-integration/security/mtls-pinning-and-authentication.md)
[3] [NDSEP supervisory OpenAPI contract](../ndsep-elastic-cbn-integration/api/ndsep-cbn-supervisory-openapi.yaml)
