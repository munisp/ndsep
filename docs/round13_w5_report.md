# Round 13 — W5 Report: OI Predictive Transfer Risk + OSIRIS SSE Streaming

Scope: P1.6 (predictive geopolitical risk for cross-border transfers via
OSIRIS's OI Forecast engine — MCP server + REST) and P1.7 (upgrade the
OSIRIS integration from polling to Server-Sent-Events streaming for
sanctions/threat updates).

## Deliverables

### A. OI Forecast transport layer

| File | Status | Notes |
|---|---|---|
| `server/osiris/mcpClient.ts` | NEW | Minimal spec-compliant MCP-over-HTTP client for `${OSIRIS_URL}/api/mcp` (JSON-RPC 2.0 POST): `openMcpSession()` (initialize handshake + best-effort `notifications/initialized` + `tools/list` discovery), `callMcpTool(name, args, timeoutMs)`, `mcpRpc()`, `parseMcpPayload()`. Tool names are **discovered at runtime, never hard-coded**; absence tolerated. Fail-closed: every entry point returns `{ok:true,value} \| {ok:false,reason}` and never throws — id mismatch, JSON-RPC error objects, non-2xx, unparseable bodies, and timeouts all yield `ok:false`. Both `application/json` and `text/event-stream` response framing tolerated. |
| `server/osiris/forecastClient.ts` | NEW | `runForecast(question, context, opts)`: prefers MCP (`findForecastTool` prefers `run_forecast`, falls back to any `*forecast*` tool), falls back to REST `POST /api/oi/forecast` with async-job polling (`GET /api/oi/forecast/:id`, 3s interval). One **hard deadline** across both transports (default 120s, env `OSIRIS_FORECAST_DEADLINE_MS`). `normalizeForecastPayload()` → `{forecastProbability, rationale, sources[], completedAt}`; percent-style probabilities coerced; **sources preserved verbatim** (extra provider keys kept) for audit. |

**KEY CUSTODY (data sovereignty):** OI is bring-your-own-key. The key is
read **server-side only** from `process.env.OSIRIS_OI_KEY` at call time and
sent as `Authorization: Bearer`. It is never accepted from client input
(no router input carries key material), never logged, never persisted —
only the boolean `model_key_present` is recorded. With no key configured,
`runForecast` returns `status:'unavailable'` and performs **zero network
calls** (test-asserted). **Production guidance: route forecasts through
NDSEP's LOCAL ollama as the OI model backend where possible** (OSIRIS
supports operator-chosen model backends) so simulation inputs never leave
sovereign infrastructure; an external provider key is an explicit operator
choice, not a default.

### B. Blending service + router

| File | Status | Notes |
|---|---|---|
| `server/services/transferRiskForecast.ts` | NEW | `forecastTransferRisk(countryIso)`: question = "Probability that \<country\> experiences conflict escalation or sanctions regime change affecting data-hosting risk in the next 12 months"; static risk from `getConflictRiskLevel` (osirisClient **read-only, unmodified**). **24h per-country cache** (env `OSIRIS_FORECAST_CACHE_MS`) implemented as latest-persisted-row-younger-than-TTL — forecasts are expensive. Blending rules (pure `blendRisk()`, full matrix tested): static critical stays critical; p≥0.6 upgrades one level (capped at critical); p<0.2 with static elevated/high keeps static; no downgrade ever; unavailable/timeout/error → static with the reason recorded in the rationale (fail-visible). Persists every fresh run to `transfer_risk_forecasts` and mints a `decision_feedback` baseline (surface `transfer_forecast`). DI seam (`TransferRiskDeps`) for tests. Also `listLatestForecasts`, `latestForecastForCountry` (cheap DB-only reads), `resolveIsoForCountry` (destination_risk_register first, two-letter prefix fallback — same heuristic as phase13Features). |
| `server/routers/transferForecast.ts` | NEW | `transferForecastRouter` (all `staffProcedure`): `forecastForCountry(iso)` (staff **mutation** — fresh runs are deliberate), `blendedRiskForDeclaration(declarationId)` (review-time, resolves declaration destination → ISO → cache-first blend), `latestForCountry(iso)` (badge read, never triggers a run), `listForecasts()`, `agreeForecast`/`disagreeForecast` (append officer outcome to `decision_feedback` under surface `transfer_forecast`, emit `ndsep.feedback.recorded`, hash-chained `audit_ledger`), `intelStreamStatus()` (P1.7 stream health + snapshot freshness). |

### C. SSE streaming (P1.7)

| File | Status | Notes |
|---|---|---|
| `server/osiris/snapshotStore.ts` | NEW | In-memory latest-snapshot store (`sanctions` / `threats` streams) with eventId, updatedAt, stale flag (30min). `getSanctionsSnapshot()` / `getThreatSnapshot()` are the read-before-polling seam. |
| `server/osiris/sseSubscriber.ts` | NEW | Server-side SSE subscriber: connects to `${OSIRIS_URL}${OSIRIS_SSE_PATH}` (default `/api/osint/stream`; `/api/sse` accepted via env), incremental spec-compliant parser (multi-line `data:`, CRLF, comments, BOM), routes `sanctions-update`/`threat-update` into the snapshot store, **tolerates unknown event types** (counted, debug-logged, never fatal), unparseable payloads never overwrite a good snapshot. Reconnect with exponential backoff (1s→30s cap) and `Last-Event-ID` resume. `startOsirisStream()` idempotent, **no import side effects** — the integrator wires it at server boot; `stopOsirisStream()` for shutdown; `getIntelStreamHealth()` for ops. |

