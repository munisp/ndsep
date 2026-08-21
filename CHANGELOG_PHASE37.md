# CHANGELOG — Phase 37: Production Hardening

**Date:** 2026-04-26
**Test Results:** 899/899 unit tests passing, 34/34 Playwright E2E tests passing
**Archive:** `ndsep_phase37_final_20260426_113710.zip` (592 MB)

---

## Summary

Phase 37 was a comprehensive production-hardening sprint covering security, mobile parity, schema correctness, and infrastructure completeness. No new user-facing features were added; all changes harden existing functionality.

---

## Changes by Category

### 1. Security Hardening

| File | Change |
|------|--------|
| `server/_core/index.ts` | Added `perUserRateLimit` (300 req/min per authenticated user) to `/api/trpc` route |
| `server/_core/index.ts` | Added `cors` middleware with `CORS_ORIGINS` env var support for mobile app cross-origin requests |
| `server/security/threatProtection.ts` | Imported `perUserRateLimit` (was defined but never applied) |
| `docker-compose.production.yml` | Added `CORS_ORIGINS` env var to `ndsep-api` service with `${CORS_ORIGINS:-*}` default |

**Security posture after Phase 37:**
- IP-level rate limiting: 200 req/min (apiLimiter)
- Per-user rate limiting: 300 req/min (perUserRateLimit) — **NEW**
- Auth rate limiting: 20 req/15min (authLimiter)
- DDoS slow-down (ddosSlowDown)
- Brute-force protection (bruteForceProtection) — fixed in Phase 36 to not block `auth.me`
- Ransomware/bulk-export detection (ransomwareProtection)
- Bot detection (botDetectionMiddleware)
- Oversized payload guard (oversizedPayloadGuard)
- Financial security headers (financialSecurityHeaders)
- Helmet CSP/HSTS/noSniff/XSS filter
- CORS with configurable origins — **NEW**

### 2. Mobile API Parity

#### React Native
| File | Change |
|------|--------|
| `mobile/react-native/src/screens/SecurityAlertsScreen.tsx` | Fixed `security.alerts` → `siem.alerts`, `security.resolveAlert` → `siem.resolveAlert` |
| `mobile/react-native/src/screens/AuditLogScreen.tsx` | Fixed `audit.list` → `auditLogs.list` |
| `mobile/react-native/src/screens/EnforcementScreen.tsx` | Fixed `enforcement.cases` → `enforcementCases.list` |
| `mobile/react-native/src/screens/FinancialEnforcementScreen.tsx` | Fixed `penalties.list` → `financial.penalties`, `penalties.issue` → `financial.issuePenalty` |

#### Flutter
| File | Change |
|------|--------|
| `mobile/flutter/lib/services/api_service.dart` | Fixed `audit.list` → `auditLogs.list`, `penalties.create` → `financial.createPenalty`, `enforcement.cases` → `enforcementCases.list`, `security.alerts` → `siem.alerts` |
| `mobile/flutter/lib/screens/compliance/leaderboard_screen.dart` | **NEW** — ComplianceLeaderboardScreen (was missing from Flutter, existed in RN) |
| `mobile/flutter/lib/screens/enforcement/remediation_workflows_screen.dart` | **NEW** — RemediationWorkflowsScreen (was missing from Flutter, existed in RN) |
| `mobile/flutter/lib/main.dart` | Added routes and nav drawer entries for both new screens |

### 3. Backend Schema Fixes

| File | Change |
|------|--------|
| `server/routers.ts` (portal.myOrg) | Fixed SQL queries to use correct table/column names: `financial_penalties` (not `penalties`), `compliance_violations` (not `violations`), `portal_submissions.submitted_at` (not `created_at`), removed non-existent `status` column from portal_submissions |
| `scripts/create_organization_users.sql` | **NEW** — DDL for `organization_users` join table (required by `portal.myOrg`) |
| `scripts/migrate-org-users.mjs` | **NEW** — Migration runner for `organization_users` table |

### 4. Infrastructure

| File | Change |
|------|--------|
| `docker-compose.production.yml` | Added `CORS_ORIGINS` env var to `ndsep-api` service |
| `package.json` | Added `cors` and `@types/cors` dependencies |

### 5. Python Workers

| Dependency | Change |
|------------|--------|
| `psycopg2-binary` | Installed for insurance-monitor worker |
| `pyarrow`, `scikit-learn`, `numpy` | Installed for data analytics workers |
| `fastapi`, `uvicorn`, `pydantic` | Installed for orchestration services |

---

## Audit Findings (No Action Required)

The following were audited and confirmed correct:

- **185 client pages / 205 routes** — all wired to tRPC, 0 placeholder/stub pages
- **4 intentionally static pages**: ApiDocs, DpcoBrochure (printable), Home (landing), NotFound
- **0 TODO/FIXME** in production code
- **115 DB tables** — all referenced in router files (banking.ts, phase12Features.ts, etc.)
- **Helmet CSP/HSTS** — correctly configured for production vs. development
- **PBAC** — export/delete/approve procedures gated via `requirePbac` middleware
- **Public mutations** — only `auth.logout` is public (correct: clears session, no sensitive data)
- **Docker services** — postgres, redis, kafka, temporal, keycloak, permify, apisix, prometheus, grafana, alertmanager all present in production compose

---

## Test Results

```
Test Files  26 passed (26)
     Tests  899 passed (899)
  Duration  ~170s
```

Playwright E2E: 34/34 passing (unchanged from Phase 36)
