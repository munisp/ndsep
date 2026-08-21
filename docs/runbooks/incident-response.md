# NDSEP Incident Response Runbook

## Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **SEV-1** | Platform down, data breach, financial loss | 15 min | Immediate page to on-call + NITDA notification |
| **SEV-2** | Major feature degraded (payments, compliance) | 30 min | Page on-call engineer |
| **SEV-3** | Minor feature issue, non-critical worker down | 2 hours | Slack alert |
| **SEV-4** | Cosmetic, logging noise | Next business day | Ticket |

## Runbook: API Down (SEV-1)

**Alert:** `APIDown` — `up{job="ndsep-api"} == 0` for 1 minute

### Diagnosis

```bash
# Check pod status
kubectl -n ndsep get pods -l app=ndsep-api

# Check recent logs
kubectl -n ndsep logs -l app=ndsep-api --tail=100

# Check if DB is reachable
kubectl -n ndsep exec deploy/ndsep-api -- pg_isready -h postgres -U ndsep_user

# Check resource usage
kubectl -n ndsep top pods -l app=ndsep-api
```

### Resolution

1. **OOM Kill** → Increase memory limits in `infra/k8s/deployment.yaml`, redeploy
2. **DB connection exhausted** → Restart PgBouncer: `kubectl -n ndsep rollout restart deploy/pgbouncer`
3. **Certificate expired** → Renew with certbot: `kubectl -n ndsep exec deploy/certbot -- certbot renew`
4. **Bad deploy** → Rollback: `kubectl -n ndsep rollout undo deploy/ndsep-api`

---

## Runbook: High API Error Rate (SEV-2)

**Alert:** `HighAPIErrorRate` — 5xx rate > 5% for 5 minutes

### Diagnosis

```bash
# Find which endpoints are failing
kubectl -n ndsep logs -l app=ndsep-api --tail=500 | grep "status.*5[0-9][0-9]" | sort | uniq -c | sort -rn

# Check downstream health
curl -s http://ndsep-api:5000/api/health | jq .

# Check Kafka connectivity
kubectl -n ndsep exec deploy/ndsep-api -- nc -z kafka 9092
```

### Resolution

1. **Downstream service down** → Check specific service health, restart if needed
2. **Database slow queries** → Check `pg_stat_activity`, kill long-running queries
3. **Memory pressure** → Scale horizontally: `kubectl -n ndsep scale deploy/ndsep-api --replicas=4`

---

## Runbook: Database Connection Pool Exhaustion (SEV-2)

**Alert:** `DatabaseConnectionPoolExhaustion` — active connections > 80% of max

### Diagnosis

```bash
# Check active connections
kubectl -n ndsep exec deploy/postgres -- psql -U ndsep_user -d ndsep_db -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# Find long-running queries
kubectl -n ndsep exec deploy/postgres -- psql -U ndsep_user -d ndsep_db -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;"
```

### Resolution

1. Kill long-running queries: `SELECT pg_terminate_backend(pid);`
2. Increase PgBouncer pool size
3. Check for connection leaks in application code (missing `pool.release()`)

---

## Runbook: Kafka Consumer Lag (SEV-3)

**Alert:** `KafkaConsumerLagHigh` — consumer lag > 10,000 for 10 minutes

### Diagnosis

```bash
# Check consumer group lag
kubectl -n ndsep exec deploy/kafka -- kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group ndsep-consumer --describe

# Check consumer pod logs
kubectl -n ndsep logs -l app=ndsep-api --tail=100 | grep "kafka"
```

### Resolution

1. **Consumer crashed** → Restart consumer pod
2. **Throughput too low** → Scale consumer instances
3. **Poison message** → Check DLQ topic, skip or replay

---

## Runbook: TigerBeetle Ledger Failure (SEV-1)

**Alert:** TigerBeetle health check failing

### Diagnosis

```bash
# Check TigerBeetle pod
kubectl -n ndsep get pods -l app=tigerbeetle

# Verify PG fallback is active
kubectl -n ndsep logs -l app=ndsep-api --tail=50 | grep "TigerBeetle\|financial_ledger"
```

### Resolution

1. **PG fallback active** → Financial operations continue via PostgreSQL `financial_ledger` table
2. **Cluster quorum lost** → Check all TB replicas, restore from snapshot
3. **Disk full** → Expand PV or archive old data

---

## Runbook: Breach Incident (SEV-1)

**NDPA requirement:** Report within 72 hours of discovery

### Immediate Actions

1. **Contain:** Disable affected user accounts and API keys
2. **Assess:** Determine scope (affected records, data types, subjects)
3. **Notify:** NITDA via the NDSEP platform breach reporting workflow
4. **Log:** Create enforcement case in platform with full timeline

### Platform Actions

```bash
# Check breach detection logs
kubectl -n ndsep logs -l app=siem-correlator --tail=200

# Review recent anomalous activity
curl -s http://ndsep-api:5000/api/trpc/breachIncidents.list | jq '.result.data[-5:]'
```

---

## Runbook: Keycloak Authentication Failure (SEV-2)

### Diagnosis

```bash
kubectl -n ndsep logs -l app=keycloak --tail=100
curl -s http://keycloak:8080/realms/ndsep/.well-known/openid-configuration | jq .issuer
```

### Resolution

1. **Keycloak down** → Restart: `kubectl -n ndsep rollout restart deploy/keycloak`
2. **Realm misconfigured** → Re-import realm config
3. **Certificate expired** → Regenerate JWKS

---

## Runbook: Compliance SLA Breach (SEV-2)

**Alert:** `ComplianceSLABreach` — pending items exceed SLA window

### Resolution

1. Check DSAR deadline tracker: `kubectl -n ndsep logs -l app=dsar-deadline-tracker`
2. Review pending items in platform compliance dashboard
3. Escalate to compliance team if automated processing stalled

---

## Communication Template

```
Subject: [NDSEP SEV-{X}] {Brief description}

Status: {Investigating | Identified | Monitoring | Resolved}
Impact: {Description of user/business impact}
Timeline:
  - {HH:MM UTC} — Alert triggered
  - {HH:MM UTC} — Investigation started
  - {HH:MM UTC} — Root cause identified: {cause}
  - {HH:MM UTC} — Fix deployed
  - {HH:MM UTC} — Monitoring, system stable
Next Steps: {Post-incident review scheduled for ...}
```
