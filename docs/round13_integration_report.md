# Round 13 Integration Report

Date: 2026-10-26 · Workspace: `/mnt/agents/ndsep-r12`
Scope: integrate the 6 Round-13 workstreams (W1 telegram watch, W2 hosting
verification, W3 infra posture + ransom trace, W4 GDELT/news intel feeds,
W5 transfer forecast + OSIRIS SSE, W6 infrastructure risk watch).

## Router mounts (6)

All 6 Round-13 routers imported and mounted in `server/routers.ts` under the
new `// ── Round-13 waves (migrations 0141-0148) ──` banner immediately after
the Round-12 block (imports after the `autonomyGovernanceRouter` import):

1. `telegramWatch` → `./routers/telegramWatch` (`telegramWatchRouter`)
2. `hostingVerification` → `./routers/hostingVerification` (`hostingVerificationRouter`)
3. `ransomTrace` → `./routers/ransomTrace` (`ransomTraceRouter`)
4. `osirisIntelFeed` → `./routers/osirisIntelFeed` (`osirisIntelFeedRouter`)
5. `transferForecast` → `./routers/transferForecast` (`transferForecastRouter`)
6. `infrastructureRisk` → `./routers/infrastructureRisk` (`infrastructureRiskRouter`)

Export names verified against the source files before mounting. The
orphan-router CI gate now passes:

```
node scripts/ci/orphanRouterCheck.mjs
→ OK — 89 router modules checked against server/routers.ts; all exported routers mounted.
```

## Schema merges (12 tables) + schema_ext cleanup

Merged all six `drizzle/schema_ext/*.ts` files into `drizzle/schema.ts` as a
`Round 13` appendix after the Round-12 block, following the Round-12
conventions (banner comments, object-form extra-config callbacks, `$inferSelect`
type exports). Tables added:

- 0141: `telegram_watch_items`, `breach_lag_signals`, `telegram_watch_watermarks`
- 0142: `hosting_verification_runs`, `hosting_verification_hosts`
- 0144/0145: `infra_posture_runs`, `ransom_traces`
- 0146: `osiris_intel_watermarks`
- 0147: `transfer_risk_forecasts`
- 0148: `cable_landing_points`, `availability_risk_events`, `cable_watch_alerts`

Import list gained `doublePrecision` and `unique` (both previously unused in
schema.ts). FK note preserved: `adverse_media_items`, `scan_targets`,
`scan_runs`, `hosting_declarations` have no Drizzle defs (raw-SQL tables), so
those FKs stay DB-level only, as documented in the ext files.

No file imported `drizzle/schema_ext/*` (repo-wide grep over server/, client/,
workers/, scripts/), so all six ext files were deleted and the now-empty
`drizzle/schema_ext/` directory removed. Standalone `tsc` program check of
`drizzle/schema.ts`: 0 diagnostics.

## Temporal schedules (4 new)

New files mirroring the Round-12 pattern exactly:

- `server/services/round13Schedules.ts` — `ROUND13_SCHEDULES`,
  `registerRound13Schedules()` (explicit SKIP-warn when Temporal unconfigured;
  per-schedule failure collection; production fail-closed enforced by
  worker.ts), `ROUND13_JOB_RUNNERS` + `runRound13Job()` cron fallback
  (unknown ids throw). Also hosts the fail-closed HTTP worker triggers
  `pollTelegramWatchWorker()` / `pollOsirisIntelWorker()` (POST `/run` with
  `X-Worker-Auth` from `WORKER_AUTH_TOKEN`, 120s timeout, non-OK/unreachable
  throws — never a fabricated success; mirrors `osirisIntelFeed.triggerPoll`).
- `workers/temporal/activities/round13Jobs.ts` — thin wrappers delegating to
  the canonical service functions (`runDueVerifications`,
  `runInfrastructureRiskSweep`) and the HTTP poll triggers.
