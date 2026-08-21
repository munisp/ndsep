# CHANGELOG — Phase 41 (Production Hardening)

## Summary
Phase 41 completes the `sector_compliance_events` table integration end-to-end:
backend CRUD helpers, tRPC router, and frontend wiring in the Sector Compliance Dashboard.

---

## Changes

### server/db.ts
- Added imports: `sectorComplianceEvents`, `InsertSectorComplianceEvent` from `../drizzle/schema`
- Added `listSectorComplianceEvents(opts?)` — filters by orgId, sector, severity, resolved; ordered by createdAt DESC; limit 100 by default
- Added `createSectorComplianceEvent(data)` — inserts a new sector compliance event
- Added `resolveSectorComplianceEvent(id, resolvedBy)` — marks event as resolved, sets resolvedAt and resolvedBy
- Added `getSectorComplianceEventStats()` — aggregates count by sector × severity × resolved

### server/routers.ts
- Added imports: `listSectorComplianceEvents`, `createSectorComplianceEvent`, `resolveSectorComplianceEvent`, `getSectorComplianceEventStats` from `./db`
- Added `sectorEvents` router namespace with four procedures:
  - `sectorEvents.list` (protectedProcedure) — filters: orgId, sector, severity, resolved, limit
  - `sectorEvents.create` (protectedProcedure) — creates a new sector compliance event
  - `sectorEvents.resolve` (protectedProcedure) — resolves an event by id, uses ctx.user.id as resolvedBy
  - `sectorEvents.stats` (protectedProcedure) — returns aggregated stats

### client/src/pages/SectorComplianceDashboard.tsx
- Replaced `Math.random() * 300000` lastScan fallback with real data from `trpc.sectorEvents.list`
- Added `sectorEventsQuery` using `trpc.sectorEvents.list.useQuery({ limit: 100 }, { refetchInterval: 60000 })`
- Built `sectorLastScanMap` (sector id → most recent event ISO timestamp)
- Updated `generateSectorData` signature to accept optional `lastScanOverride` parameter
- Updated `handleRefresh` to also refetch `sectorEventsQuery`
- Sector cards now display real last-scan timestamps from the database

### drizzle/schema.ts (previously added in Phase 41 setup)
- `sectorComplianceEvents` table definition (16 columns)
- `SectorComplianceEvent` and `InsertSectorComplianceEvent` type exports

### scripts/migrate-sector-events.mjs (previously run in Phase 41 setup)
- Raw SQL migration that creates `sector_compliance_events` table
- Seeds 30 events across 10 organizations and 5 sectors

---

## Test Results
- **Unit tests**: 899/899 passing (26 test files)
- **Playwright E2E**: 34/34 passing (from Phase 40 baseline)
- **TypeScript**: 0 errors

---

## Infrastructure (unchanged from Phase 40)
- 73 Docker services in docker-compose.production.yml
- CORS_ORIGINS env var on ndsep-api service
- Per-user rate limiting (300 req/min) on /api/trpc
- Flutter test suite: 3 files, 85+ assertions
