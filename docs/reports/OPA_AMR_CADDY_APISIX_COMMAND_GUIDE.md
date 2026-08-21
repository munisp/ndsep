# Staging Command Guide: OPA Fail-Closed, Keycloak AMR, and Caddy/APISIX Client IP

**Applies to:** approved staging only.
**Repository baseline:** OPA client `server/security/opa.ts`, Keycloak realm `orchestration/keycloak/ndsep-realm.json`, Caddy edge `infra/caddy/Caddyfile`, and APISIX routes `config/apisix.yaml`.

> **Do not run these commands against production.** Use dedicated accounts (`ndsep-opa-nomfa`, `ndsep-opa-mfa`), a read-only canary query, a controlled staging window, and an incident contact. Do not print access tokens, Keycloak admin passwords, OPA tokens, or OTP seeds to CI logs or tickets.

## 1. One-time staging variables

Run from a controlled workstation that can access the staging public edge. The `securityAudit.getLatest` query is intentionally selected because it is `adminProcedure`-protected but read-only; its input is `null`.[1]

```bash
set -euo pipefail

export STAGING_APP_HOST='https://staging.ndsep.nitda.gov.ng'
export STAGING_SSO_HOST='https://sso.staging.ndsep.nitda.gov.ng'
export KC_REALM='ndsep'
export KC_CLIENT_ID='ndsep-platform'

# This must be a freshly issued *password-only* bearer token for the dedicated
# administrator-role test user. Obtain it through the normal authorization-code
# + PKCE flow; direct/password grants are deliberately disabled.
export NO_MFA_ACCESS_TOKEN='REDACTED_FRESH_PASSWORD_ONLY_TOKEN'

# A separate fresh TOTP/WebAuthn token is used only for the later OPA positive
# control—not for the three negative tests below.
export MFA_ACCESS_TOKEN='REDACTED_FRESH_MFA_TOKEN'

# Stable, read-only admin-procedure canary. tRPC v10 encodes a void input as
# {"json":null}; do not substitute a mutation or a customer data export.
export OPA_CANARY_PATH='/trpc/securityAudit.getLatest?input=%7B%22json%22%3Anull%7D'
```

Before testing, create a baseline record with a UTC timestamp and a request ID. The remote API should deny a valid password-only administrative caller at OPA; an unrelated 401 or 404 means earlier edge/authentication routing failed and does **not** prove OPA.

```bash
export TEST_ID="opa-$(date -u +%Y%m%dT%H%M%SZ)"
export CURL_COMMON=(
  --silent --show-error --include --max-time 8
  -H "Authorization: Bearer ${NO_MFA_ACCESS_TOKEN}"
  -H "X-Request-ID: ${TEST_ID}"
)
```

## 2. OPA-01 — password-only privileged user is denied

The Keycloak user must be `admin` (or pass the prior PBAC/Permify gates for the selected route) yet have a **fresh password-only session**. The signed access token must not have an accepted AMR value: `mfa`, `otp`, `webauthn`, `hwk`, or `fido2`. The expected response is HTTP `403` with `Policy decision denied or unavailable`; this shows that the request reached the privileged procedure and OPA denied the `mfaVerified=false` context.[1]

```bash
set +e
opa01_response="$({ curl "${CURL_COMMON[@]}" \
  -o /tmp/ndsep-opa01.body \
  -w '%{http_code}' \
  "${STAGING_APP_HOST}${OPA_CANARY_PATH}"; } 2>/tmp/ndsep-opa01.curl.err)"
opa01_status=$?
set -e

printf 'OPA-01 curl exit=%s HTTP=%s request_id=%s\n' "$opa01_status" "$opa01_response" "$TEST_ID"
test "$opa01_status" -eq 0
test "$opa01_response" = '403'
grep -Fq 'Policy decision denied or unavailable' /tmp/ndsep-opa01.body
```

Expected body example:

```json
{
  "error": {
    "json": {
      "message": "Policy decision denied or unavailable",
      "code": -32003,
      "data": { "code": "FORBIDDEN", "httpStatus": 403 }
    }
  }
}
```

