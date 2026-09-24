# scripts/attic — Archived One-Off Scripts

This directory holds **one-off seed/migration/setup scripts that are no longer
referenced** by any live entry point (verified against `package.json`,
`Makefile`, `.github/workflows/`, `docs/`, `docker-compose*.yml`, and `infra/`
at archive time). They are kept for historical/archaeological reference only.

**Do not run these against current environments.** The canonical paths are:

- Database migrations: `scripts/migrate.sh` (driven by `drizzle/` migrations)
- Demo seed: `seed_demo.mjs` / `scripts/seed.mjs`
- Backup/restore: `scripts/backup-postgres.sh`, `scripts/restore-postgres.sh`

## Contents

### One-off seed SQL graveyard
- `seed-all-modules.sql` — early "seed everything" dump
- `seed_all_tables.sql`, `seed_all_tables_v2.sql`, `seed_all_tables_v3.sql` —
  successive full-table seed iterations
- `seed_patch.sql`, `seed_remaining.sql`, `seed_phase31_comprehensive.sql` —
  incremental gap-fill seed passes
- `nigerian_seed.sql` — locale-specific demo data seed

### One-off table-creation scripts (superseded by drizzle migrations)
- `create_banking_tables.cjs`, `create_banking_tables_pg.cjs`
- `create_missing_tables.sql`, `create_missing_tables_v2.sql`
- `create_prod_tables.mjs`

### One-off codebase patch scripts (already applied)
- `add-emit-calls.mjs` — inserted event-emitter calls into server code
- `add-middleware-integration.mjs` — inserted middleware wiring into server code
- `migrate-sector-events.mjs` — created `sector_compliance_events` (run in
  Phase 41 setup; see `CHANGELOG_PHASE41.md`)

### One-off environment setup / smoke scripts
- `calendar_reminder_worker.mjs` — ad-hoc reminder runner
- `init-dpco-kafka-topics.sh` — one-time DPCO Kafka topic bootstrap
- `setup-lakehouse.sh` — one-time lakehouse bootstrap
- `wire_pbac.py` — one-time PBAC wiring pass
- `install-ollama.sh` — local Ollama model provisioning helper
- `banking-smoke-test.sh` — one-time banking-module smoke test

## Not archived (still referenced)

- `scripts/seed-all.sql` — loaded as the preferred "Step 1" seed file by
  `scripts/seed-comprehensive.mjs`, which backs the live `pnpm seed:all` /
  `npm run seed:all` script in `package.json`.
- `scripts/remediate-dpco-lifecycle-identifiers.sh` — referenced by the live
  operational runbooks in `docs/reports/`
  (`P0_FALKORDB_AND_STAGING_DATABASE_EXECUTION_RUNBOOK.md` and companions).
- `scripts/migrate.sh` — documented as the canonical migration path in
  `AUDIT_REMEDIATION_REPORT.md`.
