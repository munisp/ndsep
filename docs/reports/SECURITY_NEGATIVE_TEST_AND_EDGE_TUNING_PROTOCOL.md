# Security Negative-Test and Edge-Tuning Protocol

**Applies to:** the hardened NDSEP production topology introduced in commit `8563f51`.
**Purpose:** prove that privileged actions fail closed, that MFA assurance is taken from a signed Keycloak token rather than a client-controlled field, and that the edge is correctly layered for application and volumetric denial-of-service protection.

> **Safety boundary:** Run these tests only in an approved staging environment, using dedicated test accounts, tenant data, source addresses, and a written change window. Do not load-test production, send synthetic attack traffic from uncontrolled sources, or expose OPA, APISIX administration, Keycloak administration, or worker ports to make testing easier.

## 1. Evidence and roles

| Role | Responsibility | Must not also approve |
|---|---|---|
| Identity operator | Creates the dedicated test users, performs MFA enrollment, and configures the signed AMR mapper. | Their own privileged-access result. |
| Platform operator | Controls OPA reachability, DDoS-provider staging policy, and edge deployment. | Their own network-failure result. |
| Application/security tester | Executes canary requests and confirms there are no durable mutations after denial. | The configuration change they authored. |
| Release approver | Reviews the evidence package and records pass/fail. | Test execution. |

For every test, preserve a UTC timestamp, deployment/image digests, request correlation ID, actor/test account, expected and actual status, APISIX/Caddy/OpenAppSec/OPA logs, application audit result, and database before/after count for the test record. Do **not** retain access tokens or OTP seeds in the evidence package.

## 2. Pre-flight controls

Before negative testing, verify that only Caddy is host-published and that OPA/APISIX/Keycloak control planes remain internal.

```bash
# From a permitted external test network; use the staging DNS names and ports.
# Each internal/control-plane connection must fail, while public HTTPS succeeds.
nc -vz "$STAGING_EDGE_HOST" 80
nc -vz "$STAGING_EDGE_HOST" 443
nc -vz "$STAGING_EDGE_HOST" 9080  # expected failure
nc -vz "$STAGING_EDGE_HOST" 9180  # expected failure
nc -vz "$STAGING_EDGE_HOST" 8080  # expected failure
```

Record the source network and result. A successful connection to `9080`, `9180`, `8080`, a worker port, PostgreSQL, Redis, Grafana, Prometheus, or Temporal is a release-blocking failure.

Prepare two named Keycloak accounts in an isolated test organization:

| Account | Role/relationship | MFA state | Intended result |
|---|---|---|---|
| `ndsep-opa-nomfa` | Minimum relationship required to reach the selected privileged canary procedure | Password only; no OTP/WebAuthn completion | Denied by OPA because `mfaVerified=false` |
| `ndsep-opa-mfa` | Same approved relationship and role | Enrolled and completes TOTP or WebAuthn on the tested session | Allowed only if PBAC, Permify, OPA, and the business precondition all allow |

The canary procedure must be a pre-approved staging-only record handled by `adminProcedure`, `approveProcedure`, `deleteProcedure`, or `exportProcedure`. Record the real tRPC procedure name in the change ticket. Do not use a business record, a customer export, a financial transaction, or an irreversible production operation as a security test.

## 3. Keycloak MFA claim configuration and verification

NDSEP sets `mfaVerified=true` only when the **cryptographically verified** access token contains an `amr` array with one of `mfa`, `otp`, `webauthn`, `hwk`, or `fido2`. A decoded browser claim, a request header, an `acr` value by itself, a user-profile attribute, or a hard-coded claim is not sufficient.

Keycloak provides the built-in `oidc-amr-mapper`; it sets the `amr` claim from the reference values of completed authenticators in the user session. [1] The mapper must be assigned to the `ndsep-platform` client or an always-requested client scope and configured to add the claim to the **access token**. Adding it only to the ID token is insufficient because APISIX and the NDSEP API authorize bearer access tokens.

### 3.1 Configure the mapper in staging

In the Keycloak Admin Console for the staging `ndsep` realm:

1. Open **Clients** → `ndsep-platform` → **Client scopes** or open the client scope that is automatically assigned to `ndsep-platform`.
2. Select **Add mapper** → **By configuration** → **Authentication Method Reference (AMR)**.
3. Set a reviewable name such as `ndsep-access-token-amr`.
4. Enable **Add to access token**. Enable ID-token and introspection inclusion only where needed for controlled diagnostics; do not add it to frontend-readable response fields unnecessarily.
5. Save, export the realm/client configuration, and attach the mapper export to the change record.
6. In **Authentication**, confirm the browser flow requires the OTP or WebAuthn execution for the tested user. Required MFA enrollment alone is not proof that the session completed MFA.

