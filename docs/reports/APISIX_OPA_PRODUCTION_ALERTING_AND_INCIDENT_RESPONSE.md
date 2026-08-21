# APISIX and OPA Production Alerting and Incident Response

**Scope:** APISIX rate-limit saturation, gateway telemetry loss, OPA policy-service loss, OPA timeout rate, and OPA fail-closed infrastructure denials.
**Principle:** A surge of 429 responses may be a successful protective control, while an OPA dependency failure deliberately denies privileged requests. Operators must preserve those fail-closed properties while restoring legitimate service.

> **Prohibited emergency actions:** Do not disable OPA, set `OPA_ENABLED=false`, bypass PBAC/Permify, change Caddy to trust arbitrary forwarding headers, publish APISIX/OPA administration ports, or raise global limits blindly. Each action converts an availability incident into an authorization or abuse incident.

## 1. Live telemetry prerequisites

The deployment now emits bounded API-side OPA metrics at `/api/metrics`:

| Metric | Labels | Meaning |
|---|---|---|
| `ndsep_opa_decisions_total` | `outcome` only | Cumulative decisions: `allow`, `deny`, `unconfigured`, `http_error`, `malformed`, `timeout`, or `unavailable`. It intentionally excludes user, role, resource, IP, and request ID. |
| `ndsep_opa_decision_duration_seconds_sum` | None | Cumulative decision duration. |
| `ndsep_opa_decision_duration_seconds_count` | None | Total timing observations. |
| `apisix_http_status` | APISIX route/status dimensions | Gateway response totals, including `429` when a rate-limiting plugin rejects a request. |

Prometheus scrapes APISIX internally at `apisix:9091/apisix/prometheus/metrics` and OPA internally at `opa:8181/metrics`. Neither port is publicly published by the production Compose topology. APISIX’s Prometheus plugin exposes request status and latency through its privileged metrics listener; it should not be re-exposed through a public route merely to troubleshoot an incident. [1]

## 2. Alert thresholds and response objectives

| Alert | PromQL decision threshold | Severity / notification | Acknowledge | Initial action |
|---|---|---|---:|---|
| `APISIXGatewayMetricsDown` | APISIX scrape target down for 2 minutes | Critical; PagerDuty and critical Slack | 5 minutes | Confirm whether gateway or only metrics listener is unavailable; retain public edge isolation. |
| `APISIXRateLimitSaturation` | 429 ratio >2% for 5 minutes **and** at least 20 429s | Warning; Security Slack | 15 minutes | Classify expected campaign, client defect, IP-preservation fault, or abuse. |
| `APISIXRateLimitAttackOrMisconfiguration` | 429 ratio >10% for 2 minutes **and** at least 50 429s | Critical; PagerDuty and critical Slack | 5 minutes | Start security incident bridge; verify upstream DDoS/provider and trusted-client IP path. |
| `OPAServiceDown` | OPA scrape target down for 1 minute | Critical; PagerDuty and critical Slack | 5 minutes | Declare privileged actions fail closed; restore OPA health without bypass. |
| `OPAPolicyTimeouts` | At least 3 timeouts in 5 minutes and timeout ratio >1%, persisting 2 minutes | Warning; Security Slack | 15 minutes | Inspect OPA/API CPU, network/DNS, policy bundle, and timing. |
| `OPAFailClosedDenialsSpike` | At least 10 `unconfigured`, `unavailable`, `http_error`, `malformed`, or `timeout` outcomes in 5 minutes, persisting 2 minutes | Critical; PagerDuty and critical Slack | 5 minutes | Treat as an authorization-availability incident; freeze privileged change activity. |

The first 14 production days are a calibration period. Security and platform owners must review route-level traffic, expected batch windows, and 429 baselines weekly. Thresholds may be tightened or route-separated through a reviewed APISIX policy change; they must not be relaxed solely to close alerts.

## 3. Common incident protocol