Your tRPC error envelope may contain additional correlation metadata. Preserve it, but never attach the bearer token. A `200`, `201`, `202`, or any mutation/audit side effect is a P0 failure. A `401` means the token did not pass APISIX or NDSEP authentication and must be corrected before OPA-01 is accepted as evidence.

### OPA-01 policy-unit payload

From an **internal** staging administration pod only, query the deployed OPA bundle directly. This proves policy evaluation; it does not replace the public-edge call above.

```bash
export OPA_URL='http://opa:8181'
export OPA_DECISION_PATH='/v1/data/ndsep/authz/allow'
# Set only if the staging OPA deployment has a token; do not echo it.
export OPA_TEST_TOKEN='REDACTED_IF_CONFIGURED'

curl --silent --show-error --fail-with-body --max-time 2 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${OPA_TEST_TOKEN}" \
  --data '{
    "input": {
      "subject": {"id":"ndsep-opa-nomfa","role":"admin","authenticated":true},
      "action":"admin",
      "resource":"securityAudit.getLatest",
      "context": {
        "environment":"production",
        "mfaVerified":false,
        "requestId":"opa-01-policy-unit",
        "sourceIp":"198.51.100.10",
        "method":"GET"
      }
    }
  }' \
  "${OPA_URL}${OPA_DECISION_PATH}"
```

Expected policy response:

```json
{"result":false}
```

## 3. OPA-02 — explicit policy denial payload

OPA-02 uses the same payload shape but proves the policy itself rejects every privileged verb if MFA is false. Run it only in the temporary test bundle/namespace or against the deployed bundle with the non-mutating data API.

```bash
for action in admin approve delete export; do
  printf 'Testing action=%s\n' "$action"
  curl --silent --show-error --fail-with-body --max-time 2 \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${OPA_TEST_TOKEN}" \
    --data "$(cat <<JSON
{"input":{"subject":{"id":"ndsep-opa-nomfa","role":"admin","authenticated":true},"action":"${action}","resource":"staging.opa.canary","context":{"environment":"production","mfaVerified":false,"requestId":"opa-02-${action}"}}}
JSON
)" \
    "${OPA_URL}${OPA_DECISION_PATH}"
done
```

Each response must be exactly a boolean deny:

```json
{"result":false}
```

## 4. OPA-03 — OPA transport outage fails closed

Use an approved short maintenance window because this test causes all privileged staging decisions to deny for the duration of the pause. `docker compose pause` is more reversible than deleting the OPA service, changing its policy, or altering production code. It preserves the container/network state, and `unpause` restores it.

In terminal A, pause OPA and confirm the container is paused:

```bash
cd /srv/ndsep-staging
export COMPOSE_FILE=docker-compose.production.yml

docker compose pause opa
docker compose ps opa
# Expected state: Paused / not accepting an OPA HTTP response.
```

In terminal B, immediately execute the same read-only external canary. The application’s OPA timeout defaults to 1.5 seconds; the full HTTPS response must be a 403 within the bounded test budget rather than a success or an indefinite hang.[1]

```bash
export TEST_ID="opa03-$(date -u +%Y%m%dT%H%M%SZ)"
start_epoch="$(date +%s)"
set +e
opa03_http="$(curl --silent --show-error --include --max-time 8 \
  -H "Authorization: Bearer ${NO_MFA_ACCESS_TOKEN}" \
  -H "X-Request-ID: ${TEST_ID}" \
  -o /tmp/ndsep-opa03.body -w '%{http_code}' \
  "${STAGING_APP_HOST}${OPA_CANARY_PATH}")"
opa03_exit=$?
set -e
elapsed_seconds="$(( $(date +%s) - start_epoch ))"

printf 'OPA-03 curl exit=%s HTTP=%s elapsed=%ss request_id=%s\n' \
  "$opa03_exit" "$opa03_http" "$elapsed_seconds" "$TEST_ID"
test "$opa03_exit" -eq 0
test "$opa03_http" = '403'
test "$elapsed_seconds" -le 8
```

