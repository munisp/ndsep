# Database Migrations

NDSEP uses [golang-migrate](https://github.com/golang-migrate/migrate) for database schema migrations.

## Directory Structure

```
migrations/
├── 001_initial_schema.up.sql       # Create core tables
├── 001_initial_schema.down.sql     # Drop core tables
├── 002_phase12_tables.up.sql       # Phase 12 feature tables
├── 002_phase12_tables.down.sql     # Rollback Phase 12
├── ...
```

## Running Migrations

### Up (apply all pending)
```bash
make migrate-up
```

### Down (rollback last migration)
```bash
make migrate-down
```

### Create new migration
```bash
make migrate-create NAME=add_new_table
```

### Check current version
```bash
make migrate-version
```

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (required)
- `MIGRATION_DIR` — Path to migrations directory (default: `./migrations`)