- `workers/temporal/workflows/round13Jobs.ts` — durable workflow wrappers;
  function names match the registered `workflowType`s.
- `workers/temporal/workflows/index.ts` — exports the 4 new workflows.
- `workers/temporal/worker.ts` — `registerRound13Schedules()` block added
  after the Round-12 registration (same fail-closed semantics: production
  refuses to start when any registration fails); round13 activities merged
  into the `ndsep-main` task-queue worker.

Schedules:

| workflowId | cron | job |
|---|---|---|
| `round13-hosting-verification-sweep` | `15 4 * * *` (daily) | `hostingVerification.runDueVerifications()` |
| `round13-infrastructure-risk-sweep` | `*/30 * * * *` | `infrastructureRiskWatch.runInfrastructureRiskSweep()` |
| `round13-telegram-watch-poll` | `*/15 * * * *` | POST `TELEGRAM_WATCH_WORKER_URL` (default `http://localhost:8117`) `/run` |
| `round13-osiris-intel-poll` | `*/15 * * * *` | POST `OSIRIS_INTEL_WORKER_URL` (default `http://localhost:8118`) `/run` |

Smoke import (tsx) of both new modules: schedules, runners and activities all
load; `isTemporalConfigured()` false in this env ⇒ registration would SKIP
with explicit warns, as designed.

## SSE boot wiring (P1.7)

`server/_core/index.ts`:
- Boot: inside the `NODE_ENV !== "test"` startup block, right after
  `startKafkaConsumer()` — `startOsirisStream()` behind
  `OSIRIS_SSE_ENABLED` (default `"true"`; `"false"` disables). Fail-open by
  design (streaming is an optimization, not critical path): dynamic import +
  `.catch` logs a warn and never blocks boot; an explicit info log records
  the disabled state.
- Shutdown: `stopOsirisStream()` added as step 3b of `gracefulShutdown`
  (after Kafka disconnect, before replica-pool close), failure-tolerant.

## Cast removals (client)

All `(trpc as any)` shims for the six new namespaces removed (routers are now
typed via `AppRouter`):

- `client/src/components/HostingVerificationBadge.tsx` — shim + stale comment
- `client/src/components/InfrastructureRiskPanel.tsx` — shim + two
  `(utils as any).infrastructureRisk.invalidate()` casts
- `client/src/components/RansomTraceCard.tsx` — `const api = trpc as any` +
  optional-chain guards no longer needed
- `client/src/components/TelegramWatchPanel.tsx` — shim + eslint-disable
- `client/src/components/TransferForecastBadge.tsx` — `const api = trpc as any`
  + optional-chain guards
- `client/src/pages/DataSovereigntyDashboard.tsx` — `(trpc as any).hostingVerification`

Remaining `(trpc as any)` casts in `InsiderThreat.tsx` / `RAGAdvisor.tsx`
reference namespaces outside Round-13 scope and were intentionally left.

## Verification

### a. Migration chain — real PostgreSQL 16.2

Zonky embedded-postgres-binaries-linux-amd64 **16.2.0** (Maven Central;
pgserver's bundled 16.2 lacks the pgcrypto contrib module required by journal
migration 0019, so the cluster ran from the Zonky distribution; pgserver's
psql 16.2 used as the client). Fresh cluster, full chain:

- Journal: **35/35** drizzle-kit journal files applied in journal order via
  `scripts/ci/applyJournalMigrations.sh` — OK.
- Raw chain: `node scripts/runRawMigrations.mjs` → **89 applied, 0 failed**
  (82 pre-Round-13 + 7 new: 0141, 0142, 0144, 0145, 0146, 0147, 0148).