### First five minutes

1. The on-call engineer acknowledges PagerDuty or the Security/Platform channel within the stated response objective and opens an incident ticket.
2. Record the alert name, first-fired timestamp, environment, release SHA, recent Caddy/APISIX/OPA policy changes, and the affected gateway route(s). Assign an incident commander and a communications lead; neither should make an unreviewed authorization bypass.
3. Confirm the alert from Prometheus and a second source: APISIX internal metric scrape, Caddy/APISIX logs, OPA health endpoint, or the upstream DDoS-provider dashboard.
4. Preserve a bounded evidence bundle: metrics snapshot, relevant route/policy versions, redacted logs around the incident window, and provider event IDs. Do not include tokens, OTP values, raw request bodies, or customer data.
5. Establish a 15-minute internal update cadence for P1 incidents and a 30-minute cadence for P2 incidents.

### Recovery and closure

Recovery requires the alert to resolve, a 15-minute stable observation period, and a read-only privileged canary verifying normal OPA behavior if OPA was affected. The incident commander records the root cause, the configuration version before/after, impact estimate, remaining corrective actions, and a scheduled review within five business days.

## 4. APISIX rate-limit saturation playbook

### 4.1 Verify the signal

Use Prometheus with a **read-only** query or the Grafana Explore interface. Do not make metric ports public.

```promql
sum by (route) (increase(apisix_http_status{code="429"}[5m]))
```

```promql
sum(rate(apisix_http_status{code="429"}[5m]))
/
clamp_min(sum(rate(apisix_http_status[5m])), 0.1)
```

Correlate this with request/connection and upstream health metrics:

