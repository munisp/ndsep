# NDSEP Disaster Recovery Plan

## Overview

This document defines the backup, recovery, and business continuity procedures for the NDSEP platform in compliance with NDPA 2023 Section 29 (Security Measures).

## Recovery Objectives

| Metric | Target | Mechanism |
|--------|--------|-----------|
| **RPO** (Recovery Point Objective) | < 15 minutes | WAL archiving (continuous) + hourly pg_dump |
| **RTO** (Recovery Time Objective) | < 1 hour | Automated restore from latest backup |
| **Backup Retention** | 30 days | Local + S3 with lifecycle policy |
| **Restore Testing** | Weekly | Automated restore-to-temp-DB verification |

## Backup Strategy

### 1. Hourly Full Backup (pg_dump)

```bash
# Runs every hour via cron / Docker pg-backup service
./scripts/backup-postgres.sh --upload-s3
```

- Compressed with gzip -9
- SHA-256 checksum for integrity verification
- Optional AES-256-CBC encryption at rest (via `ENCRYPTION_KEY`)
- Uploaded to S3 with SSE-KMS encryption
- 30-day retention with automatic cleanup

### 2. Continuous WAL Archiving (PITR)

PostgreSQL Write-Ahead Logs are archived every 5 minutes (or when a 16MB segment fills). This enables Point-in-Time Recovery to any moment within the retention window.

Configuration: `infra/postgres/wal-archiving.conf`

```
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://BUCKET/wal/%f --sse aws:kms'
archive_timeout = 300
```

### 3. Cross-Region Replication (Production)

For production deployments with 500K+ controllers:

1. **Primary**: AWS af-south-1 (Cape Town) or eu-west-1 (Ireland)
2. **Read Replica**: Different region for disaster recovery
3. **Streaming replication** via PostgreSQL native replication slots

## Recovery Procedures

### Restore from Latest Backup

```bash
./scripts/restore-postgres.sh --latest
```

### Restore from S3

```bash
./scripts/restore-postgres.sh --from-s3 ndsep-backups/2026/05/ndsep_db_20260501_120000.sql.gz
```

### Point-in-Time Recovery

```bash
# Restore to a specific timestamp
./scripts/restore-postgres.sh --pitr "2026-05-01 12:00:00"
```

### Verify Backup Integrity

```bash
./scripts/backup-postgres.sh --verify
```

## Docker Compose Backup Service

The `pg-backup` service in `docker-compose.production.yml` automatically:

1. Runs an initial backup on startup
2. Schedules hourly backups via cron
3. Runs weekly restore verification (Sunday 3 AM)
4. Uploads to S3 if `BACKUP_S3_BUCKET` is configured

Required environment variables:
```env
BACKUP_S3_BUCKET=your-ndsep-backup-bucket
BACKUP_ENCRYPTION_KEY=<64-char-hex>  # optional, for backup encryption
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=af-south-1
```

## Incident Response

### Data Loss Scenario

1. **Assess**: Determine scope (table-level, full DB, or infrastructure)
2. **Isolate**: Stop application writes if ongoing corruption
3. **Recover**: Use PITR to restore to last known good state
4. **Verify**: Run `./scripts/backup-postgres.sh --verify` on restored DB
5. **Notify**: Per NDPA breach notification requirements (72 hours)

### Infrastructure Failure

1. **Failover**: Promote read replica to primary (if cross-region replication)
2. **DNS Update**: Point application to new primary
3. **Verify**: Check data integrity and application connectivity
4. **Post-mortem**: Document root cause and update procedures

## Monitoring

- Backup success/failure: Check `/var/log/ndsep/backup.log`
- WAL archiving lag: Monitor `pg_stat_archiver` view
- Backup size trends: Track growth for capacity planning
- Restore test results: Check `/var/log/ndsep/backup-verify.log`