> The exact AMR reference values come from completed authentication executions. Do not map a mutable user attribute such as `mfa=true` into `amr`; that would convert a policy decision into an administratively editable profile value. [1]

### 3.2 Verify the signed claim before using it

For each test account, complete a new authorization-code + PKCE login in staging and obtain a new access token. Never test with copied production tokens. Decode the **payload only for observation** using an approved offline tool; the application itself must verify the RS256 signature, issuer, audience, expiry, and `nbf` before accepting it.

| Session | Expected access-token observation | Release decision |
|---|---|---|
| Password-only session | `amr` absent or contains only a non-MFA method such as `pwd`; it must not contain an accepted MFA value. | Continue only if NDSEP denies the privileged canary. |
| TOTP-completed session | `amr` contains the authenticator’s configured OTP reference, commonly `otp`. | Continue only if NDSEP reaches the explicit OPA allow test. |
| WebAuthn-completed session | `amr` contains the configured WebAuthn/FIDO reference, commonly `webauthn` or `fido2`. | Continue only if NDSEP reaches the explicit OPA allow test. |
| Forged decoded payload | A locally altered payload may appear to contain `otp`, but signature verification must reject it before OPA input construction. | Any acceptance is a P0 incident. |

The Keycloak verifier rejects unsigned/wrong-algorithm tokens, unknown signing keys, expired/not-yet-valid tokens, issuer mismatch, and audience mismatch before deriving `mfaVerified`. The procedure must show each negative result at the public edge and no durable canary mutation.

## 4. OPA fail-closed negative-test matrix

OPA is the **fourth** authorization decision for high-risk actions, after authenticated identity, PBAC, and Permify. In production, NDSEP submits `subject`, `action`, `resource`, environment, and the server-derived `mfaVerified` value to `${OPA_URL}/v1/data/ndsep/authz/allow`. Only JSON `{"result": true}` permits the request. Transport errors, HTTP non-2xx responses, parsing errors, missing OPA configuration, `false`, and timeouts over the configured 1.5 seconds all deny. [2]

Use a dedicated OPA test namespace or a temporary copy of the policy bundle. Do not modify the shared production policy in place. Before every case, capture the canary record’s state and an audit-event count; after every case, confirm both are unchanged unless the expected result is the positive control.

| ID | Controlled condition | Execution method | Expected public result | Evidence and stop condition |
|---|---|---|---|---|
| OPA-01 | Password-only privileged user | Call the approved canary procedure with `ndsep-opa-nomfa`’s fresh bearer token. | HTTP 403 / `Policy decision denied or unavailable`; no mutation. | Capture token payload observation showing absent/non-MFA `amr`; app/audit/DB state. A 2xx is P0. |
| OPA-02 | Explicit MFA policy deny | From an internal test pod, POST the exact decision input with `context.mfaVerified=false` to a temporary OPA policy endpoint or query fixture. | OPA result is `false`. | OPA response plus policy bundle digest. A `true` result is P0. |
| OPA-03 | OPA service unreachable | Isolate only the NDSEP API → OPA path with a temporary staging network policy/firewall rule, or stop the OPA canary service. | Privileged canary gets 403 within the API timeout budget; no mutation. | Network-rule/change ID, API log with OPA unavailable warning, DB comparison. Any allow is P0. |
| OPA-04 | OPA timeout | Inject latency greater than `OPA_TIMEOUT_MS` only between the API canary and OPA. | 403 after bounded timeout; API worker pool remains healthy. | Latency configuration and p95 response time. Any unbounded hang or allow is release-blocking. |
| OPA-05 | OPA malformed response | Direct the canary API deployment to an internal fixture that returns HTTP 200 with `{}`, `{"result":"true"}`, invalid JSON, and then HTTP 500. | 403 for every response except literal boolean `true`. | Fixture logs, API result, no mutation. Any allow is P0. |
| OPA-06 | OPA disabled/misconfigured | In a disposable canary API deployment set `OPA_ENABLED=false` or omit `OPA_URL` while retaining `NODE_ENV=production`. | 403; log indicates production OPA is unconfigured. | Deployment diff and response. Any development fallback in production is P0. |
| OPA-07 | Permify deny with valid MFA | Use `ndsep-opa-mfa` but remove the canary’s Permify relationship. | 403 before business mutation. | Permify relationship diff and audit result. Any OPA-only allow is P0. |
| OPA-08 | Explicit allow positive control | Give `ndsep-opa-mfa` the approved PBAC role, Permify relationship, and a policy allow; use the staging canary record. | Expected success only once, with an audit event. | OPA response, before/after canary state, audit event; revert test record afterward. |

### 4.1 Minimal internal OPA query shape