- Idempotency: two further runs → **0 applied, 89 already up to date** each.
- Final schema: **339 tables** (327 Round-12 + 12 new).
- Spot checks on the live DB: all 12 new tables present;
  `cable_landing_points` seeded with 6 rows; `adverse_media_sources` seeded
  with `osiris_telegram`/`osiris_gdelt`/`osiris_news` all `enabled=false`;
  `scan_findings_finding_type_check` includes `'infra_posture'`;
  `asn_geo_reference` holds 422 `nigerian_cidr` + 11 `nigerian_asn` rows;
  `telegram_watch_items` `UNIQUE(channel, post_id)` enforced (duplicate insert
  rejected).
- sqlglot (read='postgres', sqlglot 30.24.0): **7/7** new migration files
  parse clean (0141: 8 stmts, 0142: 8, 0144: 5, 0145: 4, 0146: 3, 0147: 3,
  0148: 8).
- No migration edits were needed — 0141–0148 applied cleanly first try; no
  fix-forward 0149+ required.

### b. vitest

Command: `ESBUILD_BINARY_PATH=/tmp/esb-kimi/esbuild node node_modules/vitest/vitest.mjs run <files>`
(staged esbuild 0.27.7 platform binary — the FUSE mount ignores exec bits).

**Round-13 suites — 12 files, 167/167 passed, 0 failed:**

| File | Tests |
|---|---|
| server/routers/__tests__/telegramWatch.test.ts | 9 |
| server/services/hostingVerification.test.ts | 21 |
| server/osiris/__tests__/scannerClient.test.ts | 10 |
| server/services/__tests__/infraPostureScan.test.ts | 20 |
| server/routers/__tests__/ransomTrace.test.ts | 7 |
| server/routers/__tests__/osirisIntelFeed.test.ts | 9 |
| server/osiris/__tests__/mcpClient.test.ts | 16 |
| server/osiris/__tests__/forecastClient.test.ts | 14 |
| server/services/transferRiskForecast.test.ts | 17 |
| server/osiris/__tests__/sseSubscriber.test.ts | 12 |
| server/services/infrastructureRiskWatch.test.ts | 27 |
| server/osiris/__tests__/disasterMaritimeClients.test.ts | 9 |

(W-reports' per-file counts differ slightly for mcpClient/forecastClient —
the on-disk suites carry 16/14 tests; all pass.)

**Round-12 regression — the 13 Round-12 files: 185/185 passed** (unchanged).

**Neighboring suites:** full `server/routers/__tests__` +
`server/services/__tests__` + `server/osiris/__tests__` sweep:
**19 files, 248/248 passed**. Wiring smoke tests
(`ngnLedgerWiring.test.ts`, `productionReadiness.logic.test.ts`, which import
`server/routers.ts`): 10/10 — the 6 mounts compile and register.

### c. tsc

`node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`
(TypeScript 5.9.3):

- **35 errors — exactly the Round-12 baseline set** (TS2802 ES5-iterator ×16,
  stripe apiVersion pin drift ×3, CrossBorderDeclarationsReview `as any[]` ×4,
  and the r9-identical strictness remainder). Every error is in a file/line
  unchanged by Round-13; **0 errors in any Round-13 file**.
- Integration-caused errors fixed this pass (6 total):
  1. `server/services/round13Schedules.ts` — doc-comment crontab example
     `*/30 …` terminated the block comment (TS1109/TS1005 cluster) — reworded.
  2. `client/src/components/TransferForecastBadge.tsx` ×4 — surfaced once the
     cast was removed: `forecast` possibly null at the badge chip (now
     `forecast?.forecastProbability` guard) and `forecastId: string | null`
     passed to agree/disagree mutations (narrowed via `as string` inside the
     existing truthy guard).
  3. `client/src/pages/DataSovereigntyDashboard.tsx` ×1 — `statusFilter`
     widened from `string` to `"" | "compliant" | "violation" | "unverified"`
     with a typed Select onValueChange.

### d. pytest

Interpreter: python3.12 with pytest/requests/psycopg2-binary installed this
session (the system python3.11 pytest lacked `requests`).

- New Round-13 worker tests: **46/46 passed**
  (`test_telegram_breach_watch_worker.py` 24 + `test_gdelt_adverse_media_worker.py` 22).
