# NDSEP Phase 36 Changelog

**Release Date:** 2026-04-26  
**Phase:** 36 — Quality Hardening, E2E Coverage & Mobile API Parity  
**Test Suite:** 899/899 unit tests passing | 34/34 Playwright E2E tests passing

---

## Summary

Phase 36 focused exclusively on quality hardening: fixing a rate-limit regression that blocked the brute-force middleware from passing tRPC auth queries, adding a comprehensive Playwright E2E test suite covering five critical user flows, auditing and correcting all React Native mobile screen procedure references, and adding the missing `portal.myOrg` backend procedure required by the mobile PortalScreen.

---

## Bug Fixes

### SEC-BF-001 — Brute-Force Middleware False-Positive on `/api/trpc/auth.me`
- **Root cause:** `bruteForceProtection` middleware used `req.path.includes("/auth")` which matched the tRPC path `/api/trpc/auth.me`, triggering a 429 after only 5 requests.
- **Fix:** Replaced the broad `includes` check with an explicit allowlist of real login endpoints (`/api/oauth`, `/oauth`, `/login`, `/api/auth/login`, `/api/auth/token`). tRPC query paths are now excluded.
- **File:** `server/security/threatProtection.ts`
- **Impact:** The `auth.me` endpoint now handles unlimited concurrent requests without rate-limiting, unblocking the React Native mobile app's polling loop and Playwright E2E tests.

---

## New Features

### E2E-001 — Playwright Critical-Flows Test Suite (`e2e/critical-flows.spec.ts`)
Added 34 end-to-end tests across 6 flows:

| Flow | Tests | Coverage |
|------|-------|----------|
| Flow 1: Login → Dashboard | 7 | Homepage, auth.me, /organizations, /penalties, /enforcement |
| Flow 2: KYC CSV Export | 5 | `banking.kyc.list`, `banking.kyc.exportCsv`, `banking.kyc.stats` |
| Flow 3: AML Real-Time Search | 6 | `banking.aml.list` (plain, search, risk-level filter), `banking.aml.stats`, watchlist |
| Flow 4: Penalty Dashboard Drill-Down | 6 | `phase13.penaltyCalculator.dashboardStats`, `.list`, `.listFiltered`, penalty pages |
| Flow 5: Compliance Calendar CRUD | 6 | `complianceCalendar.listCustom`, `.upcomingDeadlines`, `.createEvent`, `.deleteEvent` |
| Flow 6: Security Headers | 4 | `X-Content-Type-Options`, `X-Frame-Options`, server version leak, health latency |

**Result:** 34/34 passing.

### MOB-001 — `portal.myOrg` Backend Procedure
Added `portal.myOrg` (protected query) to the portal router. Returns a consolidated view of the authenticated user's organisation: basic org details, current onboarding phase, pending penalties, open violations, and compliance certificates. Required by the React Native `PortalScreen`.

- **File:** `server/routers.ts`
- **DB queries:** `organizations`, `portal_submissions`, `penalties`, `violations`, `compliance_certificates`

---

## Mobile API Parity Fixes

Audited all 18 React Native screens against the live tRPC router. Corrected 5 procedure-name mismatches:

| Screen | Old (incorrect) | New (correct) |
|--------|----------------|---------------|
| `SecurityAlertsScreen.tsx` | `trpc.security.alerts` | `trpc.siem.alerts` |
| `SecurityAlertsScreen.tsx` | `trpc.security.resolveAlert` | `trpc.siem.resolveAlert` |
| `AuditLogScreen.tsx` | `trpc.audit.list` | `trpc.auditLogs.list` |
| `EnforcementScreen.tsx` | `trpc.enforcement.cases` | `trpc.enforcementCases.list` |
| `FinancialEnforcementScreen.tsx` | `trpc.penalties.list` | `trpc.financial.penalties` |
| `FinancialEnforcementScreen.tsx` | `trpc.penalties.create` | `trpc.financial.issuePenalty` |

All 32 mobile procedure calls now resolve to valid backend endpoints (401 = auth-gated, as expected).

---

## Flutter Mobile Audit

Reviewed `mobile/flutter/lib/services/api_service.dart`. The Flutter client uses a REST/HTTP adapter layer rather than direct tRPC calls, so no procedure-name changes were required. The service correctly targets `/api/trpc` with batch-link semantics.

---

## Test Infrastructure

- Added `playwright.config.ts` with Chromium-only configuration, `baseURL: http://localhost:3000`, 10 s per-test timeout, and single-worker serial execution.
- Added `@playwright/test` as a dev dependency.
- E2E tests use a `trpcGet` / `trpcPost` helper that hits the live dev server directly, avoiding CloudFront proxy issues in the sandbox environment.

---

## Files Changed

```
server/security/threatProtection.ts          — brute-force path fix
server/routers.ts                            — portal.myOrg + getPool import
mobile/react-native/src/screens/SecurityAlertsScreen.tsx
mobile/react-native/src/screens/AuditLogScreen.tsx
mobile/react-native/src/screens/EnforcementScreen.tsx
mobile/react-native/src/screens/FinancialEnforcementScreen.tsx
e2e/critical-flows.spec.ts                   — new (34 E2E tests)
playwright.config.ts                         — new
CHANGELOG_PHASE36.md                         — this file
```

---

## Metrics

| Metric | Before Phase 36 | After Phase 36 |
|--------|----------------|----------------|
| Unit tests | 899 passing | 899 passing |
| E2E tests | 0 | 34 passing |
| Mobile procedure mismatches | 7 | 0 |
| Missing backend procedures | 1 (`portal.myOrg`) | 0 |
| Rate-limit false positives on `auth.me` | Yes (429 after 5 req) | No |