This command is a **policy-unit check**, not proof that the application accepts the token. Run it only from an internal staging administrative context with a short-lived OPA token where configured.

```bash
curl --fail-with-body --max-time 2 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPA_TEST_TOKEN" \
  --data '{
    "input": {
      "subject": {"id":"opa-canary","role":"admin","authenticated":true},
      "action":"admin",
      "resource":"platform.admin",
      "context":{"environment":"production","mfaVerified":false}
    }
  }' \
  "$OPA_URL/v1/data/ndsep/authz/allow"
```

The response must be `{"result":false}`. Repeat with `mfaVerified:true` only after the valid-MFA application test has independently shown that the claim is produced by Keycloak and verified by NDSEP. The direct query never substitutes for OPA-01 through OPA-08.

## 5. Upstream volumetric DDoS protection

Caddy, APISIX, and OpenAppSec are application/HTTP controls. They cannot absorb a bandwidth-exhaustion or packet-rate attack that saturates the public link before traffic reaches Caddy. CISA distinguishes volumetric, protocol, and application-layer DDoS techniques; the deployment must use a provider or national/network edge that filters the first two classes upstream. [3]

### 5.1 Required upstream architecture

| Layer | Required action | Verification |
|---|---|---|
| Authoritative DNS | Delegate the public application and Keycloak hostnames to the selected DDoS/CDN provider or protected national edge. Enable DNSSEC where the authoritative DNS platform and governance permit it. | Resolve the name from independent networks and retain provider zone/audit records. |
| Provider edge | Enable always-on L3/L4 volumetric scrubbing, SYN/UDP/ICMP flood controls, connection-rate limits, bot management where appropriate, TLS policy, and provider-side request caps. Set an emergency under-attack/runbook profile that does not block required regulator and partner paths. | Provider dashboard/policy export; 24×7 escalation path and emergency activation test. |
| Origin firewall | Allow inbound TCP 443 to Caddy **only** from the provider’s published egress CIDRs. Deny direct Internet traffic; allow 80 only if the selected certificate/redirect design requires it. Keep all internal service ports private. | External origin-IP connection fails; provider-path HTTPS succeeds. Re-test when provider CIDRs change. |
| Caddy client identity | Trust forwarded client identity only after the origin firewall restricts source addresses to current provider CIDRs. Configure Caddy’s documented `trusted_proxies` with the provider IP ranges and use strict right-to-left parsing if the selected Caddy build supports it. [4] | A client-supplied `X-Forwarded-For` cannot alter the APISIX rate-limit key; the provider-supplied client IP can. |
| APISIX | Keep OIDC, per-client rate/count limits, body bounds at Caddy/WAF, short upstream timeouts, and no anonymous catch-all. Tune using observed authenticated endpoint traffic rather than a universal static number. | Baseline and burst tests receive expected 2xx/429 behavior without backend overload. |
| OpenAppSec | Keep the attachment/agent inline and healthy; use anti-bot, schema, web-attack, parser limit, and event policies. | Agent health, attachment logs, synthetic protected-route event, and no bypass path. |

### 5.2 Critical client-IP correction before enabling a CDN/DDoS provider

The current Caddyfile intentionally overwrites `X-Forwarded-For` with `{remote_host}`. This is correct for direct-client deployment because it discards spoofed forwarding headers. When a CDN/scrubbing proxy is introduced, `{remote_host}` becomes the provider edge address. If Caddy is not configured with **only the provider’s verified CIDRs as trusted proxies**, APISIX will rate-limit the shared provider address rather than individual clients.

Do not merely pass through `X-Forwarded-For`. That would permit client spoofing. Instead, make the origin firewall provider-only first, then update Caddy with the provider’s current CIDR list and selected standard client-IP header. Test the following three cases before enabling the provider in production.

| Case | Request source/header | Required result |
|---|---|---|
| Direct Internet attempt to origin | Any IP not owned by provider | Blocked at firewall/security group before Caddy. |
| Provider-originated request with a valid client-IP header | Provider egress CIDR and documented header | Caddy extracts the client IP; APISIX applies independent limit bucket. |
| Spoofed forwarding header | Direct/non-provider source or invalid chain | Caddy ignores it; request is blocked at origin or rate-limited by actual peer. |

The provider CIDR source must be version-controlled or automatically synchronized from the provider’s authenticated published list, with alerting when the list changes. A manual, stale list is a high-availability and abuse risk.

### 5.3 Capacity baselining and safe rate tuning

Set APISIX limits from measured service capacity, not from a generic security number. Collect at least seven days of representative staging or production-like traffic per route class: authenticated interactive APIs, exports, uploads, machine-to-machine calls, and public health/OIDC endpoints. Record p50/p95/p99 request rate, concurrent connections, request size, latency, CPU, memory, database connections, and downstream quota consumption.