- Full suite (`ml/tests workers/python tests orchestration/tests`):
  **257 passed, 8 failed, 6 errors** = Round-12 baseline (211 passed) + 46
  new; the 14 non-passing tests are exactly the pre-existing
  `ml/tests/test_neo4j_graph.py` (6 failed + 6 errors) and
  `ml/tests/test_ab.py` (2 failed) environment/mocking failures that
  reproduce on the r9 baseline. No regression.

## Files changed this integration pass

- `server/routers.ts` — 6 imports + 6 mounts (Round-13 banner)
- `drizzle/schema.ts` — 12 Round-13 table defs appended; `doublePrecision` +
  `unique` added to pg-core imports
- `drizzle/schema_ext/` — 6 files deleted after merge (no importers), dir removed
- `server/services/round13Schedules.ts` — NEW (schedules, registration, cron
  fallback, fail-closed HTTP worker triggers)
- `workers/temporal/activities/round13Jobs.ts` — NEW
- `workers/temporal/workflows/round13Jobs.ts` — NEW
- `workers/temporal/workflows/index.ts` — export Round-13 workflows
- `workers/temporal/worker.ts` — register Round-13 schedules; merge Round-13
  activities into the ndsep-main worker
- `server/_core/index.ts` — `startOsirisStream()` at boot (env-gated,
  fail-open) + `stopOsirisStream()` in graceful shutdown
- `client/src/components/{HostingVerificationBadge,InfrastructureRiskPanel,
  RansomTraceCard,TelegramWatchPanel,TransferForecastBadge}.tsx`,
  `client/src/pages/DataSovereigntyDashboard.tsx` — cast removals + the 5
  type fixes above
- `docs/round13_integration_report.md` — this file

No commits made (per instructions).

## Residual risks / follow-ups

- **Temporal HTTP-poll schedules are only as available as the workers**:
  `round13-telegram-watch-poll` / `round13-osiris-intel-poll` fail (and retry
  ×3) when the python workers are down — intended fail-closed behavior, but
  expect Temporal retry noise if workers aren't deployed. Env:
  `TELEGRAM_WATCH_WORKER_URL` (new), `OSIRIS_INTEL_WORKER_URL`,
  `WORKER_AUTH_TOKEN`.
- **W3 infra-posture sweep has no schedule by design** (mission constraint:
  weights untouched; operator-triggered via `complianceScanning.runInfraPostureScan`
  or the panel button). A follow-up schedule can call
  `scanTargetPosture`/the service directly if desired.
- **SSE stream consumers**: `startOsirisStream()` now runs at boot, but
  `server/osirisClient.ts` is still polling-only — the snapshot-store
  read-before-polling seam (W5 integrator note) is a future refactor; stream
  health is observable via `transferForecast.intelStreamStatus()`.
- **OSIRIS endpoint shapes** (`/api/osint/dns|ip|ssl|crypto`, `/api/gdelt`,
  `/api/news`, `/api/telegram-feed`, `/api/mcp`, SSE stream) are assumed and
  defensively parsed; a live smoke test against a real OSIRIS instance is
  recommended (self-hosted sidecar: `infra/osiris/docker-compose.osiris.yml`).
- **35 pre-existing tsc errors** remain (unchanged from Round-12 baseline);
  the ES5-target TS2802 cluster and stripe apiVersion pin drift are the bulk
  — consider `"target": "ES2022"` and stripe pin alignment in a follow-up.
- **14 pre-existing pytest environment failures** (neo4j/ab mocking)
  reproduce on r9; not Round-13 scope.
- FUSE mount still ignores exec bits: vitest needs `ESBUILD_BINARY_PATH`
  (staged `/tmp/esb-kimi/esbuild`, 0.27.7); tsx needs the 0.28.2 variant
  (`/tmp/esb-kimi/esbuild-0.28.2`).
