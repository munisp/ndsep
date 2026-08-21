# APISIX and OPA Monitoring Queries, Verifier Failure Modes, and Critical Incident Execution

**Scope:** The provisioned Grafana dashboard [`ndsep-edge-policy-security.json`](../../infra/grafana/dashboards/ndsep-edge-policy-security.json), the staging verifier [`verify-staging-opa-amr.ts`](../../scripts/security/verify-staging-opa-amr.ts), and the production alert rules in [`alerts.yml`](../../infra/prometheus/alerts.yml).

> All metrics endpoints are internal. Run queries in Grafana/Prometheus through an approved operations session only; do not expose APISIX port `9091` or OPA port `8181` publicly to make these queries convenient.

## 1. Exact PromQL expressions

### APISIX 429 saturation

The following expression produces the percentage used by the warning and critical conditions. It is deliberately global because the initial APISIX policy does not attach high-cardinality client labels. Use the route breakdown separately to locate an affected path.

```promql
100 * sum(rate(apisix_http_status{code="429"}[$__rate_interval]))
/
clamp_min(sum(rate(apisix_http_status[$__rate_interval])), 0.1)
```

The alert-equivalent warning expression is:

```promql
(
  sum(rate(apisix_http_status{code="429"}[5m]))
  /
  clamp_min(sum(rate(apisix_http_status[5m])), 0.1)
) > 0.02
and sum(increase(apisix_http_status{code="429"}[5m])) >= 20
```

The critical expression is:

```promql
(
  sum(rate(apisix_http_status{code="429"}[1m]))
  /
  clamp_min(sum(rate(apisix_http_status[1m])), 0.1)
) > 0.10
and sum(increase(apisix_http_status{code="429"}[1m])) >= 50
```

Use these investigation queries during an alert:

```promql
sum by (route) (increase(apisix_http_status{code="429"}[5m]))
```