Use the following change method for each route class:

1. Start with the existing restrictive staging values (`30` requests/second with `20` burst and `600` requests/minute per client for authenticated API/tRPC routes; health is lower).
2. Run a pre-approved, bounded load test from one labelled test source. Increase only until the route’s p95 latency remains within its SLO and application/database saturation remains below the defined operating threshold.
3. Add a safety margin below measured saturation; do not set the limiter equal to maximum observed throughput.
4. Move expensive operations such as exports, searches, AI, and evidence uploads to separate routes with lower concurrency/rate budgets and asynchronous job semantics. A successful authenticated request must not reserve unbounded CPU, database, or external-service work.
5. Test one client exceeding its budget while a second test client continues to receive normal service. This proves fairness and avoids a global limit masquerading as per-client protection.
6. Roll back immediately if 429 volume, false-positive rate, p95 latency, queue depth, or error rate exceeds the change window’s threshold. Preserve the prior declarative APISIX policy and provider rule version.

Do not use uncontrolled Internet load generators or attempt to saturate a provider, origin link, or database. Provider-assisted volumetric tests must use its sanctioned test process and pre-agreed source ranges, duration, cap, abort contact, and incident bridge.

## 6. OpenAppSec tuning and WAF release sequence

The repository policy is intentionally conservative in parser bounds and prevent-learn mode. A new protected asset should first be observed in Learn/Detect, not switched blindly to broad prevention. OpenAppSec recommends establishing a traffic baseline and reviewing suggestions; it notes that learning commonly takes roughly two to three days when traffic is sufficient, then recommends a graduated transition through Critical and High severity prevention. [5]

| Phase | Required action | Exit criterion |
|---|---|---|
| 0. Inventory | List API paths, methods, content types, authentication expectations, maximum legitimate body/header/URL sizes, and privileged flows. Identify sensitive endpoints separately. | Asset inventory and route-owner approval. |
| 1. Observe | Deploy attachment/agent and policy in Learn/Detect for representative traffic. Confirm events arrive without request bodies, credentials, or regulated data. | Agent healthy; no bypass; enough representative traffic to interpret results. |
| 2. Tune | Review suggested benign/malicious classifications with each route owner. Add the narrowest exception possible—method/path/parameter/source—not a global rule. Expire every exception and assign an owner. | Documented false-positive decision log and expiry dates. |
| 3. Graduated prevent | Block Critical events first; review events for at least one full business cycle. Then progress to High-and-above only when recommendation and observed false-positive rate support it. | Security and route-owner approval; canary synthetic requests blocked. |
| 4. API schema enforcement | For stable APIs, attach reviewed OpenAPI schemas and method/content-type/body bounds. Treat schema changes as deployable, reviewed artifacts. | Valid requests pass; malformed method/content-type/schema canary is blocked without false positives. |
| 5. Continuous review | Alert on agent unavailable, prevent spike, detect spike, parser-limit violation, policy-change, and exception expiry. Re-run the canary pack after every policy/gateway change. | Weekly security review and change-ticket evidence. |

The attachment and agent must be tested together: a healthy management UI alone is not proof that APISIX consults the inline agent. The Docker integration uses an attachment-enabled APISIX image and shared IPC with the agent; preserve that relationship during upgrades and confirm it with a protected-route canary. [6]

## 7. Final release gate

The edge is ready for production only when the release approver has all of the following: OPA-01 through OPA-08 evidence; signed valid/invalid MFA-token evidence; a provider-only origin firewall test; verified Caddy client-IP handling; provider DDoS escalation and sanctioned test evidence; APISIX fairness/rate evidence; OpenAppSec attachment/agent and graduated-tuning evidence; and a tested rollback version for provider, Caddy, APISIX, and WAF policy changes.

## References

[1] [Keycloak AMR protocol mapper API](https://www.keycloak.org/docs-api/latest/javadocs/org/keycloak/protocol/oidc/mappers/AmrProtocolMapper.html)
[2] [NDSEP OPA client](../../server/security/opa.ts)
[3] [CISA: Understanding and Responding to DDoS Attacks](https://www.cisa.gov/resources-tools/resources/understanding-and-responding-distributed-denial-service-attacks)
[4] [Caddy reverse-proxy and trusted-proxy guidance](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
[5] [OpenAppSec: Track learning and move from Learn/Detect to Prevent](https://docs.openappsec.io/how-to/configuration-and-learning/track-learning-and-move-from-learn-detect-to-prevent)
[6] [APISIX + OpenAppSec Docker integration](https://apisix.apache.org/blog/2024/10/22/apisix-integrates-with-open-appsec/)
