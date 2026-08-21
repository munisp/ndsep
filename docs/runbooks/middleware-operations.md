# NDSEP Middleware Operations Runbook

## Service Dependency Map

```
Client → APISIX (gateway) → OpenAppSec (WAF) → ndsep-api
                                                   ├── PostgreSQL (primary store)
                                                   ├── Redis (cache + rate limiting)
                                                   ├── Kafka → consumers → workers
                                                   ├── Temporal (workflow orchestration)
                                                   ├── TigerBeetle (financial ledger)
                                                   ├── OpenSearch (full-text search)
                                                   ├── Keycloak (OIDC auth)
                                                   ├── Permify (ReBAC authorization)
                                                   ├── Mojaloop (payment switching)
                                                   ├── Dapr (service mesh)
                                                   ├── Fluvio (edge streaming)
                                                   └── Lakehouse (MinIO + Iceberg)
```

## Startup Order

Services must start in this order (enforced by Docker Compose `depends_on`):

1. **PostgreSQL** → foundation for all state
2. **Redis** → cache and rate limiting
3. **Kafka** → event backbone
4. **Keycloak** → auth provider (needs PG)
5. **Permify** → authorization (needs PG)
6. **Temporal** → workflows (needs PG)
7. **OpenSearch** → search index
8. **TigerBeetle** → financial ledger
9. **APISIX** → API gateway
10. **OpenAppSec** → WAF
11. **Mojaloop** → payment hub
12. **MinIO + Iceberg** → lakehouse storage
13. **Dapr sidecar** → service mesh
14. **Fluvio** → edge streaming
15. **NDSEP API** → application server (needs all above)
16. **Workers** → background processing

## PostgreSQL Operations

### Backup

```bash
# Automated daily backups (configured in infra/postgres/backup-cron.conf)
scripts/backup-postgres.sh

# Manual backup
pg_dump -h postgres -U ndsep_user -d ndsep_db -Fc > backup_$(date +%Y%m%d).dump

# Restore
pg_restore -h postgres -U ndsep_user -d ndsep_db backup_YYYYMMDD.dump
```

### Connection Pool Tuning

| Param | Dev | Production |
|-------|-----|------------|
| `max_connections` | 100 | 500 |
| PgBouncer `default_pool_size` | 20 | 50 |
| PgBouncer `reserve_pool_size` | 5 | 15 |

### Index Maintenance

```sql
-- Check unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;

-- Check bloated tables
SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::text))
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(tablename::text) DESC LIMIT 20;
```

## Redis Operations

### Cache Invalidation

```bash
# Flush specific namespace
redis-cli KEYS "ndsep:cache:*" | xargs redis-cli DEL

# Check memory
redis-cli INFO memory
```

### Rate Limiter

The Redis-backed rate limiter uses sliding window counters. If Redis is down, falls back to in-memory.

## Kafka Operations

### Topic Management

```bash
# List topics
kafka-topics.sh --bootstrap-server kafka:9092 --list

# Check consumer lag
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group ndsep-consumer --describe

# Reset consumer offset (use with caution)
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group ndsep-consumer --topic ndsep-events --reset-offsets --to-latest --execute
```

### DLQ Processing

Failed messages go to `ndsep-dlq` topic. The DLQ processor retries with exponential backoff.

```bash
# Check DLQ depth
kafka-run-class.sh kafka.tools.GetOffsetShell --broker-list kafka:9092 --topic ndsep-dlq
```

## Temporal Operations

### Workflow Management

```bash
# List running workflows
tctl workflow list --namespace ndsep

# Describe workflow
tctl workflow describe --namespace ndsep --workflow_id <id>

# Terminate stuck workflow
tctl workflow terminate --namespace ndsep --workflow_id <id> --reason "manual cleanup"
```

### Registered Workflow Types

- `enforcement-lifecycle` — Penalty escalation (30d → final notice → sanctions)
- `breach-response` — 72h NDPA incident response timeline
- `compliance-audit` — Audit lifecycle with auto-scoring
- `dsar-fulfillment` — Data subject request processing

## TigerBeetle Operations

TigerBeetle is the financial ledger for NIP/RTGS transfers. If unavailable, the system falls back to the PostgreSQL `financial_ledger` table.

### Health Check

```bash
# TB health via NDSEP API
curl -s http://ndsep-api:5000/api/trpc/tigerbeetleLedger.health | jq .
```

## Keycloak Operations

### Realm Export/Import

```bash
# Export realm
/opt/keycloak/bin/kc.sh export --realm ndsep --file /tmp/ndsep-realm.json

# Import realm
/opt/keycloak/bin/kc.sh import --file /tmp/ndsep-realm.json
```

## Scaling Guidelines

| Service | Scaling Strategy | When |
|---------|-----------------|------|
| ndsep-api | Horizontal (HPA) | CPU > 70% or p95 > 1s |
| PostgreSQL | Vertical + read replicas | Connections > 80% max |
| Redis | Vertical (memory) | Memory > 80% |
| Kafka | Add partitions | Consumer lag > 10K |
| Temporal | Add worker replicas | Workflow queue depth > 1000 |
| OpenSearch | Add data nodes | Index size > 100GB |