```promql
sum by (state) (apisix_nginx_http_current_connections)
```

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (rate(apisix_http_latency_bucket{type="request"}[5m]))
)
```

```promql
up{job="apisix"}
```

### OPA fail-closed infrastructure denials

The following query is the exact source for the critical `OPAFailClosedDenialsSpike` condition. It excludes ordinary `deny` responses because those may be valid authorization results and should not be treated as an OPA availability failure.

```promql
sum(
  increase(
    ndsep_opa_decisions_total{
      outcome=~"unconfigured|unavailable|http_error|malformed|timeout"
    }[5m]
  )
)
```

The alert-equivalent critical condition is:

```promql
sum(
  increase(
    ndsep_opa_decisions_total{
      outcome=~"unconfigured|unavailable|http_error|malformed|timeout"
    }[5m]
  )
) >= 10
```

Use the grouped breakdown before selecting a containment action:

```promql
sum by (outcome) (increase(ndsep_opa_decisions_total[5m]))
```

The exact OPA timeout ratio and target health expressions are:

```promql
100 * sum(increase(ndsep_opa_decisions_total{outcome="timeout"}[5m]))
/
clamp_min(sum(increase(ndsep_opa_decisions_total[5m])), 1)
```

```promql
up{job="opa"}
```

The present telemetry has a sum/count duration pair, so this produces a **mean**, not a percentile:

```promql
sum(rate(ndsep_opa_decision_duration_seconds_sum[$__rate_interval]))
/
clamp_min(sum(rate(ndsep_opa_decision_duration_seconds_count[$__rate_interval])), 0.001)
```

> Do not label OPA metrics by subject, role, route input, request ID, or source IP. Those values are sensitive and create high-cardinality metric series. The committed implementation intentionally limits the label to `outcome`.

## 2. Grafana panel configuration

Import or provision [`ndsep-edge-policy-security.json`](../../infra/grafana/dashboards/ndsep-edge-policy-security.json). It is preconfigured for the provisioned `Prometheus` datasource, UTC, a six-hour default view, 30-second refresh, and the dashboard UID `ndsep-edge-policy-security`.

| Panel                                           | Visualization | Exact query                                                                  | Unit and thresholds                                                                                                                           |
| ----------------------------------------------- | ------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **APISIX 429 Saturation Ratio**                 | Time series   | 429 ratio query above                                                        | Percent; orange at **2%**, red at **10%**. Use last and max legend values.                                                                    |
| **APISIX 429 Events (5m)**                      | Stat          | `sum(increase(apisix_http_status{code="429"}[5m]))`                          | Short; orange at **20**, red at **50**.                                                                                                       |
| **APISIX Metrics Availability**                 | Stat          | `up{job="apisix"}`                                                           | Value mapping `1=UP` green, `0=SCRAPE DOWN` red; background color.                                                                            |
| **OPA Fail-Closed Infrastructure Denials (5m)** | Time series   | `sum by (outcome) (increase(ndsep_opa_decisions_total{outcome=~"unconfigured | unavailable                                                                                                                                   | http_error | malformed | timeout"}[5m]))` | Short; orange at **3**, red at **10**; stacked series disabled so individual failure modes remain visible. |
| **OPA Timeout Ratio (5m)**                      | Stat          | OPA timeout ratio above                                                      | Percent; orange at **1%**, red at **5%**.                                                                                                     |
| **OPA Service Availability**                    | Stat          | `up{job="opa"}`                                                              | Value mapping `1=UP` green, `0=OPA DOWN` red; background color.                                                                               |
| **OPA Mean Decision Duration**                  | Time series   | OPA duration mean above                                                      | Seconds; orange at **0.75 s**, red at **1.25 s**. These are operational early-warning thresholds, not a replacement for the hard API timeout. |
| **OPA Decision Rate by Outcome**                | Time series   | `sum by (outcome) (rate(ndsep_opa_decisions_total[$__rate_interval]))`       | Short; inspect `allow`, normal `deny`, and each infrastructure outcome independently.                                                         |

A dashboard warning is not automatically an incident. The production conditions remain authoritative: 429 warning requires both >2% for five minutes and at least 20 events, 429 critical requires >10% for two minutes and at least 50 events, and the OPA critical spike requires at least 10 infrastructure-failure outcomes in five minutes.[1]

## 3. Controlled execution of `verify-staging-opa-amr.ts`

The workflow runs only after a successful staging deployment or an explicitly approved manual dispatch, from the self-hosted `ndsep-staging-internal` runner. It requires staging-only secrets for a no-MFA token, an MFA token, an internal OPA test endpoint, a public staging base URL, and a **separate predeployed outage-canary API**. It must never pause shared staging OPA.[2]

### Healthy expected output

The duration values are intentionally variable. The following is the expected output shape, not a fabricated timing result.

```text
PASS OPA-01: 403 in <milliseconds>ms
PASS AMR positive control: 200 in <milliseconds>ms
PASS OPA-02: direct policy decision denied without MFA
PASS OPA-03: outage denied in <milliseconds>ms
```

Exit code: `0`.

### OPA timeout simulation: expected secure pass

The only approved automated OPA timeout simulation uses the isolated outage-canary API. That canary has its OPA URL deliberately black-holed; its own server-side OPA client reaches its bounded policy timeout and returns a fail-closed 403. The verifier sees the **403**, not a client timeout, and therefore the correct output is:

```text
PASS OPA-01: 403 in <milliseconds>ms
PASS AMR positive control: 200 in <milliseconds>ms
PASS OPA-02: direct policy decision denied without MFA
PASS OPA-03: outage denied in <milliseconds>ms
```

Exit code: `0`. This proves that an OPA dependency timeout is denied rather than bypassed.

If the outage-canary unexpectedly returns success, the verifier fails closed with a nonzero exit:

```text
STAGING SECURITY VERIFICATION FAILED: OPA-03 OPA outage denial: expected HTTP 403, got 200; body=<bounded-and-redacted-response>
```

A public outage-canary endpoint that cannot be reached by the runner is a **test-environment failure**, not OPA-03 proof. The Node request guard aborts at eight seconds; its exact runtime wording can vary, but the log begins:

```text
STAGING SECURITY VERIFICATION FAILED: <network-or-abort-error>
```

Exit code: `1`. Investigate DNS, Caddy/TLS, runner routing, or the canary deployment. Do not mark OPA fail-closed verified from that result.

### Missing or unacceptable AMR claim

The verifier decodes the JWT payload locally only to check the fixture shape before it sends any request. It does not treat decoding as signature validation; the successful end-to-end privileged positive control is the signature-verified proof.

For an MFA fixture token with no allowed `amr` entry (`mfa`, `otp`, `webauthn`, `hwk`, or `fido2`), it stops before OPA-01 and emits:

```text
STAGING SECURITY VERIFICATION FAILED: MFA fixture token has no accepted AMR value; do not bypass this gate
```

Exit code: `1`.

For a no-MFA fixture that erroneously contains an accepted AMR method, it emits:

```text
STAGING SECURITY VERIFICATION FAILED: OPA-01 fixture token unexpectedly carries an accepted MFA AMR value
```

Exit code: `1`.

For a corrupt token, the corresponding failure is:

```text
STAGING SECURITY VERIFICATION FAILED: token is not a JWT
```

Exit code: `1`.

No bearer token, full payload, OPA credential, or OTP seed is printed by the verifier. GitHub’s staging environment must also mask the named secrets.

## 4. Critical incident execution

### A. `APISIXGatewayMetricsDown`

The alert fires when `up{job="apisix"} == 0` for two minutes. This may be gateway loss, an internal listener failure, a Prometheus networking/scrape error, or a configuration failure; do not assume the public edge is unavailable.

|         Time | Action                                                                                                                                                                       | Required evidence / decision                                                   |
| -----------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
|  0–5 minutes | Acknowledge the P1 alert, open an incident, assign an incident commander and communications lead, record release SHA and recent Caddy/APISIX changes.                        | PagerDuty acknowledgement and ticket ID.                                       |
|  0–5 minutes | Compare Prometheus target status with a second source: internal APISIX health/access logs, Caddy status, and upstream provider dashboard.                                    | Distinguish **metrics-only** loss from **data-plane** loss.                    |
| 5–15 minutes | If metrics-only, inspect the APISIX internal `9091` listener, Prometheus internal network path, scrape config, and APISIX Prometheus plugin.                                 | Never expose `9091` externally as a workaround.                                |
| 5–15 minutes | If data plane is impaired, preserve origin allow-list and upstream provider protections. Roll back only the last verified APISIX/Caddy change through normal change control. | Preserve pre/post configuration hashes and bounded logs.                       |
|     Recovery | Confirm `up{job="apisix"}=1`, a successful internal scrape, normal 429/connection/latency telemetry, then observe for 15 minutes.                                            | Record resolution and schedule post-incident review within five business days. |

Do **not** disable APISIX limits, publish the APISIX Admin API, or reconfigure Caddy to trust arbitrary client forwarding headers during the event.

### B. `OPAFailClosedDenialsSpike`

The alert fires at ten or more `unconfigured`, `unavailable`, `http_error`, `malformed`, or `timeout` outcomes over five minutes for two minutes. Treat it as an authorization-availability P1: privileged mutations, exports, approvals, and deletes are intentionally denied.

|         Time | Action                                                                                                                                                                                                                                                                                                                                      | Required evidence / decision                                                     |
| -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
|  0–5 minutes | Acknowledge, open incident, announce privileged-operation restriction, freeze privileged deployment and policy changes except a reviewed rollback.                                                                                                                                                                                          | Incident timeline; no OPA bypass.                                                |
|  0–5 minutes | Query `sum by (outcome) (increase(ndsep_opa_decisions_total[5m]))`, `up{job="opa"}`, and OPA mean duration. Capture release SHA, policy bundle/image hash, and redacted logs.                                                                                                                                                               | Classify `unconfigured`, `unavailable`, `timeout`, `http_error`, or `malformed`. |
| 5–15 minutes | For `unconfigured`, restore the approved manifest/secret reference. For `unavailable`, repair OPA process, DNS, service routing, or network policy. For `timeout`, inspect resource saturation and recent bundle changes; roll back verified policy/image or scale after review. For `malformed`, revert to the last verified bundle/image. | Keep the fail-closed timeout; do not extend it or return allow on error.         |
|     Recovery | Verify an internal OPA request returns literal `{"result":false}` with `mfaVerified:false`; run the external no-MFA 403 canary and fresh-MFA positive control; observe 15 minutes with zero new infrastructure-failure outcomes.                                                                                                            | All three checks plus stable metrics are mandatory before closure.               |

If a suspected security incident involves credentials, preserve audit evidence and engage Security. If regulated data or statutory services are affected, add the designated compliance/legal contact per the existing incident policy. Routine OPA `deny` results do not by themselves indicate infrastructure failure.

## References

[1] [NDSEP production alert rules](../../infra/prometheus/alerts.yml)
[2] [Staging authorization verification workflow](../../.github/workflows/staging-authorization-verification.yml)
[3] [NDSEP APISIX/OPA production incident response](./APISIX_OPA_PRODUCTION_ALERTING_AND_INCIDENT_RESPONSE.md)
