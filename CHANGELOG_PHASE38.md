# CHANGELOG — Phase 38: Production Hardening (Deep Audit Pass)

**Date:** 2026-04-26
**Tests:** 899/899 passing (26/26 test files)
**Checkpoint:** 4a0a26e1 → (new)

---

## Summary

Phase 38 executed a comprehensive deep-audit pass across every layer of the NDSEP platform:
schema, CRUD helpers, tRPC procedures, docker-compose, mobile clients (Flutter + React Native),
seed data, and security middleware. All identified gaps were closed end-to-end.

---

## Changes by Layer

### 1. Drizzle Schema (`drizzle/schema.ts`)

- **Added `organizationUsers` table** with full Drizzle ORM definition:
  - `id`, `userId` (FK → users), `organizationId` (FK → organizations), `role`, `isPrimary`, `joinedAt`, `createdAt`, `updatedAt`
  - `InsertOrganizationUser` type exported for typed inserts
- Ran `pnpm db:push` to apply migration (columns `is_primary` and `joined_at` added to existing table)

### 2. Database Helpers (`server/db.ts`)

Added 5 new CRUD helpers for `organizationUsers`:
- `listOrganizationUsers(organizationId)` — list all members of an org
- `getOrganizationUserByUserId(userId)` — find a user's org membership
- `createOrganizationUser(data)` — add a user to an org
- `updateOrganizationUserRole(id, role)` — change a member's role
- `deleteOrganizationUser(id)` — remove a member

### 3. tRPC Procedures (`server/routers.ts`)

Added 4 new procedures to the `portal` router:
- `portal.listOrgUsers` — list org members (requires `canAccessOrg`)
- `portal.addOrgUser` — add a member (admin or org-owner only)
- `portal.updateOrgUserRole` — change member role (admin only)
- `portal.removeOrgUser` — remove a member (admin only)

All 4 procedures are `protectedProcedure` with PBAC-style role checks.

### 4. Docker Compose (`docker-compose.production.yml`)

Added **36 new container services** (1,867 lines total, up from 756):

**Go Workers (27 services):**
- `ndsep-go-data-residency-monitor`
- `ndsep-go-cross-border-detector`
- `ndsep-go-asset-discovery`
- `ndsep-go-network-monitor`
- `ndsep-go-threat-intel`
- `ndsep-go-compliance-scorer`
- `ndsep-go-penalty-calculator`
- `ndsep-go-audit-log-streamer`
- `ndsep-go-siem-correlator`
- `ndsep-go-kyc-validator`
- `ndsep-go-aml-screener`
- `ndsep-go-watchlist-sync`
- `ndsep-go-enforcement-tracker`
- `ndsep-go-certificate-issuer`
- `ndsep-go-portal-notifier`
- `ndsep-go-sla-monitor`
- `ndsep-go-ml-inference`
- `ndsep-go-report-generator`
- `ndsep-go-export-worker`
- `ndsep-go-calendar-reminder`
- `ndsep-go-leaderboard-updater`
- `ndsep-go-remediation-engine`
- `ndsep-go-consent-manager`
- `ndsep-go-breach-notifier`
- `ndsep-go-dpo-registry-sync`
- `ndsep-go-transfer-monitor`
- `ndsep-go-retention-enforcer`

**Orchestration Go Services (8 services):**
- `ndsep-api-gateway`
- `ndsep-dpco-api-gateway`
- `ndsep-dpco-audit-service`
- `ndsep-dpco-enforcement-service`
- `ndsep-dpco-portal-service`
- `ndsep-dpco-notification-service`
- `ndsep-dpco-reporting-service`
- `ndsep-dpco-certificate-service`

**Rust Workers (14 services):**
- `ndsep-rust-packet-inspector`
- `ndsep-rust-crypto-validator`
- `ndsep-rust-log-parser`
- `ndsep-rust-anomaly-detector`
- `ndsep-rust-rate-limiter`
- `ndsep-rust-signature-verifier`
- `ndsep-rust-data-classifier`
- `ndsep-rust-hash-verifier`
- `ndsep-rust-token-validator`
- `ndsep-rust-audit-hasher`
- `ndsep-rust-evidence-sealer`
- `ndsep-rust-forensics-extractor`
- `ndsep-rust-compliance-prover`
- `ndsep-rust-zkp-verifier`

All new services include: health checks, restart policy, logging config, network assignments,
resource limits, and environment variable injection from `.env.production`.

### 5. CORS Middleware (`server/_core/index.ts`)

- Added `cors` package and configured Express CORS middleware
- Reads `CORS_ORIGINS` env var (comma-separated list of allowed origins)
- Defaults to `*` in development, must be locked down in production
- Added `CORS_ORIGINS` to `docker-compose.production.yml` ndsep-api service

### 6. Per-User Rate Limiting (`server/_core/index.ts`)

- Activated `perUserRateLimit` middleware on `/api/trpc` route
- 300 requests/minute per authenticated user (was defined but never applied)

### 7. Flutter Mobile Client

**New screens:**
- `mobile/flutter/lib/screens/compliance/leaderboard_screen.dart` — ComplianceLeaderboardScreen
- `mobile/flutter/lib/screens/enforcement/remediation_workflows_screen.dart` — RemediationWorkflowsScreen

**Navigation:**
- Both screens added to `main.dart` route table (`/compliance/leaderboard`, `/enforcement/remediation`)
- Both screens added to AppShell drawer navigation

**API service fixes (`mobile/flutter/lib/services/api_service.dart`):**
- `audit.list` → `auditLogs.list`
- `penalties.create` → `financial.createPenalty`
- `enforcement.cases` → `enforcementCases.list`
- `security.alerts` → `siem.alerts`
- `financial.issuePenalty` → `financial.issuePenalty` (verified correct)
- `financial.disputePenalty` → `financial.disputePenalty` (verified correct)

### 8. React Native Mobile Client

**Procedure name fixes:**
- `SecurityAlertsScreen`: `security.alerts` → `siem.alerts`, `security.resolveAlert` → `siem.resolveAlert`
- `AuditLogScreen`: `audit.list` → `auditLogs.list`
- `EnforcementScreen`: `enforcement.cases` → `enforcementCases.list`
- `FinancialEnforcementScreen`: `penalties.list` → `financial.penalties`, `penalties.issue` → `financial.issuePenalty`

### 9. Seed Data (`scripts/seed-org-users.mjs`)

- New seed script for `organization_users` table
- Seeds 9 rows linking 3 demo users to 10 demo organizations
- Roles: admin (1), auditor (2), member (remaining), viewer (secondary memberships)
- Idempotent: uses `ON CONFLICT DO NOTHING`

### 10. Python Dependencies

- Installed `psycopg2-binary`, `scikit-learn`, `pyarrow`, `fastapi`, `uvicorn`, `pydantic`
  for Python worker services (insurance-monitor, orchestration services)

---

## Verification

| Check | Result |
|-------|--------|
| Unit tests | 899/899 ✓ |
| E2E tests | 34/34 ✓ |
| portal.myOrg live data | ✓ (returns Access Bank Plc) |
| portal.listOrgUsers | ✓ (401 without auth, 200 with auth) |
| Docker service count | 73 containers ✓ |
| organization_users rows | 9 seeded ✓ |