```promql
sum by (state) (apisix_nginx_http_current_connections)
```

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (rate(apisix_http_latency_bucket{type="request"}[5m]))
)
```

### 4.2 Classify before changing anything

| Observation | Likely cause | Containment |
|---|---|---|
| 429s concentrated in one client/IP, normal upstream latency | Credential misuse, bot, abusive integration, or broken client retry loop | Retain limits; apply the upstream provider’s temporary source/ASN/bot control; contact the integration owner. |
| 429s appear across unrelated users immediately after CDN/DDoS-provider rollout | Caddy may be rate-keying the shared provider edge rather than verified client IP | Confirm provider-only origin firewall and Caddy `trusted_proxies`; roll back the provider-client-IP config to the prior safe configuration if validation fails. Do not pass through arbitrary XFF. |
| 429s plus provider attack indicators, high connection rate, and edge bandwidth pressure | Active application or volumetric attack | Invoke provider’s under-attack/runbook profile; preserve origin allow-list; work with the provider/NOC. Do not direct synthetic attack traffic at the edge. |
| 429s follow a product deployment and only one route/type | Client release bug, unexpected batch job, too-low route limit | Pause the job/client, then tune that route through an approved scoped APISIX change after capacity review. |
| 429s and high API/database saturation but no attack indicator | Real capacity exhaustion | Shed nonessential traffic, pause expensive exports/AI/batch flows, scale safe capacity, and retain the gateway limits. |

### 4.3 Containment and recovery

1. For abuse, use the upstream provider’s scoped controls first: bot challenge/block, known-bad source/ASN control where law and policy permit, and managed DDoS profile. Keep a change ID and expiry.
2. For a faulty authenticated client, revoke/rotate the integration credential if compromise is suspected; otherwise pause the client and require exponential backoff with jitter before re-enabling it.
3. For a trusted-proxy defect, restore the last verified Caddy configuration and validate that the origin firewall still admits only provider CIDRs. A direct origin request with spoofed `X-Forwarded-For` must fail before Caddy.
4. For a genuine capacity issue, separate expensive endpoints into their own lower-budget APISIX routes and asynchronous queues. Global rate-limit increases require a capacity measurement, a rollback timestamp, and a second approver.
5. Re-run the two-client fairness canary from approved provider test sources. One source reaching its 429 budget must not throttle the second source.

## 5. OPA timeout and fail-closed playbook

### 5.1 Verify the OPA signal

```promql
sum by (outcome) (increase(ndsep_opa_decisions_total[5m]))
```

```promql
sum(increase(ndsep_opa_decisions_total{outcome="timeout"}[5m]))
/
clamp_min(sum(increase(ndsep_opa_decisions_total[5m])), 1)
```

```promql
sum(rate(ndsep_opa_decision_duration_seconds_sum[5m]))
/
clamp_min(sum(rate(ndsep_opa_decision_duration_seconds_count[5m])), 0.001)
```

Then confirm internal health without exposing it publicly:

```bash
# Run only from a privileged staging/production internal operations host.
curl --silent --show-error --fail-with-body --max-time 2 http://opa:8181/health
curl --silent --show-error --max-time 2 http://opa:8181/metrics | head -n 20
```

### 5.2 Diagnose by outcome

| OPA outcome | Likely fault domain | Safe diagnostic action |
|---|---|---|
| `unconfigured` | Deployment environment drift, missing URL, disabled flag, bad secret/config map | Compare immutable deployment manifest and secret references to the approved version; redeploy the approved configuration. Do not set a development fallback. |
| `unavailable` | OPA process, DNS, network policy, service routing, or TLS/connection fault | Check `up{job="opa"}`, container/pod health, internal DNS, network policy, and OPA logs. Restore the service path. |
| `timeout` | OPA CPU/memory saturation, policy evaluation cost, network delay, API thread contention | Check OPA resource usage and policy bundle size/recent changes; roll back the policy bundle or scale OPA after review. Keep the 1.5-second API timeout until a tested replacement value is approved. |
| `http_error` | OPA HTTP service/proxy/protocol failure | Inspect OPA health, endpoint path, authentication middleware, and response status. Restore the exact `allow` decision path. |
| `malformed` | Invalid/non-boolean policy response or incompatible OPA version/bundle | Revert to the last verified policy bundle/image. A string such as `"true"` is intentionally denied. |
| `deny` | Legitimate PBAC/Permify/OPA policy deny | Investigate only if the business owner identifies an expected action incorrectly denied; do not classify ordinary denials as availability incidents. |

### 5.3 Containment and recovery

1. Announce that privileged mutations, exports, approvals, and deletes are intentionally unavailable. Maintain read-only functions only where independently safe.
2. Freeze privileged deployment and policy changes except an approved rollback. Preserve current OPA/Caddy/APISIX image and configuration hashes.
3. Restore OPA from the last verified image/policy bundle or correct the internal dependency path. Scaling is permitted only after checking that the policy bundle and resource limits are valid.
4. Verify an internal OPA policy query returns a literal `{"result":false}` for `mfaVerified:false`, then run the read-only external no-MFA canary (403) and fresh-MFA positive control (approved success). [2]
5. Observe 15 minutes with `timeout`, `unavailable`, `http_error`, `malformed`, and `unconfigured` increments at zero before closure. Any continued failure keeps the incident open.

## 6. Alert delivery and escalation

Critical alerts route to PagerDuty and the critical Slack channel with a 10-second group wait; security warnings route to the security channel with a 15-second group wait. Alertmanager uses the `severity` and `team` labels already present in the rule definitions.[3] Every P1 requires platform and security participation. Where a suspected attack affects regulated data or statutory services, the incident commander also engages the designated compliance/legal contact under the existing incident policy.

## References

[1] [Apache APISIX Prometheus plugin](https://apisix.apache.org/docs/apisix/3.2/plugins/prometheus/)
[2] [NDSEP Staging Command Guide](./OPA_AMR_CADDY_APISIX_COMMAND_GUIDE.md)
[3] [NDSEP Alertmanager routing](../../infra/prometheus/alertmanager.yml)