**INTEGRATOR NOTE — future osirisClient.ts refactor (NOT done this round;
`server/osirisClient.ts` is owned elsewhere and untouched):** to make the
polling client stream-first, in `searchSanctions()` read
`getSanctionsSnapshot()` first (filter by query; fall through to
`osirisGet` on miss/stale), and in `getCyberThreats()` return
`getThreatSnapshot().data` when fresh. Validate stream payloads to the
existing `OsirisSanctionEntity[]` / `{threats, stats}` shapes at the seam —
same defensive parsing as the GET path. Until then, consumers can call
`transferForecast.intelStreamStatus()` to observe stream health.

### D. Schema

| File | Status | Notes |
|---|---|---|
| `drizzle/migrations/0147_transfer_risk_forecasts.sql` | NEW | Append-only history table `transfer_risk_forecasts` (id uuid PK, country_iso, static_risk CHECK, forecast_probability NULL-able 0..1 — null = fail-visible run, blended_level CHECK, rationale text, sources jsonb default '[]', model_key_present bool, prediction_id uuid nullable → decision_feedback baseline, created_at timestamptz) + `(country_iso, created_at DESC)` and `(created_at DESC)` indexes. sqlglot-validated (postgres dialect, 3 statements). Idempotent. |
| `drizzle/schema_ext/transferRiskForecasts.ts` | NEW | Drizzle defs (hand-off artifact; `drizzle/schema.ts` owned by another workstream). |

### E. Client (additive mounts only)

- `client/src/components/TransferForecastBadge.tsx` — NEW. Blended-risk
  chip (level + probability) with popover: static vs forecast vs blended,
  full rationale, **source links preserved from OI**, reading age/cache
  state, staff Agree/Disagree (decision_feedback), explicit "Run forecast"
  mutation (badges never auto-trigger expensive runs — they read
  `latestForCountry` only). Uses `(trpc as any)` per the InsiderThreat.tsx
  precedent until the router mount lands.
- `client/src/pages/CrossBorderDeclarationsReview.tsx` — SURGICAL, additive
  only: new "Risk forecast" column in the Declarations table and "Forecast"
  column in the Destination risk tab (badge mounts; colSpans adjusted).
  Round-12 FormCopilotInput tab and all existing logic untouched.

## Mount required (lead)

```ts
// server/routers.ts
import { transferForecastRouter } from "./routers/transferForecast";
// appRouter:
transferForecast: transferForecastRouter,
```

```ts
// server boot (integrator's choice of entrypoint)
import { startOsirisStream } from "./osiris/sseSubscriber";
startOsirisStream(); // idempotent; stopOsirisStream() on shutdown
```

Migration: apply `drizzle/migrations/0147_transfer_risk_forecasts.sql`;
merge `drizzle/schema_ext/transferRiskForecasts.ts` into `drizzle/schema.ts`.

## Tests & validation

- `server/osiris/__tests__/mcpClient.test.ts` (13): handshake/discovery,
  zero-tools tolerance, id mismatch, JSON-RPC errors, HTTP/network/timeout
  failure, SSE-framed responses, Bearer-from-env custody.
- `server/osiris/__tests__/forecastClient.test.ts` (13): **key custody —
  no key ⇒ unavailable and fetch never called**; MCP-preferred completion;
  REST fallback on MCP-unreachable and on no-forecast-tool; sync + polled
  async REST completion; hard-deadline timeout; failed-job mapping;
  normalization (percent coercion, nested payloads, citations/references
  fallback, sources verbatim).
- `server/services/transferRiskForecast.test.ts` (17): full
  static×probability blending matrix (28 cells), rule tags, no-downgrade,
  cache serve without re-run, persistence contents (sources + key flag +
  prediction_id), unavailable→static fail-visible, 42P01 survival,
  feedback-mint failure survival, listLatest mapping.
- `server/osiris/__tests__/sseSubscriber.test.ts` (12): parser chunk
  boundaries/CRLF/comments, routing, unknown-event tolerance, bad-JSON
  non-overwrite, staleness, backoff curve, live loop with mocked streams —
  snapshots updated, reconnect sends `Last-Event-ID: 101`, error/reconnect
  health, `OSIRIS_SSE_PATH` override.

All 55 new tests pass; adjacent suites (`server/osiris/__tests__` incl.
scanner/recon/crypto/disasterMaritime, `hostingVerification`) — 95 tests
total across 7 files — all green:

```
ESBUILD_BINARY_PATH=/tmp/esb-kimi/esbuild node node_modules/vitest/vitest.mjs run \
  server/osiris/__tests__ server/services/transferRiskForecast.test.ts \
  server/services/hostingVerification.test.ts
# Test Files 7 passed (7) · Tests 95 passed (95)
```

`tsc --noEmit`: **zero errors in any W5 file** (36 total errors remain, all
pre-existing in other workstreams' files — e.g. 4 in
CrossBorderDeclarationsReview.tsx predate this change: they are the
Round-12 `(data as any)?.data ?? (data as any[])` casts at shifted line
numbers, intentionally left untouched).

Note: the mission's `ESBUILD_BINARY_PATH=/tmp/esbuild-bins/esbuild-0.27.7`
binary was absent (and node_modules' esbuild binaries sit on a fuse.portal
mount that ignores chmod), so the repo's own esbuild 0.27.7 binary was
copied to `/tmp/esb-kimi/esbuild` and used instead.

## Constraints honoured

- No edits to `server/routers.ts`, `drizzle/schema.ts`,
  `server/osirisClient.ts`, `crossBorderDeclarations.ts` logic,
  `workers/temporal/`. New files + the additive badge mount only.
- `server/routers/copilotDraft.ts` untouched (forecast enrichment of review
  drafts deliberately left to a future round; this round exposes its own
  router).
