# NDSEP Performance Budgets & Architecture

This document defines per-layer performance budgets, summarizes the caching
architecture, and describes how to detect regressions (load tests + CI).
It complements `docs/slo-sli.md` (production SLIs/SLOs) — the numbers below
are **engineering budgets** enforced in development, load tests, and CI,
not contractual SLOs.

## 1. Budgets per layer

### API (server, tRPC over Express)

| Metric | Budget | Notes |
|---|---|---|
| Reads (queries) — p50 | < 100 ms | Includes DB round-trip; cached endpoints should be ≪ 50 ms |
| Reads — p95 | < 500 ms | Matches platform SLO in `docs/slo-sli.md` |
| Reads — p99 | < 1 s | Stricter than the 2 s production SLO; budgets are targets, SLOs are floors |
| Writes (mutations) — p95 | < 1 s | e.g. `fieldInspection.createCase`, `syncBatch` |
| Batched fan-in (multi-procedure request) — p95 | < 700 ms | Slowest procedure dominates a tRPC batch |
| Auth (Keycloak Bearer verify) — p95 | < 200 ms | See `docs/slo-sli.md` |

### Database (PostgreSQL)

| Metric | Budget | Notes |
|---|---|---|
| Single-row lookup by PK/unique key | < 5 ms | Must use an index; no seq scans on hot paths |
| List endpoints (LIMIT ≤ 200) | < 50 ms | Pagination or hard LIMIT required — no unbounded `SELECT *` |
| Aggregations / dashboards | < 250 ms | Pre-aggregate or cache when exceeded |
| N+1 queries | 0 | Batch with `IN (...)` / joins; tRPC batching is not a fix for N+1 |

**Index strategy:** the authoritative index plan for the current hot paths
(public register search, FOIA tracking lookup, inspection case/evidence sync,
audit log scans) lives in migration `drizzle/migrations/0070_*` (index
strategy migration). Before adding an ad-hoc index, check 0070 and extend it
instead. Public endpoints that filter/sort (`enforcement_notices`,
`foia_requests.reference_number`, `inspection_evidence.evidence_uuid`) must be
covered there.

### Web client (React + Vite)

| Metric | Budget | How it's met |
|---|---|---|
| LCP | < 2.5 s (p75, mid-tier mobile) | Route-level code splitting (`React.lazy` for all 231 routes in `client/src/App.tsx`), app-shell loader in `client/index.html` |
| TTI / INP | < 3.8 s / < 200 ms | Vendor chunk splitting (`vendor`, `ui`, `charts`) in `vite.config.ts`; `target: "esnext"` avoids legacy helper bloat |
| Initial JS | < 400 KB gzip (entry + vendor) | `manualChunks` splits react/scheduler, radix primitives, and recharts; Recharts pages only load the `charts` chunk on demand |
| Long tasks on dashboards | < 200 ms | `React.memo` on repeated card components, `useMemo` on all Recharts inputs so websocket ticks don't re-animate charts |
| Static assets | Cache ≥ 1 day (SW) | Service worker: stale-while-revalidate for static, network-first for API (`client/public/sw.js`) |

### Mobile (Expo React Native)

| Metric | Budget | How it's met |
|---|---|---|
| Cold start (to first interactive frame) | < 3 s on mid-tier Android | Background-task/geofence/notification side effects are deferred past first paint (`mobile/app/_layout.tsx`); leaflet/react-leaflet only `require`d on web map surfaces |
| List scroll | 60 fps, no dropped frames on 500-row lists | `FlatList` (windowSize 7, maxToRenderPerBatch 8, initialNumToRender 10, removeClippedSubviews) on the three heaviest screens (notifications, permits, parcels); memoized row components; stable callbacks |
| GET responses (repeat reads) | Instant (cache hit), TTL ≤ 60 s default | `apiGet` in `mobile/lib/_core/api.ts`: in-memory + AsyncStorage cache with TTL, in-flight dedup |
| Request hang | Never > 15 s | AbortController timeout (default 15 s) on all `apiCall` requests |
| Offline evidence sync | Survive restart; retry ≤ 8 attempts | `mobile/lib/offlineSync.ts` — AsyncStorage queue, exponential backoff (1 s → 5 min cap), dead-letter after 8 attempts, batch flush via `fieldInspection.syncBatch` |