In terminal A, restore immediately—even if the test assertion fails—then collect evidence.

```bash
cd /srv/ndsep-staging
docker compose unpause opa
docker compose ps opa

docker compose logs --since 5m ndsep-api opa \
  | grep -E "${TEST_ID}|\[opa\]|Policy decision" \
  > "/secure-evidence/${TEST_ID}.log"
```

Expected server log signal: `[opa] Policy decision unavailable; denying request`. The release package must also show no change to the selected read-only record and no unexpected mutation/audit event. If OPA remains paused or health does not recover, keep the staging change window open and treat the environment as unhealthy.

## 5. Keycloak AMR mapper: canonical and live configuration

The canonical realm export now includes `ndsep-access-token-amr`, uses `oidc-amr-mapper`, adds it to the access token, and permit-lists the mapper type. This is the required repository configuration. The Keycloak AMR mapper derives reference values from **completed authenticators in the user session**, not from a mutable user attribute.[2]

For an already-created staging realm, make the equivalent change through the Keycloak Admin Console:

1. Select the **`ndsep`** realm, then **Clients** → **`ndsep-platform`**.
2. Open **Client scopes**. Use a default scope assigned to the client, or add a mapper directly to the client if there is no managed default scope.
3. Choose **Add mapper** → **By configuration** → **Authentication Method Reference (AMR)**.
4. Name it `ndsep-access-token-amr`.
5. Enable **Add to access token**. Optionally enable token introspection only for internal diagnostic uses. Do not require a browser client to read this token.
6. Save and export the client/realm configuration. Verify that it contains `protocolMapper: "oidc-amr-mapper"` and `access.token.claim: "true"`.
7. Open **Authentication** → **Flows**. For the production browser flow, ensure the appropriate OTP/WebAuthn execution is **Required** for the selected privileged test account. A required-action enrollment prompt alone does not prove that a particular bearer session completed the second factor.
8. Force a fresh login: revoke the user session, log in with password only for `ndsep-opa-nomfa`, then separately complete TOTP or WebAuthn for `ndsep-opa-mfa`.

Use an offline decoder only for observation; it is not a validator. The NDSEP server verifies the token signature, issuer, audience, expiry, `nbf`, algorithm, and signing key before reading `amr`.[3]

```bash
# Observation only. Do not upload the token to a third-party decoder.
printf '%s' "$MFA_ACCESS_TOKEN" | awk -F. '{print $2}' \
 | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{iss,aud,azp,exp,nbf,sub,amr,acr}'
```

Expected fresh-MFA payload fragment:

```json
{
  "iss": "https://sso.staging.ndsep.nitda.gov.ng/realms/ndsep",
  "aud": ["ndsep-platform"],
  "amr": ["pwd", "otp"]
}
```

A password-only token must not contain any of `mfa`, `otp`, `webauthn`, `hwk`, or `fido2`. If the selected Keycloak authenticator emits a different **session-derived** AMR reference, add that exact normalized reference to NDSEP’s accepted list only after a security review and an end-to-end signature-verified test. Never map `amr` from a user profile attribute or accept an `acr` value alone.

> **Compatibility note:** The current realm export uses `HmacSHA1` for existing TOTP credentials. Changing the OTP hash to SHA-256 is a separate managed migration that may require re-enrollment and cannot be mixed into an AMR test window.

## 6. Caddy → APISIX client-IP preservation after an upstream DDoS provider

The currently committed Caddyfile is correct for direct-client origin traffic: it replaces `X-Forwarded-For` with `{remote_host}`, so a client cannot spoof APISIX’s `http_x_forwarded_for` rate-limit key. APISIX then enforces per-client limits of `30` requests/second plus `20` burst and `600` requests/60 seconds for `/api/*` and `/trpc/*`; the anonymous health route is lower.[4]

**Do not change Caddy first.** Complete the provider-origin firewall first, allowing inbound 443 to Caddy only from the selected provider’s authenticated, current egress CIDRs. Direct connections to the origin must fail. Otherwise a client can send a forged forwarding header directly to Caddy.

