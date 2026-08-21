# Kubernetes Monitoring Deployment and OPA P1 Drill

**Scope:** Deploy the Grafana dashboard and Prometheus alert rules in [`edge-policy-observability.yaml`](../../infra/k8s/monitoring/base/edge-policy-observability.yaml), then execute a bounded **staging-only** exercise of the `OPAFailClosedDenialsSpike` incident response.

> **Safety boundary:** The exercise uses a predeployed, isolated `ndsep-api-opa-outage-canary` deployment whose OPA dependency is intentionally unreachable. It must never pause, scale, restart, patch, delete, or reconfigure shared OPA, APISIX, Caddy, Prometheus, or the normal NDSEP API. The script is non-mutating in its default `plan` mode.

## 1. Kubernetes deployment prerequisites

The Kubernetes manifest assumes the following capabilities already exist in the target cluster. These are cluster/platform prerequisites, not resources the manifest attempts to install implicitly.

| Capability                | Required configuration                                                                                                                                       | Verification command                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Grafana dashboard sidecar | Grafana sidecar watches ConfigMaps labeled `grafana_dashboard: "1"`; it may need all-namespace watch access to observe `ndsep`.                              | `kubectl -n monitoring get deploy -l app.kubernetes.io/name=grafana -o yaml` |
| Prometheus Operator       | The CRD `monitoring.coreos.com/v1/PrometheusRule` exists and the selected Prometheus instance matches `release: kube-prometheus-stack`.                      | `kubectl get crd prometheusrules.monitoring.coreos.com`                      |
| NDSEP API metrics         | Prometheus scrapes `/api/metrics`, which exports `ndsep_opa_decisions_total`.                                                                                | Query `up{job="ndsep-api"}` in Grafana/Prometheus.                           |
| APISIX and OPA metrics    | Prometheus scrapes APISIX internally at `/apisix/prometheus/metrics` and OPA internally at `/metrics`.                                                       | Query `up{job="apisix"}` and `up{job="opa"}`.                                |
| Isolated outage canary    | A separate staging API deployment is scraped by Prometheus, returns a policy 403 when its own black-holed OPA endpoint times out, and has no normal traffic. | `kubectl -n ndsep-staging get deploy ndsep-api-opa-outage-canary`            |

The Grafana ConfigMap uses the common sidecar label `grafana_dashboard: "1"` and is immutable. Update it through reviewed Git changes with a new ConfigMap name/version rather than by mutating a live dashboard payload. The PrometheusRule preserves the exact production alert expressions and label/severity scheme.[1]

## 2. Deploy the monitoring manifest

Set the namespace for the target environment. The current manifest is production-scoped (`ndsep`); use the reviewed staging overlay or change namespace through your deployment system for staging. Do not use `sed` substitution on a live shell copy.

```bash
export KUBE_CONTEXT='approved-ndsep-production-context'
export MONITORING_NAMESPACE='ndsep'
export MANIFEST='infra/k8s/monitoring/base/edge-policy-observability.yaml'

kubectl config use-context "${KUBE_CONTEXT}"
kubectl config current-context
kubectl auth can-i create configmaps --namespace "${MONITORING_NAMESPACE}"
kubectl auth can-i create prometheusrules.monitoring.coreos.com --namespace "${MONITORING_NAMESPACE}"
kubectl get namespace "${MONITORING_NAMESPACE}"
kubectl get crd prometheusrules.monitoring.coreos.com
```

Run a server-side dry run before changing the cluster. This validates admission against the actual cluster, including the PrometheusRule CRD.

```bash
kubectl apply --server-side --dry-run=server \
  -f "${MANIFEST}"
```

After an approved change ticket, apply and verify the resources.

```bash
kubectl apply --server-side -f "${MANIFEST}"

kubectl -n "${MONITORING_NAMESPACE}" get configmap \
  ndsep-grafana-dashboard-edge-policy-security \
  -o jsonpath='{.metadata.labels.grafana_dashboard}{"\n"}'

kubectl -n "${MONITORING_NAMESPACE}" get prometheusrule \
  ndsep-edge-policy-security \
  -o yaml
```

Verify the Grafana sidecar has reconciled the dashboard and then use the Grafana search UI to open **NDSEP Edge and Policy Security**. Confirm that its datasource is the intended internal Prometheus instance, the dashboard UID is `ndsep-edge-policy-security`, and the APISIX/OPA availability panels show `UP` before treating the rollout as complete.

