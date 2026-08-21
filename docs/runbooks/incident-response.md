# NDSEP Incident Response Runbook

## Severity Levels

| Level     | Description                                   | Response Time     | Escalation                                     |
| --------- | --------------------------------------------- | ----------------- | ---------------------------------------------- |
| **SEV-1** | Platform down, data breach, financial loss    | 15 min            | Immediate page to on-call + NITDA notification |
| **SEV-2** | Major feature degraded (payments, compliance) | 30 min            | Page on-call engineer                          |
| **SEV-3** | Minor feature issue, non-critical worker down | 2 hours           | Slack alert                                    |
| **SEV-4** | Cosmetic, logging noise                       | Next business day | Ticket                                         |

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

**Alert:** TigerBeetle health check failing or `financial_transfer_outbox` quarantine backlog increasing.

> **Safety rule:** PostgreSQL is not a substitute for the authoritative TigerBeetle ledger. Do not enable a fallback that presents a PostgreSQL row as a committed ledger transfer. New funds movement must be stopped or held in durable `reconciliation_required` state until the ledger authority is restored or an approved reconciliation decision is recorded.

### Immediate Containment

```bash
# Freeze new NIP/RTGS initiation at the gateway/feature flag layer.
kubectl -n ndsep scale deploy/ndsep-api --replicas=0

# Preserve evidence; do not delete or replay outbox rows.
kubectl -n ndsep logs deploy/ndsep-api --since=30m > /secure/evidence/ndsep-api-tigerbeetle-$(date -u +%Y%m%dT%H%M%SZ).log
```

If the API cannot be scaled down because it serves non-financial traffic, apply the approved funds-mutation deny policy instead and verify that ordinary read endpoints remain available.

### Diagnosis

```bash
kubectl -n ndsep get pods -l app=tigerbeetle -o wide
kubectl -n ndsep describe pods -l app=tigerbeetle
kubectl -n ndsep logs -l app=tigerbeetle --since=30m
kubectl -n ndsep logs -l app=ndsep-api --since=30m | grep "FinancialOutbox\|reconciliation_required\|TigerBeetle"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT state, count(*)
FROM financial_transfer_outbox
GROUP BY state
ORDER BY state;
SELECT transfer_reference, state, attempts, last_error, updated_at
FROM financial_transfer_outbox
WHERE state IN ('reconciliation_required','dead_letter')
ORDER BY updated_at;
SQL
```

### Resolution and Reconciliation

1. **Quorum or pod failure:** restore TigerBeetle quorum, verify cluster identity and replica health, and do not dispatch new funds until the immutable-reference lookup endpoint is healthy.
2. **For each quarantined transfer:** record the incident ID, actor, reference, amount, currency, and timestamps. Query TigerBeetle and Mojaloop independently by the immutable transfer reference. Never infer success from an HTTP timeout or client exception.
3. **Both providers `not_found`:** the reconciler may return the intent to `pending`; dispatch one time under the original reference and monitor the resulting signed callback.
4. **TigerBeetle `committed`, Mojaloop `not_found`:** the reconciler may reissue only the missing Mojaloop leg with the original immutable reference. Record the provider response and keep the item quarantined if the reissue is ambiguous.
5. **TigerBeetle `pending`, Mojaloop `not_found`:** keep the item in manual review/dead-letter state. Do not release or replay the payment.
6. **Mojaloop exists while TigerBeetle is absent, provider conflict, malformed response, timeout, or unauthorized lookup:** keep the item in manual review/dead-letter state and escalate to the payment operations owner.
7. **Manual release:** requires two-person approval from payment operations and financial control, with provider evidence attached. Operators must use a purpose-built audited reconciliation command; direct SQL state edits are prohibited.
8. **Recovery:** after the backlog is cleared or explicitly dispositioned, restore the API deployment, run a read-only health check, then execute one controlled canary transfer with provider approval before lifting the funds-movement freeze.

### Abort Criteria

Abort recovery if provider states disagree, an immutable-reference lookup is unavailable, a callback fails mTLS/HMAC verification, the reconciliation evidence is incomplete, or any operator would need to edit settlement state directly in SQL.

---

## Runbook: Financial Transfer Quarantine (SEV-1)

**Trigger:** an outbox row enters `reconciliation_required` after a dispatch timeout/error, or enters `dead_letter` after provider conflict or manual review.

### Step 1 — Declare and contain

Declare a SEV-1 financial-integrity incident, assign an incident commander, payment-operations lead, ledger owner, database operator, and security/compliance observer. Freeze new NIP/RTGS/SWIFT initiation through the approved policy control. Do not restart the dispatcher repeatedly, delete rows, reset attempts, or run blind retries.

### Step 2 — Capture immutable evidence

Capture UTC timestamps, deployment versions, worker IDs, transfer references, outbox state/attempt/lease fields, provider correlation IDs, callback event IDs, and sanitized logs. Hash exported evidence and place it in the incident record. Do not include secrets, account credentials, or unnecessary personal data.

```sql
SELECT id, transfer_reference, transfer_kind, amount_minor, currency, state,
       attempts, lease_owner, lease_expires_at, last_error, created_at, updated_at
FROM financial_transfer_outbox
WHERE state IN ('reconciliation_required','dead_letter')
ORDER BY updated_at;

SELECT transfer_reference, provider, observed_state, response_sha256,
       action, detail, created_at
FROM financial_provider_reconciliation
WHERE transfer_reference = :'reference'
ORDER BY created_at;
```

### Step 3 — Establish provider truth

Query both provider adapters by the exact immutable reference. Record the raw provider correlation ID and normalized result in the reconciliation evidence table. Treat timeout, TLS failure, malformed JSON, 401/403, and 5xx as **unknown**, never as `not_found`.

### Step 4 — Apply the state decision

Use the TigerBeetle/Mojaloop decision table in the ledger-failure section above. Only an authoritative `not_found` from both providers permits re-queueing. Only `committed` TigerBeetle plus authoritative Mojaloop absence permits a single missing-leg reissue. Every conflict, pending ledger state, or ambiguous response remains manual review/dead-letter.

### Step 5 — Approve and execute recovery

Require two independent approvers. The operator executes the audited reconciliation worker or approved command, not a direct SQL update. Monitor the original reference, callback HMAC/mTLS result, ledger state, and outbox transition. Confirm there is no duplicate provider transfer before closing the incident.

### Step 6 — Validate and close

Lift the freeze only after the provider owners confirm healthy lookups, the quarantine queue is zero or explicitly dispositioned, the canary transfer is reconciled, and security/compliance sign off. Schedule a post-incident review covering acknowledgment loss, alerting, lease behavior, and any control failure.

### Severity and escalation

A single ambiguous transfer is SEV-1 until provider truth is established. Multiple quarantines, any provider conflict, any unauthorized callback, or any duplicate settlement suspicion requires immediate executive, security, financial-control, and regulatory escalation under the applicable incident policy.

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