## 2. Caching architecture

| Layer | Mechanism | TTL / invalidation |
|---|---|---|
| Server query cache | `server/queryCache.ts` (`withCache`, `TTL`, `CK` key builders) | Per-endpoint TTLs (search, compliance aggregates); used by public hot paths such as `sanctionsRegister.search` |
| Web service worker | `client/public/sw.js` | Static: stale-while-revalidate; API GET: network-first with 5-min cache fallback (offline only); versioned caches (`ndsep-v2-*`) flushed on activate |
| Mobile API cache | `apiGet` in `mobile/lib/_core/api.ts` | Two-tier: in-memory Map + AsyncStorage (`@ndsep/api-cache:*`), default TTL 60 s, > 512 KB payloads are memory-only; invalidated on logout or via `invalidateApiCache(prefix)` after mutations |
| Mobile platform bundle | `mobile/lib/mobile-sync.ts` | Full platform bundle snapshot in AsyncStorage, refreshed via tRPC and replayed against the offline queue |
| Offline mutation queues | `mobile/lib/mobile-sync-replay.ts` (local mission/geofence) + `mobile/lib/offlineSync.ts` (field-inspection evidence) | FIFO AsyncStorage queues; inspection evidence flushes in batches of ≤ 200 to the idempotent `fieldInspection.syncBatch` upsert (client UUID key, last-write-wins + version-vector merge) with backoff + dead-letter |
| Image caching | `expo-image` (`cachePolicy="memory-disk"`, `recyclingKey`) | OS-managed disk cache; used for field attachment thumbnails |

## 3. Load testing

Scripts and run instructions: `load-tests/k6/README.md`.

- `load-tests/k6/public-endpoints.js` — registry, sanctions, FOIA track
  (unauthenticated hot paths).
- `load-tests/k6/authed-api.js` — authenticated tRPC batch patterns
  (dashboard fan-in, reads, ~10 % idempotent writes) with ramping stages.
- SLO thresholds (reads p50 < 100 ms / p95 < 500 ms / p99 < 1 s; writes
  p95 < 1 s) are encoded as k6 `thresholds`, so runs exit non-zero on
  breach.
- Legacy `load-tests/k6-smoke.js` / `k6-stress.js` predate the superjson
  transformer — see the README note before using them.

## 4. Regression process

1. **Budgets in CI (recommended wiring):** run
   `k6 run load-tests/k6/public-endpoints.js` against a PR-deployed instance
   as a required check. k6 thresholds fail the job on an SLO regression —
   no extra assertion code needed. Add `authed-api.js` once CI can mint a
   test JWT/session.
2. **Bundle budget check:** run `pnpm build` with `ANALYZE=true` on release
   branches; flag if the entry + vendor chunk exceeds 400 KB gzip.
3. **DB budget check:** any migration touching hot-path tables must state
   its `EXPLAIN` impact in the PR; new indexes go through migration 0070's
   strategy rather than ad-hoc migrations.
4. **Mobile budgets:** cold-start and list-frame budgets are manual QA
   gates on release candidates (they cannot be measured in CI today — see
   "Known gaps" below).
5. **On breach:** treat as a release blocker; either fix the regression or
   amend this document with an explicit, reviewed budget change.

## 5. Known gaps / unmeasured items

- Mobile cold-start (< 3 s) and 60 fps list budgets are **not yet
  instrumented**; they are manual QA targets, not CI-enforced numbers.
- Web LCP/TTI budgets assume same-origin API deployment; a split-origin API
  deployment must add `preconnect`/`dns-prefetch` to `client/index.html`
  (comment marker in place).
- `client/public/sw.js` declares `API_CACHE_MAX_AGE` but does not yet
  enforce it (cached API responses are only bounded by cache-version bumps);
  background-sync handler is a documented placeholder.
- k6 SLO thresholds are validated for script syntax and endpoint shape, but
  baseline numbers must be captured from a staging run before treating
  threshold failures as blocking.
