# Round 13 — W6 (P2.8 / P2.9 / P2.10): Infrastructure Risk Watch + Self-hosted OSIRIS

## Integrator mount line

```ts
import { infrastructureRiskRouter } from "./routers/infrastructureRisk";
// in appRouter:
infrastructureRisk: infrastructureRiskRouter,
```

Scheduling: call `runInfrastructureRiskSweep()` from
`server/services/infrastructureRiskWatch.ts` (plain async; Temporal wiring
intentionally left to the integrator — `workers/temporal/` untouched).

## What was built

### P2.8 — Disaster-driven availability risk
- `server/osiris/disasterClient.ts` (NEW): `fetchEarthquakes()` (USGS M2.5+),
  `fetchFires()` (NASA FIRMS), `fetchSevereWeather()` (EONET). osirisClient
  conventions: `OSIRIS_URL` base (default https://osirisai.live), optional
  `X-Scanner-Key`, 10s timeout, 15-min cache, graceful `null`, tolerant
  field narrowing (renamed keys / string numbers / extra fields absorbed;
  malformed records dropped).
- Core: `assessAvailabilityRisk()` in `server/services/infrastructureRiskWatch.ts`
  triangulates each DISTINCT hosting-declaration location against active
  hazards via haversine. Thresholds: earthquake M≥4.5 ≤100 km, fire ≤50 km,
  severe weather ≤150 km. Rows → `availability_risk_events`
  (open/acknowledged/closed), idempotent upsert.
- Coordinates are DERIVED from declaration location fields: explicit
  lat/lng keys win; else a small curated map of well-known Nigerian
  DC/city coordinates (`KNOWN_LOCATION_COORDS`, provenance-noted: Rack
  Centre Oregun, MDXi/Lekki, Lagos, Abuja, Ibadan, Port Harcourt, Kano,
  Bonny). Geocoding is out of scope; unresolvable declarations are skipped
  and COUNTED (`declarationsSkippedNoCoordinates`), never guessed.

### P2.9 — Maritime anomaly watch (cable landings)
- `server/osiris/maritimeClient.ts` (NEW): `fetchVesselsInArea(lat, lng,
  radiusKm)` — same client conventions, drift-tolerant (numeric MMSI,
  `sog`/`nav_status` aliases, bare arrays).
- Core: `assessCableWatch()` — vessel within 2 km of a seeded landing point
  AND (speed < 1 kt OR status anchoring/moored) → `cable_watch_alerts`
  (one row per point+vessel; repeat sightings update `last_seen_at`).
- Fixed early-warning copy: "possible anchoring/trawling risk near cable
  landing — physical-layer resilience" (`CABLE_ALERT_SIGNAL`).
- Seed: `cable_landing_points` — 6 points (MainOne/Glo-1/WACS/ACE/2Africa
  at Lekki-Alpha Beach Lagos; SAT-3 at Bonny Island), provenance
  `public-approx-2026-10`, note "approximate — public sources".

### Alerting contract
Every NEW alert appends to the hash-chained `audit_ledger`
(`appendLedger`) and publishes `ndsep.sovereignty.infra_risk` via
`publishWithOutbox` (durable outbox). Feed outages are recorded in the
sweep summary as `null` counts — never phantom "all clear". Missing
migration 0148 degrades the sweep to a no-op with `tableMissing: true`.

### Router + client
- `server/routers/infrastructureRisk.ts`: `listAvailabilityRisks(status?)`,
  `listCableAlerts(status?)`, `acknowledge(kind, id, target_status?)`
  (staff; audit_logs + ledger + outbox via
  `acknowledgeInfrastructureRisk`), `stats()`, `seedStatus()`. Reads
  degrade with a "migration 0148 not applied yet" note on 42P01.
- `client/src/components/InfrastructureRiskPanel.tsx` (NEW): two sections
  (availability risks / cable alerts) with acknowledge + close actions,
  stats strip, seed-status card. Mounted as a new "Infrastructure risk"
  tab in `client/src/pages/DataSovereigntyDashboard.tsx` (additive; other
  tabs untouched). Uses the `(trpc as any).infrastructureRisk` pattern
  until the integrator mounts the router (same as TelegramWatchPanel).

### P2.10 — Self-hosted OSIRIS
- `infra/osiris/docker-compose.osiris.yml`: `ghcr.io/simplifaisoul/osiris:latest`,
  `OSIRIS_PORT` host port (default 3000), `SCANNER_URL`/`SCANNER_KEY`
  passthrough, `:3000/health` healthcheck, `restart: unless-stopped`,
  non-root note (no root override).
- `scripts/envExampleGen.mjs`: new `STATIC_BLOCKS` mechanism appends the
  commented self-hosted block (`# OSIRIS_URL=http://osiris:3000`,
  `# OSIRIS_SELF_HOSTED=true`, `# OSIRIS_PORT=3000`) to `.env.example`;
  `OSIRIS_SELF_HOSTED` is also a real scanned var (default `false`) used
  by both new clients. `node scripts/envExampleGen.mjs --check` green.
- `docs/infra-osiris.md`: sidecar runbook, graceful-degradation matrix,
  scanner key generation (`openssl rand -hex 32`).

### Persistence
- `drizzle/migrations/0148_infrastructure_risk.sql`: `cable_landing_points`
  (+6-row seed), `availability_risk_events`, `cable_watch_alerts`.
  Idempotent, Postgres-native, sqlglot-validated (8 statements parse).
- `drizzle/schema_ext/infrastructureRisk.ts`: drizzle table defs
  (hand-off snippet, mirrors schema_ext convention).

## Tests
- `server/services/infrastructureRiskWatch.test.ts` (27 tests): haversine
  sanity, full threshold matrix (boundary-inclusive), vessel anomaly rules
  (slow+near → alert; fast transit → none; unverifiable → none),
  location derivation + skip counting, seed presence (6 points, provenance,
  Lekki/Bonny clustering), acknowledge flow + ledger/outbox writes,
  sweep orchestration incl. feed-outage and missing-table degradation.
- `server/osiris/__tests__/disasterMaritimeClients.test.ts` (9 tests):
  graceful null on HTTP/network failure, tolerant narrowing under schema
  drift, cache behaviour.
- Run: `ESBUILD_BINARY_PATH=/tmp/esb/esbuild node node_modules/vitest/vitest.mjs run <files>`
  — 36/36 pass.

## Known follow-ups for the integrator
- Mount `infrastructureRisk: infrastructureRiskRouter` in
  `server/routers.ts` (orphan-router CI gate currently also lists the
  other round-13 routers pending mount — same pattern).
- Wire `runInfrastructureRiskSweep()` into Temporal scheduling.
- `.env.example` is regenerated by scanning all of `server/`, so it also
  absorbs other round-13 agents' new vars; last-writer-wins by design.
