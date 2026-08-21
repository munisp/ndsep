# NDSEP Service Level Objectives (SLOs) & Indicators (SLIs)

## Platform-Wide SLOs

| SLO | Target | Measurement Window | SLI (Prometheus Query) |
|-----|--------|--------------------|----------------------|
| **Availability** | 99.9% (8.7h downtime/year) | 30-day rolling | `avg_over_time(up{job="ndsep-api"}[30d])` |
| **Latency (p95)** | < 500ms | 5-min rolling | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="ndsep-api"}[5m]))` |
| **Latency (p99)** | < 2000ms | 5-min rolling | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="ndsep-api"}[5m]))` |
| **Error Rate** | < 0.1% | 5-min rolling | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` |
| **Throughput** | > 100 req/s sustained | 5-min rolling | `rate(http_requests_total{job="ndsep-api"}[5m])` |

## Domain-Specific SLOs

### Compliance Operations

| SLO | Target | SLI |
|-----|--------|-----|
| Compliance score calculation | < 1s latency | `histogram_quantile(0.95, rate(ndsep_compliance_calculation_duration_seconds_bucket[5m]))` |
| DSAR response time | < 30 days (NDPA) | `ndsep_dsar_pending_duration_days > 25` triggers alert |
| Breach notification | < 72 hours (NDPA Art. 40) | `ndsep_breach_notification_delay_hours < 72` |
| Audit return processing | < 5s for score calculation | `histogram_quantile(0.99, rate(ndsep_audit_scoring_duration_seconds_bucket[5m]))` |

### Financial Operations (TigerBeetle / Mojaloop)

| SLO | Target | SLI |
|-----|--------|-----|
| NIP transfer latency | < 3s end-to-end | `histogram_quantile(0.95, rate(ndsep_nip_transfer_duration_seconds_bucket[5m]))` |
| RTGS transfer latency | < 10s end-to-end | `histogram_quantile(0.95, rate(ndsep_rtgs_transfer_duration_seconds_bucket[5m]))` |
| Transfer success rate | > 99.5% | `rate(ndsep_transfer_success_total[1h]) / rate(ndsep_transfer_total[1h])` |
| Ledger consistency | 0 discrepancies | `ndsep_ledger_discrepancy_total == 0` |

### Authentication & Authorization

| SLO | Target | SLI |
|-----|--------|-----|
| Keycloak auth latency | < 200ms (p95) | `histogram_quantile(0.95, rate(keycloak_request_duration_bucket{realm="ndsep"}[5m]))` |
| Permify check latency | < 50ms (p95) | `histogram_quantile(0.95, rate(ndsep_permify_check_duration_seconds_bucket[5m]))` |
| Auth availability | 99.95% | `avg_over_time(up{job="keycloak"}[30d])` |

### Search & Analytics

| SLO | Target | SLI |
|-----|--------|-----|
| OpenSearch query latency | < 200ms (p95) | `histogram_quantile(0.95, rate(opensearch_search_query_duration_seconds_bucket[5m]))` |
| Full-text search availability | 99.5% | `avg_over_time(up{job="opensearch"}[30d])` |
| Lakehouse query latency | < 30s for analytical queries | `histogram_quantile(0.95, rate(ndsep_lakehouse_query_duration_seconds_bucket[5m]))` |

## Middleware SLOs

| Service | Availability Target | Latency Target (p95) | Error Budget (30d) |
|---------|--------------------|--------------------|-------------------|
| PostgreSQL | 99.99% | < 10ms (simple), < 100ms (complex) | 4.3 min |
| Redis | 99.9% | < 5ms | 43.2 min |
| Kafka | 99.9% | < 100ms (produce) | 43.2 min |
| Temporal | 99.5% | < 500ms (start workflow) | 3.6 hr |
| TigerBeetle | 99.9% (PG fallback: 99.99%) | < 10ms | 43.2 min |
| OpenSearch | 99.5% | < 200ms | 3.6 hr |
| Keycloak | 99.95% | < 200ms | 21.6 min |
| Permify | 99.9% | < 50ms | 43.2 min |
| APISIX | 99.99% | < 5ms (overhead) | 4.3 min |
| OpenAppSec | 99.9% | < 10ms (overhead) | 43.2 min |
| Mojaloop | 99.5% | < 3s (transfer) | 3.6 hr |
| Dapr | 99.9% | < 20ms (overhead) | 43.2 min |
| Fluvio | 99.0% | < 100ms | 7.2 hr |
| Lakehouse | 99.0% | < 30s (analytical) | 7.2 hr |

## Error Budget Policy

- **Budget > 50% remaining:** Normal development velocity, deploy at will
- **Budget 25-50% remaining:** Reduce deploy frequency, increase testing
- **Budget < 25% remaining:** Freeze non-critical deploys, focus on reliability
- **Budget exhausted:** All engineering effort shifts to reliability until budget recovers

## Alerting Thresholds

Alerts fire at burn rates that would exhaust the error budget:

| Window | Burn Rate | Action |
|--------|-----------|--------|
| 5 min | 14.4x (budget gone in 1h) | Page on-call (SEV-1) |
| 30 min | 6x (budget gone in 5h) | Page on-call (SEV-2) |
| 6 hr | 1x (budget tracking to exhaust) | Slack alert (SEV-3) |

These are configured in `infra/prometheus/alerts.yml`.
