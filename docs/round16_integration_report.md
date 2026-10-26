# Round-16 Integration Report

**Date:** 2026-10-27 — Integrator pass over W1–W5 deliverables (W6 was PWA-only, outside this repo).

## 1. App.tsx integrity (client/src/App.tsx)

Verified after the reported concurrent-edit incidents — file is **syntactically complete and undamaged** (tsc clean for this file; closes correctly with `</Suspense>` → `App` → `export default`).

- **Route count: 289** `<Route path="…">` entries, **zero duplicate paths**, catch-all `<Route component={NotFound} />` intact and last.
- All four Round-16 route blocks present exactly once:
  - W1 (`/policy-monitor`, `/reg-intel`, `/regulator-reconciliation`) — lines ~613–616
  - W2 (`/consent-propagation`, `/whistleblower-channel`, `/nin-identity`) — lines ~605–608
  - W3 (`/antiwipe-console`, `/production-readiness`, `/workflows`) — lines ~609–612
  - W4 (`/ml-ops`, `/automation-rules`) — lines ~596–598
- All **263 lazy imports** resolve to existing files (scripted check, 0 missing); all 11 new page files exist in `client/src/pages/`.
- **Count note:** expected was "278 pre-round + 10 new = 288"; actual is **289** because Round-16 added **11** routes (3+3+3+2). W3's `/workflows` is genuinely new (the pre-existing Temporal page is at `/temporal`), so nothing was replaced or lost. 278 + 11 = 289 ✓. No Round-12/13 routes lost.
- No fixes required.

## 2. Nav completeness (client/src/components/DashboardLayout.tsx)

W2 (3 entries under "Advanced Features") and W4 (ML Ops under "AI & Intelligence", Automation Rules under "Admin & Settings") were already present. Added the missing W1/W3 entries:

- **"AI & Intelligence"**: Policy Monitor (`MonitorCheck`) → `/policy-monitor`; Reg Intel (`Library`) → `/reg-intel`
- **"Governance & Reporting"**: Regulator Reconciliation (`Scale`) → `/regulator-reconciliation`
- **"Admin & Settings"**: Antiwipe Console (`ShieldCheck`) → `/antiwipe-console`; Production Readiness (`Gauge`) → `/production-readiness`; Workflows Console (`Workflow`) → `/workflows`

Added `MonitorCheck, Library` to the lucide-react import (all other icons already imported). tsc-clean.

## 3. Duplicate routers unmounted (server/routers.ts)

All 15 mounts verified **zero references** in `client/src` (grep for `trpc.<ns>.`) before removal. Removed the mount lines and left dated (2026-10-27) comments naming the canonical namespace. None were inline `router({})` blocks — all were mounts of `enhancements.ts` routers, which remain exported there (not deleted, per instructions).

| # | Unmounted | Canonical namespace |
|---|---|---|
| 1 | `auditLogs` | `siem.auditLogs` |
| 2 | `compliancePolicies` | `compliance.policies` |
| 3 | `configSnapshots` | `gitopsConfig` |
| 4 | `dataCatalog` | `catalog` |
| 5 | `dpcoAuditLogs` | `dpco` |
| 6 | `dpcoPerformanceMetrics` | `dpco` |
| 7 | `enforcementActions` | `compliance.enforcementActions` / `enforcementCases` |
| 8 | `mlRiskPredictions` | `aiRiskScoring` |
| 9 | `penaltyAppeals` | `financial.appeals` / `appealsDueProcess` |
| 10 | `streamingEvents` | `streaming` |
| 11 | `threatIntelligence` | `siem.threatIntel` / `osirisIntel` |
| 12 | `i18n` | client-side i18next bundles |
| 13 | `aiSystems` | `aiGovernance` (identical router object, was double-mounted) |
| 14 | `transferImpact` | `tia` |
| 15 | `tiaAssessments` (W4 bonus finding, independently re-verified 0 client refs) | `tia` |

