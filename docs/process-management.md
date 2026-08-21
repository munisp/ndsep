# NDSEP Process Management & Auto-Restart Architecture

## Overview

NDSEP uses a layered auto-restart and event-driven scaling architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  KEDA (Event-Driven Autoscaler)                             │
│  ├── Kafka consumer lag → scale workers                     │
│  ├── HTTP request rate (Prometheus) → scale API pods        │
│  ├── Redis queue depth → scale DLQ processor                │
│  └── Cron schedules → scale during WAT business hours       │
├─────────────────────────────────────────────────────────────┤
│  K8s Deployments (Pod Lifecycle)                            │
│  ├── restartPolicy: Always (auto-restart crashed pods)      │
│  ├── livenessProbe → detect hung processes, trigger restart │
│  ├── readinessProbe → gate traffic to healthy pods          │
│  ├── startupProbe → allow slow cold starts (60s window)     │
│  ├── preStop hook → drain connections before SIGTERM        │
│  └── PodDisruptionBudget → safe rolling updates             │
├─────────────────────────────────────────────────────────────┤
│  Process Level (Inside Container)                           │
│  ├── Go: signal.Notify(SIGTERM,SIGINT) + cleanup callbacks  │
│  ├── Rust: tokio::signal + graceful drain                   │
│  └── Python: signal.signal(SIGTERM) + shutdown event        │
└─────────────────────────────────────────────────────────────┘
```

## K8s Level: Pod Restarts

All Deployments use `restartPolicy: Always` (K8s default). If a process exits with non-zero, K8s restarts it with exponential backoff (10s, 20s, 40s... capped at 5min).

### Probes

| Probe | Path | Timing | Purpose |
|-------|------|--------|---------|
| Liveness | `/health` | every 30s, 3 failures | Detect hung processes → kill & restart |
| Readiness | `/health` | every 10s, 3 failures | Gate traffic → unhealthy pods get no requests |
| Startup | `/health` | every 5s, 12 failures | Allow 60s cold start before liveness kicks in |

### Graceful Termination Sequence

```
1. Pod marked for termination
2. preStop hook runs: sleep 5 (drain in-flight from load balancer)
3. SIGTERM sent to PID 1
4. Process handles SIGTERM → closes connections, flushes buffers
5. terminationGracePeriodSeconds countdown (30-60s)
6. If still alive → SIGKILL
```

## KEDA: Event-Driven Autoscaling

KEDA replaces basic HPA with intelligent scaling based on actual workload signals.

### Trigger Types

| Trigger | Workers | Topic/Metric | Threshold |
|---------|---------|-------------|-----------|
| **Kafka lag** | kyc-worker | `ndsep.kyc.updates` | 100 messages |
| **Kafka lag** | aml-worker | `ndsep.aml.cases` | 50 messages |
| **Kafka lag** | fraud-engine | `ndsep.financial.payments` | 50 messages |
| **Kafka lag** | payment-monitor | `ndsep.financial.payments` | 200 messages |
| **Kafka lag** | swift-processor | `ndsep.financial.payments` | 100 messages |
| **Kafka lag** | bgp-validator | `ndsep.network.events` | 200 messages |
| **Kafka lag** | evidence-signer | `ndsep.enforcement.actions` | 50 messages |
| **Kafka lag** | financial-ledger | `ndsep.tigerbeetle.ledger` | 100 messages |
| **Kafka lag** | residency-enforcer | `ndsep.compliance.violations` | 50 messages |
| **Kafka lag** | remediation-engine | `ndsep.breach.notifications` | 20 messages |
| **Kafka lag** | ml-prediction | `ndsep.ml.predictions` | 200 messages |
| **Kafka lag** | socint-processor | `ndsep.threat_intel.feeds` | 500 messages |
| **Kafka lag** | siem-processor | `ndsep.siem.alerts` | 100 messages |
| **HTTP rate** | ndsep-api | requests/s per pod | 50 req/s |
| **P95 latency** | ndsep-api | histogram_quantile | 500ms |
| **Redis queue** | dlq-processor | `ndsep:dlq:pending` | 50 items |
| **Cron** | cbn-reporter | WAT Mon-Fri 08-18 | 2 replicas |
| **Cron** | compliance-rescorer | WAT Mon-Fri 08-18 | 2 replicas |
| **Cron** | telecom-monitor | Daily 06-22 WAT | 1 replica |
| **Cron** | healthcare-monitor | Daily 06-22 WAT | 1 replica |

### Scale-to-Zero Workers

These workers scale to 0 pods outside their active window (cost savings):
- `cbn-reporter` — 0 pods outside Mon-Fri 08:00-18:00 WAT
- `compliance-rescorer` — 0 pods outside business hours
- `remediation-engine` — 0 pods when no breach events
- `citizen-sla-tracker` — 0 pods when no enforcement events
- `dlq-processor` — 0 pods when Redis DLQ is empty
- `telecom-monitor` — 0 pods overnight (22:00-06:00)
- `healthcare-monitor` — 0 pods overnight (22:00-06:00)

### Always-On Workers (Critical)

These never scale to zero:
- `ndsep-api` — min 2 pods (user-facing)
- `fraud-engine` — min 2 pods (real-time fraud scoring)
- `payment-monitor` — min 2 pods (financial transaction monitoring)
- `financial-ledger` — min 2 pods (ledger integrity)
- `energy-monitor` — min 1 pod (critical infrastructure 24/7)
- `evidence-signer` — min 1 pod (legal evidence chain)

## Process Level: Graceful Shutdown

### Go Workers (`workers/go/shared/shared.go`)

```go
// WaitForShutdown blocks until SIGTERM/SIGINT, runs cleanup, closes DB
func WaitForShutdown(workerID string, cleanup func())

