# Round 13 Wave 1 (P0.1) — OSIRIS Telegram breach early-warning feed

Wires OSIRIS's Telegram OSINT layer (`GET {OSIRIS_URL}/api/telegram-feed`,
public-channel posts scraped from `t.me/s/<channel>` previews, geoparsed)
into NDSEP's adverse-media pipeline as a breach early-warning source.

## Files

| File | Status | Purpose |
|---|---|---|
| `server/osiris/telegramClient.ts` | NEW | `fetchTelegramFeed({channels?, since?})` — 10s `AbortSignal.timeout`, 15-min in-memory cache, graceful `null` on any failure, field-by-field type narrowing (`narrowTelegramPost`) tolerating missing `geo`/`ts`/`url` and `{posts:[...]}` vs bare-array schema drift. Env: `OSIRIS_URL`, `OSIRIS_SCANNER_KEY`, `OSIRIS_TELEGRAM_CHANNELS`. Does NOT touch `server/osirisClient.ts`. |
| `workers/python/telegram_breach_watch_worker.py` | NEW | Polls the feed, classifies posts (keyword/regex breach rules + organizations-registry entity matching, mirroring `adverse_media_worker.py`; ambiguous posts optionally confirmed via ollama `/classify` → `/api/generate`, fail-closed to rules-only when unreachable), PII-redacts text (keyed-HMAC masks, `NDSEP_PII_HMAC_KEY`, same convention as `case_embedder_worker.redact_pii`) BEFORE persistence, ingests matched posts via the existing adverse-media path (`adverse_media_items` under seeded `source_key='osiris_telegram'` + `adverse_media_entity_matches`), dedups by post id (`UNIQUE(channel, post_id)`), emits `breach_notification_overdue` rows when a matched post names an entity with no `breach_incidents` self-report within ±72h of the post. HTTP `/health` `/status` `/run` + `--once`. |
| `server/routers/telegramWatch.ts` | NEW | `telegramWatchRouter` — all `staffProcedure` (same authz as adverseMedia): `listSignals(status, severity, channel, limit/offset)`, `confirmSignal` / `rejectSignal` (append `decision_feedback` rows, `surface='telegram_watch'`, keyed by the signal's stable `prediction_id` minted at insert), `breachLagList` (entity + `days_overdue`), `acknowledgeLagSignal`, `stats()`. Audit-log rows + mutation events per adverseMedia conventions. |
| `client/src/components/TelegramWatchPanel.tsx` | NEW | Signal queue with confirm/reject, breach-lag table with entity + days-overdue badges, stats header. Router accessed via structural cast until AppRouter type is regenerated post-mount. |
| `client/src/pages/AdverseMediaReview.tsx` | EDIT (surgical) | Added "Telegram watch" tab (`TabsTrigger` + `TabsContent` + import). Round-12 bulk-confirm/reject bar untouched. |
| `drizzle/migrations/0141_telegram_watch.sql` | NEW | `telegram_watch_items`, `breach_lag_signals`, `telegram_watch_watermarks`; seeds disabled `adverse_media_sources` row `source_key='osiris_telegram'`. sqlglot-validated (8 statements, postgres dialect). |
| `drizzle/schema_ext/telegramWatch.ts` | NEW | Drizzle defs for the three tables (integrator merges; `schema.ts` untouched). `adverseMediaItemId` is a plain integer — `adverse_media_items` has no Drizzle def (round-9 used raw SQL); FK enforced at DB level. |
| `server/routers/__tests__/telegramWatch.test.ts` | NEW | vitest, 9 tests: filters/pagination, confirm/reject + decision_feedback surface + prediction_id, CONFLICT on re-review, breachLagList days_overdue, stats, staff authz. |
| `workers/python/test_telegram_breach_watch_worker.py` | NEW | pytest, 24 tests: normalization/schema drift, redaction asserted (email/MSISDN/NIN raw values never survive, deterministic keyed masks), classifier rules + alias matching + fail-closed ollama, lag detector window semantics. |

## Exports to mount (integrator)

```ts
import { telegramWatchRouter } from "./routers/telegramWatch";
// in appRouter:
telegramWatch: telegramWatchRouter,
```

## Migrations

- `drizzle/migrations/0141_telegram_watch.sql` (idempotent, PostgreSQL-only).

## Test results

- vitest `server/routers/__tests__/telegramWatch.test.ts`: **9/9 passed**
  (`ESBUILD_BINARY_PATH=<staged 0.27.7 binary> node node_modules/vitest/vitest.mjs run ...` —
  the vite-bundled esbuild binary in node_modules lacks +x in this environment;
  a version-matched copy was staged under /tmp/esbuild-bins).
- pytest `workers/python/test_telegram_breach_watch_worker.py`: **24/24 passed**.
- sqlglot parse of 0141: **8 statements OK**.
- Scoped `tsc --noEmit` over the new/edited files: **0 errors in owned files**
  (full-project tsc OOMs in this environment; remaining errors in the scoped
  run are pre-existing in files not owned by this workstream).

## Notes / residual risk

- `decision_feedback` rows for worker-ingested signals carry no minted baseline
  'ignore' row (worker inserts via PostgREST); the first human decision is the
  first feedback row. `acceptanceRate` (DISTINCT ON prediction_id) is unaffected.
- The seeded `osiris_telegram` source stays `enabled=false` so the round-9
  adverse-media worker never treats it as an RSS source; the telegram worker
  maintains `last_status`/`last_polled_at` on that row for observability.
- OSIRIS feed unavailability degrades gracefully (cycle skipped, retried) and
  does not consume the DB-failure budget.