### 6.1 Caddy provider-aware replacement

After the firewall is provider-only, make this controlled Caddyfile change. Replace the example CIDRs and selected client-IP header with the provider’s documented values; never use documentation ranges in a live deployment.

```caddyfile
{
    log {
        output stdout
        format json
        level INFO
    }
    admin off

    # Replace only with the selected provider's current, version-controlled CIDRs.
    # The selected Caddy build must support the static trusted-proxy module.
    servers {
        trusted_proxies static 203.0.113.0/24 2001:db8:1234::/48
        trusted_proxies_strict
        # Use the provider-approved field. For a standard XFF chain, omit this
        # line and retain Caddy's default X-Forwarded-For parsing.
        # client_ip_headers CF-Connecting-IP
    }
}

{$NDSEP_PUBLIC_HOST} {
    # ... retained TLS/header/body controls ...
    handle {
        reverse_proxy apisix:9080 {
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Host {host}
            # These replace, rather than append to, any client-supplied values.
            header_up X-Forwarded-For {client_ip}
            header_up X-Real-IP {client_ip}
        }
    }
}
```

Validate the exact Caddy binary before reload; `trusted_proxies_strict` must be supported by the selected build.

```bash
cd /srv/ndsep-staging
# Build-specific config validation; do not reload an unvalidated configuration.
docker compose exec caddy caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate

docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

### 6.2 APISIX rate-limit key integration

The current APISIX key is deliberately `http_x_forwarded_for`; no route change is required if Caddy replaces it with the trusted `client_ip` value above. Keep the key identical on `limit-req` and `limit-count`; splitting keys defeats fairness.

```yaml
limit-req:
  rate: 30
  burst: 20
  key_type: var
  key: http_x_forwarded_for
  rejected_code: 429
limit-count:
  count: 600
  time_window: 60
  key_type: var
  key: http_x_forwarded_for
  rejected_code: 429
```

### 6.3 Mandatory three-case proof

| Test | Command/source | Expected result |
|---|---|---|
| Origin bypass | From a non-provider external network, connect to the resolved origin IP on 443 with the public `Host` header. | TCP/TLS fails at the firewall/security group. |
| Trusted provider identity | From the provider staging test source, send a documented client-IP header and make requests from two distinct test client IPs. | Caddy passes distinct trusted client IPs; APISIX creates independent rate buckets. |
| Spoof attempt | From a non-provider source, send `X-Forwarded-For: 1.2.3.4` while connecting to origin. | Firewall blocks direct origin access; Caddy never trusts the header. |

A safe, bounded APISIX fairness check uses two approved provider test sources and a **small** request count. It is not a volumetric attack.

```bash
# Run from test source A through the provider. Stop once 429 is observed.
for i in $(seq 1 55); do
  curl --silent --output /dev/null --write-out '%{http_code}\n' \
    -H "Authorization: Bearer ${MFA_ACCESS_TOKEN}" \
    "${STAGING_APP_HOST}${OPA_CANARY_PATH}"
done | sort | uniq -c

# From approved test source B, send one request immediately. It must not inherit A's limit bucket.
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  -H "Authorization: Bearer ${MFA_ACCESS_TOKEN}" \
  "${STAGING_APP_HOST}${OPA_CANARY_PATH}"
```

Observe APISIX access/error logs and the provider dashboard for the two independently evaluated source IPs. Do not run the loop from a direct origin address, use a real customer token, or increase counts to simulate a denial-of-service attack.

## References

[1] [NDSEP OPA decision client](../../server/security/opa.ts)
[2] [Keycloak AMR protocol mapper](https://www.keycloak.org/docs-api/latest/javadocs/org/keycloak/protocol/oidc/mappers/AmrProtocolMapper.html)
[3] [NDSEP Keycloak verifier](../../server/keycloak.ts)
[4] [NDSEP APISIX policy](../../config/apisix.yaml)
[5] [Caddy trusted-proxy and reverse-proxy guidance](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