// NewShutdownContext returns context cancelled on signal
func NewShutdownContext() (context.Context, context.CancelFunc)
```

Usage pattern:
```go
func main() {
    ctx, cancel := shared.NewShutdownContext()
    defer cancel()
    
    shared.StartHealthServer(workerID, port, &healthState)
    
    for {
        select {
        case <-ctx.Done():
            return  // graceful exit
        case <-ticker.C:
            doWork(ctx)
        }
    }
}
```

### Rust Workers (`workers/rust/shared/src/lib.rs`)

```rust
/// Wait for SIGTERM or SIGINT — use with tokio::select!
pub async fn wait_for_shutdown(worker_id: &str)
```

Usage pattern:
```rust
#[tokio::main]
async fn main() {
    let server = start_health_server(port);
    let worker = run_worker_loop();
    
    tokio::select! {
        _ = server => {},
        _ = worker => {},
        _ = shared::wait_for_shutdown("evidence-signer") => {
            // cleanup: flush pending signatures, close DB
        }
    }
}
```

### Python Workers (`workers/python/worker_base.py`)

```python
# register_shutdown sets SIGTERM/SIGINT handlers
shutdown_event = register_shutdown(worker_id, cleanup=close_connections)

# Main loop checks shutdown event
while not is_shutting_down():
    do_work()
    time.sleep(interval)
```

### Panic Recovery

| Language | Mechanism | Behavior |
|----------|-----------|----------|
| Go | `panicRecoveryMiddleware` in HTTP handlers | Catches panic, logs stack trace, returns 500, keeps process alive |
| Rust | `std::panic::set_hook` | Logs panic info, process exits → K8s restarts |
| Python | Exception handlers in worker loop | Catches all exceptions, logs, continues loop. Only `SystemExit` kills process |

## Installation

```bash
# 1. Install KEDA operator
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --values infra/k8s/keda-install.yaml

# 2. Apply trigger authentications
kubectl apply -f infra/k8s/keda-triggers.yaml

# 3. Apply ScaledObjects
kubectl apply -f infra/k8s/keda-scaledobjects.yaml

# 4. Verify
kubectl get scaledobjects -n ndsep
kubectl get hpa -n ndsep  # KEDA creates HPA resources
```

## Monitoring KEDA

```bash
# Check ScaledObject status
kubectl describe scaledobject fraud-engine-keda -n ndsep

# View KEDA metrics (exposed via Prometheus)
curl http://keda-operator.keda:8080/metrics | grep keda_

# Key metrics:
# keda_scaler_active{} — is scaler producing metrics?
# keda_scaler_metrics_value{} — current metric value
# keda_scaled_object_errors{} — errors in scaling decisions
```

## Kafka Topics (35 NDSEP Topics)

All workers consume from `ndsep.*` prefixed topics:

| Topic | Consumer Groups |
|-------|----------------|
| `ndsep.kyc.updates` | kyc-worker |
| `ndsep.aml.cases` | aml-worker |
| `ndsep.watchlist.hits` | aml-worker |
| `ndsep.financial.payments` | payment-monitor, fraud-engine, swift-processor |
| `ndsep.mojaloop.payments` | payment-monitor |
| `ndsep.compliance.events` | cbn-reporter |
| `ndsep.compliance.scores` | compliance-rescorer, ml-prediction |
| `ndsep.compliance.violations` | residency-enforcer |
| `ndsep.enforcement.actions` | evidence-signer |
| `ndsep.breach.notifications` | remediation-engine |
| `ndsep.network.events` | bgp-validator, energy-monitor |
| `ndsep.ml.predictions` | ml-prediction |
| `ndsep.tigerbeetle.ledger` | financial-ledger |
| `ndsep.fine.payments` | financial-ledger |
| `ndsep.dpco.enforcement` | citizen-sla-tracker |
| `ndsep.threat_intel.feeds` | socint-processor |
| `ndsep.siem.alerts` | siem-processor |
| `ndsep.siem.audit_logs` | siem-processor |
| `ndsep.sector.alerts` | telecom-monitor, healthcare-monitor, energy-monitor |
| `ndsep.audit.trail` | audit-archiver |
| `ndsep.dashboard.metrics` | metrics-aggregator |