**Consumer fallout found and fixed** (W4's grep only covered `client/src`):
- `mobile/flutter/lib/services/api_service.dart`: `auditLogs.list` → `siem.auditLogs` (same `{limit}` input; canonical reader of the same `audit_logs` table)
- `mobile/react-native/src/screens/AuditLogScreen.tsx`: `trpc.auditLogs.list.useQuery` → `trpc.siem.auditLogs.useQuery`
- `mobile/flutter/test/integration/api_integration_test.dart`: 2 refs → `siem.auditLogs`
- `mobile/flutter/test/unit/api_service_unit_test.dart`: canonical-procedure list → `siem.auditLogs`
- `scripts/smoke-test.mjs`: `compliancePolicies.list`→`compliance.policies`, `auditLogs.list`→`siem.auditLogs`, `enforcementActions.list`→`compliance.enforcementActions`

Repo-wide grep after removal: no remaining references to any of the 15 namespaces.

## 4. Mobile validation (mobile/flutter)

W5's confirmation had never run (SDK was gone from /tmp). Downloaded Flutter 3.27.4 stable (Dart 3.6.2) to /tmp, then:

- `flutter pub get` — OK (165 deps resolved)
- `dart analyze` — **0 errors, 0 warnings, 76 info-level lints** (deprecated `withOpacity`, `prefer_const_*`, etc. — acceptable)
- Fixed 2 packaging warnings by creating the declared-but-missing `assets/images/` and `assets/icons/` dirs (with `.gitkeep`)

No remaining real errors; W5's fixes all landed. (Note: `noexec` FUSE mount required staging the esbuild binary to /tmp for vitest — see §5.)

## 5. Gates

| Gate | Result |
|---|---|
| `node scripts/ci/orphanRouterCheck.mjs` | **PASS** — 89 router modules, all exported routers mounted (enhancements.ts still has other mounted routers) |
| `tsc --noEmit` | **35 errors — exactly the pre-existing baseline, zero new.** Nothing in App.tsx, DashboardLayout.tsx, routers.ts, or any Round-16 file |
| vitest `server/routers/__tests__ + server/services/__tests__` | **14 files, 187/187 passed** — matches baseline exactly (the round-13 "248 neighboring" figure = 187 + 61 osiris tests, which are outside the commanded paths) |
| Wiring smoke tests (`ngnLedgerWiring`, `productionReadiness.logic` — import server/routers.ts) | **10/10 passed** — unmounts compile and register |
| `server/productionReadiness.test.ts` (outside commanded gate) | 2 failures, **both pre-existing and unrelated** to Round-16: (a) stale source-text assertion expecting `if (!hmacKey) throw new Error` while enhancements.ts now uses a multi-line `TRPCError` throw for `EVIDENCE_HMAC_SECRET`; (b) missing `workers/python/grpc_interceptors.py` (never existed in this tree). Not caused by the unmounts; left as-is |

No vitest tests referenced any of the 15 removed namespaces, so no test deletions were needed.

## 6. Files changed

- `client/src/components/DashboardLayout.tsx` — 6 nav entries + 2 lucide imports
- `server/routers.ts` — 15 duplicate mounts removed + dated canonical-namespace comments
- `mobile/flutter/lib/services/api_service.dart` — `auditLogs.list`→`siem.auditLogs`
- `mobile/react-native/src/screens/AuditLogScreen.tsx` — same rebind
- `mobile/flutter/test/integration/api_integration_test.dart`, `mobile/flutter/test/unit/api_service_unit_test.dart` — rebind
- `scripts/smoke-test.mjs` — 3 endpoint paths rebound to canonical namespaces
- `mobile/flutter/assets/images/.gitkeep`, `mobile/flutter/assets/icons/.gitkeep` — new (asset dir warnings)

No commits/pushes performed.

## Residual risk

- `mobile/react-native` was not compile-checked (no RN toolchain in scope); the `trpc.siem.auditLogs` rebind matches the canonical procedure signature (`{limit?}`), low risk.
- The 15 unmounted namespaces are still reachable in code via `server/routers/enhancements.ts` exports; if any external (non-repo) API consumer called them, it must move to the canonical namespaces listed above.
- `server/productionReadiness.test.ts` 2 pre-existing failures worth a future cleanup pass.
