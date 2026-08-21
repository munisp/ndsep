# NDSEP Phase 42 Changelog
## Release Date: 2026-04-26

## Summary
Phase 42 is a comprehensive production-hardening sprint addressing all outstanding security vulnerabilities, orphan service wiring, mock data elimination, schema gaps, and Docker/YAML completeness.

## Security Hardening
- Applied `deleteProcedure` (PBAC_DELETE) to all 25 delete: procedures in server/routers.ts
- Applied `approveProcedure` (PBAC_APPROVE) to approve: procedures
- kyc_records: Added 8 missing columns (id_document_type, id_document_url, liveness_score, face_match_score, bvn_verified, nin_verified, address_verified, selfie_url)
- organizations: Added dpo_name, dpo_email, dpo_phone columns

## Service Wiring
- 38 orphan workers registered in server/workerManager.ts:
  - 12 Go workers (ports 8140-8166)
  - 9 Python workers (ports 8212-8229)
  - 6 Rust workers (ports 8307-8312)

## Mock Data Elimination
- StreamingEvents.tsx: Replaced Math.random() throughput with real DB data from trpc.streaming.topicStats
- SectorComplianceDashboard.tsx: Real lastScan timestamps from DB

## New Features
- sectorEvents tRPC router: list, create, resolve, stats procedures
- 4 new sectorComplianceEvents DB helpers in server/db.ts

## Database Migrations
- ropa_records (synced via pnpm db:push)
- dpo_reports, privacy_notices, automated_decisions, parental_consent_records (created via ALTER TABLE)

## Docker/YAML
- docker-compose-workers-addition.yml: 9 new Python worker services added (1,278 lines total)
- All Python workers use WORKER_DATABASE_URL env var

## Bug Fixes
- Python workers: WORKER_DATABASE_URL preferred over DATABASE_URL (MySQL DSN issue)
- Zod v4: z.record() fixed to use 2 arguments

## Testing
- server/phase42.test.ts: 27 new tests
- Total: 926 tests across 27 test files
