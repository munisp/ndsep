# APISIX Rate-Limit Canary Rollout and Connection-Safety Procedure

**Scope:** A policy-only rollout of APISIX `limit-req` and/or `limit-count` changes. The current NDSEP routes protect `/api/*` and `/trpc/*` with OIDC, per-trusted-client request rate, and per-trusted-client count limits.[1]

> **Core rule:** Do not turn a rate-policy experiment into a gateway restart. In NDSEP’s standalone file-driven APISIX mode, a complete `apisix.yaml` file ending in `#END` is hot-updated; existing APISIX workers are not replaced for that configuration update.[2] Existing in-flight HTTP requests keep their already-completed access-phase decision. The new limiter parameters affect subsequent request processing and may intentionally produce `429`; they must not tear down existing request connections.

## 1. Why the canary uses separate gateway cohorts

APISIX’s `traffic-split` plugin is designed to choose among **upstreams**. A rate limiter executes at the gateway access phase, before the request is proxied; therefore forwarding a request to a different application upstream does **not** by itself test a different gateway rate-limit policy.[3]

The safe NDSEP strategy is a **two-gateway, cohort-pinned** canary:

| Component                   | Stable path                                                                   | Canary path                                                                                                | Safety purpose                                                        |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Public edge / DDoS provider | Routes established client cohort to `apisix-stable`                           | Routes the selected cohort to `apisix-canary`                                                              | Connection and client affinity are preserved at the edge.             |
| Caddy                       | Strips any user-supplied `X-NDSEP-Rate-Policy` and forwards to stable gateway | Only the controlled canary virtual host or trusted edge-injected cohort sets `X-NDSEP-Rate-Policy: canary` | A customer cannot opt into or spoof the canary.                       |
| APISIX                      | Existing stable config and stable rate rules                                  | Identical route/auth/upstream configuration except the proposed `limit-req`/`limit-count` values           | Isolates the security-policy delta.                                   |
| NDSEP API                   | Same application version and upstream service                                 | Same application version and upstream service                                                              | Prevents an application release from masking a gateway-policy result. |

**Do not split each request at random.** Weighted per-request selection can move one client between policies during a keepalive session and makes non-idempotent retries difficult to interpret. The external edge or service-mesh must assign a durable, signed/controlled cohort cookie or authenticated consumer group; its routing key remains sticky for at least the active-session period. For highly regulated or financial clients, use allow-listed integration consumers rather than a percentage bucket until their retry behavior has been verified.

## 2. Canary configuration shape

### 2.1 Stable configuration remains intact

The stable gateway continues to serve its existing route configuration. No direct user-facing route starts trusting a canary header. Keep `X-Forwarded-For` replacement and APISIX’s `http_x_forwarded_for` rate key unchanged; otherwise the rollout simultaneously changes client-identity and limit behavior.

### 2.2 Canary gateway route

In the canary APISIX configuration only, add a higher-priority, cohort-constrained route and retain an equivalent stable fallback. The values shown are placeholders and must be replaced by the reviewed candidate limits; do not copy them into production as defaults.

```yaml
# Canary APISIX data plane only; retain all current OIDC, WAF, security-header,
# timeout, response, and Prometheus plugin settings from config/apisix.yaml.
- id: ndsep-api-rate-policy-canary
  uri: /api/*
  priority: 100
  vars:
    - ["http_x_ndsep_rate_policy", "==", "canary"]
  upstream:
    type: roundrobin
    scheme: http
    nodes:
      "ndsep-api:3000": 1
  timeout:
    connect: 3
    send: 15
    read: 30
  plugins:
    openid-connect: # same settings as the stable ndsep-api route
      discovery: "http://keycloak:8080/realms/ndsep/.well-known/openid-configuration"
      bearer_only: true
      realm: ndsep
      client_id: ndsep-platform
      use_jwks: true
      ssl_verify: true
    limit-req:
      rate: <reviewed_candidate_requests_per_second>
      burst: <reviewed_candidate_burst>
      key_type: var
      key: http_x_forwarded_for
      rejected_code: 429
    limit-count:
      count: <reviewed_candidate_requests_per_window>
      time_window: 60
      key_type: var
      key: http_x_forwarded_for
      rejected_code: 429
    prometheus: {}
```

A matching `/trpc/*` canary route uses the same approach. Diff the complete stable and canary APISIX files and require the rate-limit fields, route ID, and cohort guard to be the only intended behavioral differences. The candidate policy must preserve OIDC, WAF attachment, trusted forwarded client identity, request timeouts, Prometheus, and response hardening.

### 2.3 Trusted cohort injection

Use one of these controlled mechanisms, in this order of preference:

1. **Dedicated canary hostname** such as `rate-policy-canary.staging.ndsep.gov.ng`, restricted to synthetic and approved integration accounts. Caddy strips inbound `X-NDSEP-Rate-Policy` and then injects `canary` only in that dedicated virtual-host handler.
2. **Edge-issued signed cohort cookie** mapped by the upstream DDoS provider/ingress to the canary APISIX origin. The provider validates the signature; Caddy then adds the internal header after stripping any client-supplied value.
3. **Authenticated consumer allow-list** implemented at the gateway/provider after OIDC identity validation. Do not expose a raw request header for general clients to self-select.

Before enabling any cohort, verify that a direct origin connection is blocked, a client-provided `X-NDSEP-Rate-Policy: canary` is removed, and a trusted canary identity receives the internally injected header. The edge must retain its provider-only origin firewall and trusted-proxy configuration.