```bash
# Adjust the Grafana namespace/deployment selector to the cluster’s chart values.
kubectl -n monitoring logs deployment/kube-prometheus-stack-grafana \
  --since=10m | grep -Ei 'ndsep|dashboard|edge-policy'
```

> **Rollback:** Do not delete the entire monitoring release. Roll back only the reviewed GitOps revision or delete the two named resources after incident/change approval:
>
> ```bash
> kubectl -n "${MONITORING_NAMESPACE}" delete configmap ndsep-grafana-dashboard-edge-policy-security
> kubectl -n "${MONITORING_NAMESPACE}" delete prometheusrule ndsep-edge-policy-security
> ```
>
> If Argo CD is managing the path, revert the Git commit instead; otherwise self-heal will recreate the resources.

## 3. P1 OPA infrastructure-denial spike: dry-run procedure

### 3.1 Exercise controls

This drill validates that an **OPA infrastructure failure remains a denial** and is observed by Prometheus and Alertmanager. It does not validate that ordinary policy `deny` outcomes are incidents. Obtain an exercise ID, an incident commander, a communications lead, Security and Platform on-call coverage, and an approved staging window.

| Control        | Requirement                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Target         | `ndsep-staging` only; the script rejects any namespace without `staging`.                                                 |
| Canary         | Predeployed `ndsep-api-opa-outage-canary` only; no shared OPA modifications.                                              |
| Requests       | Default is 10 read-only `securityAudit.getLatest` requests; hard maximum is 20.                                           |
| Authentication | Dedicated short-lived staging MFA token only; never use a personal or production token.                                   |
| Observability  | Canary must be scraped by Prometheus, or no metric spike can be proven.                                                   |
| Stop condition | Any 2xx, any non-403 error, missing fail-closed envelope, normal API degradation, or unexpected shared OPA/APISIX impact. |

### 3.2 Run the non-mutating planning pass

This command performs no network request and no cluster operation. Attach its output to the change/exercise ticket.

```bash
cd /srv/ndsep
DRILL_MODE=plan \
  DRILL_NAMESPACE=ndsep-staging \
  DRILL_CANARY_DEPLOYMENT=ndsep-api-opa-outage-canary \
  ./scripts/security/drill-opa-infrastructure-denial-spike.sh
```

Expected opening line:

```text
OPA P1 DRILL PLAN (no requests or cluster mutations will be made)
```

### 3.3 Preflight the isolated canary

```bash
export DRILL_NAMESPACE='ndsep-staging'
export DRILL_CANARY_DEPLOYMENT='ndsep-api-opa-outage-canary'
export DRILL_CANARY_URL='https://opa-outage-canary.staging.ndsep.gov.ng'
export DRILL_PROMETHEUS_URL='https://prometheus.staging.ndsep.gov.ng'
export DRILL_MFA_TOKEN='obtain-from-protected-staging-secret-store'
export DRILL_REQUEST_COUNT='10'
export DRILL_OBSERVE_SECONDS='150'

kubectl config current-context
kubectl -n "${DRILL_NAMESPACE}" get deployment "${DRILL_CANARY_DEPLOYMENT}"
kubectl -n "${DRILL_NAMESPACE}" rollout status \
  "deployment/${DRILL_CANARY_DEPLOYMENT}" --timeout=60s

# Read-only baseline checks. All must return expected health before the drill.
curl --silent --show-error --fail --get \
  --data-urlencode 'query=up{job="opa"}' \
  "${DRILL_PROMETHEUS_URL}/api/v1/query"

curl --silent --show-error --fail --get \
  --data-urlencode 'query=up{job="ndsep-api"}' \
  "${DRILL_PROMETHEUS_URL}/api/v1/query"
```

Record the current policy bundle/image digest, normal staging API release SHA, and dashboard baseline. Do not proceed if `up{job="opa"}` is already zero or the normal API is already degraded; the exercise would create ambiguous evidence.

### 3.4 Execute the bounded canary-only drill

The explicit confirmation phrase is required. The script only performs `kubectl get`, `kubectl rollout status`, bounded HTTPS requests to the isolated canary, and a read-only Prometheus query. It has no Kubernetes mutating command.

