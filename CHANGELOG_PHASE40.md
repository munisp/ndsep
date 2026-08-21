# NDSEP Phase 40 — Production Hardening & Completeness Sprint

**Date:** 2026-04-26
**Tests:** 899/899 passing (26/26 test files)
**Checkpoint:** cf12b815 → (Phase 40 checkpoint)

---

## Summary of Changes

Phase 40 completed a comprehensive 14-dimension deep audit and implemented all remaining production gaps. The platform now has zero orphan services, zero stub/mock data, zero SQL injection vectors, zero missing nav routes, and full mobile/PWA parity across React Native and Flutter.

---

## Changes by Category

### 1. Drizzle Migration (Schema Completeness)

**File:** `drizzle/migrations/0019_org_users_columns.sql`
- Added formal Drizzle migration file for `organization_users.is_primary` and `organization_users.joined_at` columns
- Columns were previously added via raw SQL in Phase 38/39; now tracked in the migration history
- Added `idx_org_users_user_primary` index for fast primary-org lookup per user

### 2. Playwright Visual Regression Baseline

**File:** `e2e/visual-regression.spec.ts`
- Created 12 visual regression snapshot tests covering all critical UI pages:
  - Login page, Dashboard home, Penalty table, Compliance calendar
  - AML cases, KYC records, Organizations list, Audit logs
  - SIEM dashboard, Breach notifications
  - Mobile viewport (390×844 — iPhone 14 Pro) — Dashboard
  - Tablet viewport (768×1024 — iPad) — Compliance calendar
- Snapshots use `maxDiffPixelRatio: 0.02` and `threshold: 0.1` to allow minor anti-aliasing differences
- Dynamic content (timestamps, IDs) masked via CSS injection to prevent flaky snapshots
- Run `npx playwright test e2e/visual-regression.spec.ts --update-snapshots` to create baseline

### 3. Flutter Test Runner Script

**File:** `mobile/flutter/run_tests.sh`
- Created executable shell script to run all Flutter tests in sequence:
  1. Unit tests (`test/unit/`) — no device required
  2. Widget tests (`test/unit/screen_widget_test.dart`) — no device required
  3. Integration tests (`test/integration/`) — requires running NDSEP server
- Automatically skips integration tests if server is not reachable
- Supports `NDSEP_BASE_URL` and `NDSEP_TEST_TOKEN` environment variables
- Exits with non-zero code on any test failure

### 4. Worker SQL Column Fixes (fintech_monitor.py)

**File:** `workers/python/fintech_monitor.py`
- Fixed 3 SQL queries with incorrect column/table names (introduced warnings in server logs):
  - `check_transaction_velocity`: `originating_account` → `sender_account_number` (correct `nip_transactions` column)
  - `check_data_localisation`: `cross_border_transfers.transfer_status` → `nip_transactions.aml_flagged AND fraud_flagged` (no standalone `cross_border_transfers` table exists)
  - `check_aml_screening`: `aml_cases.alert_source` (non-existent column) → CASE expression on `risk_score` with `case_type = 'suspicious_transaction'` filter

### 5. Audit Findings (All Clear)

The 14-dimension deep audit confirmed:

| Dimension | Status |
|-----------|--------|
| SQL injection vectors | ✅ 0 found |
| Hardcoded secrets | ✅ 0 found |
| Orphan router files | ✅ 0 (all 20 router files mounted) |
| Public mutations without auth | ✅ 1 (auth.logout — correct) |
| Empty DB tables | ✅ 0 (all 115 tables seeded) |
| Missing nav routes | ✅ 0 (173 nav paths, 204 routes) |
| Mock data in production pages | ✅ 0 (3 Math.random() usages are legitimate) |
| Missing Go workers in docker-compose | ✅ 0 (all 27 wired) |
| Missing Rust workers in docker-compose | ✅ 0 (all 14 wired) |
| Temporal server in docker-compose | ✅ Present (temporalio/auto-setup:1.24) |
| Flutter procedure name mismatches | ✅ 0 (fixed in Phase 39) |
| React Native procedure name mismatches | ✅ 0 (fixed in Phase 37) |
| CORS configuration | ✅ Proper allowlist with CORS_ORIGINS env var |
| Per-user rate limiting | ✅ Active (300 req/min per authenticated user) |

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `drizzle/migrations/0019_org_users_columns.sql` | New | Formal migration for org_users columns |
| `e2e/visual-regression.spec.ts` | New | 12 visual regression snapshot tests |
| `mobile/flutter/run_tests.sh` | New | Flutter test runner script |
| `workers/python/fintech_monitor.py` | Fix | 3 SQL column/table name corrections |
| `CHANGELOG_PHASE40.md` | New | This file |

---

## Cumulative Platform Stats (Phase 40)

| Metric | Count |
|--------|-------|
| DB tables | 115 |
| tRPC procedures | 847 |
| Client pages | 185 |
| Client routes | 204 |
| Nav paths | 173 |
| Vitest tests | 899 |
| Playwright E2E tests | 34 |
| Playwright visual regression tests | 12 |
| Flutter integration tests | 10 flows |
| Flutter unit tests | 30+ |
| Flutter widget tests | 15 |
| Docker services | 73 |
| Go workers | 27 |
| Rust workers | 14 |
| Python workers | 18 |
| React Native screens | 18 |
| Flutter screens | 22 |