## 3. Traffic shifting sequence

The weights below refer to **sticky cohort assignment**, not a random request probability. Hold each stage for at least 15 minutes and no fewer than 20,000 requests or one representative business batch, whichever is larger. For low-volume routes, hold for one business day and use approved synthetic traffic only; do not infer a percentage result from a handful of requests.

| Stage |                      Canary cohort | Required checks before promotion                                                                                              | Automatic/manual rollback trigger                                                                    |
| ----: | ---------------------------------: | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
|     0 |             0%; deploy config only | APISIX config loads; dashboard and `up{job="apisix"}` are healthy; no pod restart/reload observed.                            | Any config parse/reload error or gateway metrics loss.                                               |
|     1 |   Internal synthetic accounts only | Canaries verify expected 200/401/403/429 boundaries; no connection resets; client-IP limit key reflects trusted identity.     | Any unexpected 2xx/5xx, a missing 429 at defined synthetic budget, or source-IP collapse.            |
|     2 | 1% sticky approved low-risk cohort | Canary 429 ratio, 5xx rate, p95 request latency, active connection count, auth failures, and OPA failures stay within gate.   | 5xx increases by >0.5 percentage point, p95 grows >100 ms, or 429 saturation alert becomes critical. |
|     3 |                                 5% | Repeat representative read/write/retry tests; confirm no non-idempotent retry duplication.                                    | Any active-client disconnect, materially elevated complaints, or policy bypass.                      |
|     4 |                                10% | Security and platform review 30-minute metrics; validate WAF and upstream provider events.                                    | Alert, upstream pressure, or client fairness regression.                                             |
|     5 |                                25% | One business-period observation and integration-owner sign-off.                                                               | Same as prior stages; immediately return newly assigned cohorts to stable.                           |
|     6 |                                50% | Two independent reviewers approve; confirm capacity and no cross-client bucket sharing.                                       | Any error budget burn or critical 429 ratio.                                                         |
|     7 |                  100% new sessions | Keep stable gateway ready but stop assigning new sessions to it.                                                              | Failure gates for 30 minutes; revert new cohort assignment, do not kill the stable pool.             |
|     8 |                  Stable retirement | Wait at least the configured maximum client keepalive/session drain period plus APISIX `read` timeout before draining stable. | Any remaining long-lived client/session still reports errors.                                        |

For each promotion, capture these read-only PromQL values:

```promql
100 * sum(rate(apisix_http_status{code="429"}[5m]))
/ clamp_min(sum(rate(apisix_http_status[5m])), 0.1)
```

```promql
sum by (route) (increase(apisix_http_status{code="429"}[5m]))
```

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (rate(apisix_http_latency_bucket{type="request"}[5m]))
)
```

```promql
sum by (state) (apisix_nginx_http_current_connections)
```

## 4. Connection-safety rules

1. **Hot-update configuration; never roll restart APISIX for a policy-only change.** File-driven standalone APISIX polls its complete config file and hot-updates rules when it changes.[2]
2. **Pin a client cohort at the edge.** Existing HTTP/2, keepalive, WebSocket, SSE, upload, and long-running clients remain assigned to the same stable/canary gateway. Do not change a cohort’s origin mid-session.
3. **Avoid policy changes during long-lived-session windows.** Use a maintenance/change window or preserve the stable pool until the longest documented client session and active request drain have elapsed. APISIX’s current route `read` timeout is 30 seconds, but application-level streaming/session behavior may be longer and governs the actual drain period.[1]
4. **Do not make strict limit reductions globally first.** Validate the candidate against known client retry/backoff behavior. A new 429 triggers a client response, not a dropped TCP connection; a broken immediate retry loop can still create an availability incident.
5. **Drain, do not terminate.** At 100% new-session assignment, prevent only new cohort assignments to stable. Continue serving active stable connections until connection metrics and the drain horizon are clear.
6. **Rollback routing, not availability controls.** Return new cohort assignment to stable, keep existing client affinity, and retain the stable APISIX pool. Do not disable global limits or delete the canary route under active connections.

## 5. Change sequence and approvals

1. Create a change record naming stable/canary config digests, route IDs, candidate values, cohort source, client-affinity mechanism, error gates, rollback owner, and drain duration.
2. Apply the candidate in pre-production first using the GitOps workflow. The workflow runs Kustomize validation, Argo CD sync, resource verification, and—only with manual protected approval—the isolated OPA P1 drill.[4]
3. Run synthetic boundary tests: below-limit 200, expected 401/403, exactly-over-limit 429, and recovery after the limit window. Use approved test accounts only.
4. Begin Stage 1. Each promotion requires Security and Platform review; 25% and above also requires the designated business/service owner.
5. If a gate fails, freeze promotion, return **new** cohorts to stable, capture evidence, and create an incident when customer impact is observed.
6. After 100% new-session assignment, hold the stable pool through the drain period. Retire it only after active connection evidence is zero/steady and rollback window expires.

## References

[1] [NDSEP APISIX rate-limit policy](../../config/apisix.yaml)
[2] [Apache APISIX deployment modes](https://apisix.apache.org/docs/apisix/deployment-modes/)
[3] [Apache APISIX traffic-split plugin](https://apisix.apache.org/docs/apisix/3.2/plugins/traffic-split/)
[4] [Pre-production monitoring GitOps workflow](../../.github/workflows/preproduction-monitoring-gitops.yml)