```bash
DRILL_MODE=execute \
CONFIRM_ISOLATED_OPA_CANARY=YES \
DRILL_NAMESPACE="${DRILL_NAMESPACE}" \
DRILL_CANARY_DEPLOYMENT="${DRILL_CANARY_DEPLOYMENT}" \
DRILL_CANARY_URL="${DRILL_CANARY_URL}" \
DRILL_PROMETHEUS_URL="${DRILL_PROMETHEUS_URL}" \
DRILL_MFA_TOKEN="${DRILL_MFA_TOKEN}" \
DRILL_REQUEST_COUNT="${DRILL_REQUEST_COUNT}" \
DRILL_OBSERVE_SECONDS="${DRILL_OBSERVE_SECONDS}" \
./scripts/security/drill-opa-infrastructure-denial-spike.sh
```

Expected execution shape:

```text
Checking isolated canary deployment ndsep-api-opa-outage-canary in ndsep-staging...
Starting bounded outage-canary exercise opa-p1-drill-<UTC timestamp>; no shared service will be mutated.
PASS outage-canary request 1/10: HTTP 403
...
PASS outage-canary request 10/10: HTTP 403
Waiting 150s for Prometheus scrape/rule evaluation; expected query: sum(increase(...[5m]))
PASS Prometheus query returned successfully; verify the numeric result is >= 10 and the alert state is Pending/Firing.
DRILL COMPLETE: attach the redacted metrics response, alert timeline, and normal-api canary evidence to opa-p1-drill-<UTC timestamp>.
```

A successful Prometheus HTTP response alone is not the final acceptance criterion. In Grafana/Prometheus, verify the numeric result of the exact query is at least `10`:

```promql
sum(
  increase(
    ndsep_opa_decisions_total{
      outcome=~"unconfigured|unavailable|http_error|malformed|timeout"
    }[5m]
  )
)
```

Then verify the `OPAFailClosedDenialsSpike` rule becomes **Pending** and, after its two-minute `for` duration, **Firing**. Alert delivery must appear in the configured critical route (PagerDuty and the critical Slack channel) during the controlled exercise. Do not escalate a simulated alert outside the exercise channel unless the normal staging API is actually affected.

### 3.5 Incident-commander decision sequence

1. Acknowledge the simulated P1, record the first-fire timestamp, release SHA, policy/image digest, exercise ID, and affected canary route.
2. Confirm `sum by (outcome) (increase(ndsep_opa_decisions_total[5m]))` attributes the spike to a non-normal infrastructure outcome, not ordinary `deny`.
3. Verify the normal staging API remains healthy. Run the existing staging verifier with protected staging secrets; it must obtain a normal no-MFA 403, MFA positive control success, direct OPA policy `false` for no-MFA, and outage-canary 403.[2]
4. Confirm no shared OPA pod restart, APISIX/Caddy configuration drift, or change to `OPA_ENABLED` occurred. Preserve redacted metrics and logs.
5. Let the 5-minute increase window age out. The alert should resolve automatically after the condition is no longer met. No rollback is required because the script has not changed shared infrastructure.
6. Close only after the normal API remains healthy, normal authorization canaries succeed, and the event timeline has been attached to the exercise ticket.

### 3.6 Stop and containment actions

| Condition                                          | Immediate action                                                                                                           | Prohibited shortcut                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Any outage-canary request returns 2xx              | Stop the script; declare a real fail-closed regression; freeze promotion and investigate canary configuration.             | Do not accept a plausible response as evidence or disable OPA.                 |
| Canary request is not 403 or lacks policy envelope | Stop; preserve its bounded response/log correlation ID; fix the canary before retrying.                                    | Do not increase request count or test shared OPA.                              |
| Prometheus query has no increment                  | Stop after the observation window; verify canary API scraping and `/api/metrics` telemetry before retrying.                | Do not fabricate samples or edit alert thresholds.                             |
| Normal staging API or shared OPA is degraded       | Stop drill; convert to a real incident and follow the P1 playbook.                                                         | Do not continue exercise traffic or change the timeout to obtain availability. |
| Alert fails to deliver                             | Preserve alert state and routing evidence; validate Alertmanager receiver/inhibition configuration through change control. | Do not make metrics endpoints public to debug delivery.                        |

## References

[1] [Kubernetes edge-policy observability manifest](../../infra/k8s/monitoring/base/edge-policy-observability.yaml)
[2] [Staging OPA and AMR verifier](../../scripts/security/verify-staging-opa-amr.ts)
[3] [APISIX/OPA production incident response](./APISIX_OPA_PRODUCTION_ALERTING_AND_INCIDENT_RESPONSE.md)
