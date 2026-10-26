# Round 13 Wave 4 (P1.5) — OSIRIS GDELT + live-news adverse-media feeds

Broadens adverse-media coverage with OSIRIS's GDELT events layer
(`GET {OSIRIS_URL}/api/gdelt` — geocoded events) and its 23-broadcaster
live-news layer (`GET {OSIRIS_URL}/api/news` — broadcast headlines). Geocoded
events and broadcast mentions naming supervised Nigerian entities auto-create
adverse-media candidates (via the EXISTING `adverse_media_items` ingestion
path) with provenance URLs, PII redaction, source-native-id dedup, and
per-source high-water marks.

## Files

| File | Status | Purpose |
|---|---|---|
| `server/osiris/gdeltClient.ts` | NEW | `fetchGdeltEvents({country?, query?, since?})` — 10s `AbortSignal.timeout`, 15-min in-memory cache, graceful `null` on any failure, field-by-field narrowing (`narrowGdeltEvent`) tolerating missing geo/ts/url/actors/tone and `{events:[...]}` vs bare-array drift (also accepts `event_id`/`guid`, `headline`/`name`, `lat`/`latitude`, `lng`/`lon`/`longitude`). Env: `OSIRIS_URL`, `OSIRIS_SCANNER_KEY`. Does NOT touch `server/osirisClient.ts`. |
| `server/osiris/newsClient.ts` | NEW | `fetchNewsMentions({query?})` — same defensive conventions; normalizes the grouped `{channels:[{name, headlines:[...]}]}` shape plus flat `{headlines:[...]}` / `{streams:[...]}` / bare-array drift into flat `{channel,title,url,ts}` mentions. |
| `workers/python/gdelt_adverse_media_worker.py` | NEW | Polls both sources. Keeps an item only when it carries adverse signals (data breach / outage / fraud / sanction / lawsuit / regulator / fine / hack — configurable via `OSIRIS_INTEL_EXTRA_KEYWORDS`) AND is Nigeria-relevant: NG geolocation (bounding box lat 4–14, lng 2.6–15, or country=Nigeria/NG/NGA) OR a registered-organization match (exact/alias/fuzzy against `organizations`, mirroring `adverse_media_worker.py`). Confidence: geo+entity 0.9 (highest), entity-only 0.6, NG-geo-only 0.5; keyword-only items are DROPPED. Ingests via the existing path under `source_key='osiris_gdelt'`/`'osiris_news'` with provenance URL, PII redaction BEFORE persistence (keyed-HMAC masks, `NDSEP_PII_HMAC_KEY`, same convention as `case_embedder_worker.redact_pii`), dedup by source-native id (`url_hash = sha256('<source_key>://<native_id>')`), suggested `adverse_media_entity_matches`, and `osiris_intel_watermarks` high-water marks. HTTP `/health` `/status` `/run` (optional body `{"sources":["gdelt"|"news"]}`) + `--once`. Port `WORKER_PORT` (default 8118). DB: `GDELT_WATCH_DB_API_URL` or `ADVERSE_MEDIA_DB_API_URL`. Fail-loud config; OSIRIS unavailability degrades gracefully without consuming the DB-failure budget. |
| `server/routers/osirisIntelFeed.ts` | NEW | `osirisIntelFeedRouter` — `feedStatus()` (watermarks, seeded source rows' last_status/last_polled_at, per-source item counts incl. review-status breakdown; `staffProcedure`), `listRecentItems({source?, review_status?, limit, offset})` (thin read view over `adverse_media_items` joined to `adverse_media_sources` filtered by the two new source_keys; `staffProcedure`), `triggerPoll({source?})` (`adminProcedure`; POSTs the worker `/run` with `X-Worker-Auth`; FAIL-CLOSED — unreachable/non-OK worker raises a tRPC error, never a fake success). Audit-log rows + mutation events per adverseMedia conventions. |
| `client/src/pages/AdverseMediaReview.tsx` | EDIT (surgical) | Source filter chip row in the review-queue tab (All + pinned `osiris_telegram`/`osiris_gdelt`/`osiris_news` + any other source_keys present in the queue page). Client-side slice over `reviewQueue` results (which carry `source_key`); `adverseMedia.reviewQueue` untouched. Round-12 bulk bar and Round-13 telegram tab not disturbed. |
| `drizzle/migrations/0146_osiris_intel_feeds.sql` | NEW | `osiris_intel_watermarks (source TEXT PK, last_seen_id TEXT, last_run_at TIMESTAMPTZ, stats JSONB)`; seeds disabled `adverse_media_sources` rows `osiris_gdelt`/`osiris_news` (managed_by `gdelt_adverse_media_worker`). Index note: `adverse_media_items` has no `source_key` column — source slicing joins through `adverse_media_sources.source_key` (already UNIQUE) on `source_id`, already covered by `idx_adverse_media_items_source (source_id, fetched_at DESC)` from 0112; no new index needed. sqlglot-validated (3 statements, postgres dialect). |
| `drizzle/schema_ext/osirisIntelFeeds.ts` | NEW | Drizzle def for `osiris_intel_watermarks` (integrator merges; `schema.ts` untouched). |
| `server/routers/__tests__/osirisIntelFeed.test.ts` | NEW | vitest, 9 tests: feedStatus aggregation, listRecentItems source/review_status/pagination filters, triggerPoll worker-POST shape + audit + event, fail-closed on worker unreachable / non-OK, staff gating on reads, admin-only triggerPoll. |
| `workers/python/test_gdelt_adverse_media_worker.py` | NEW | pytest, 22 tests: event/headline normalization + schema drift, NG bounding-box + country-name geo filter, classifier tiers (geo+entity highest, entity-only medium, geo-only low, keyword-only dropped), alias matching, keyword coverage, PII redaction (email/MSISDN/NIN raw values never survive, deterministic keyed masks), source-scoped dedupe hashing. |

## Exports to mount (integrator)

```ts
import { osirisIntelFeedRouter } from "./routers/osirisIntelFeed";
// in appRouter:
osirisIntelFeed: osirisIntelFeedRouter,
```

## Migrations

- `drizzle/migrations/0146_osiris_intel_feeds.sql` (idempotent, PostgreSQL-only).

## Test results

- vitest `server/routers/__tests__/osirisIntelFeed.test.ts`: **9/9 passed**
  (`ESBUILD_BINARY_PATH=/tmp/esbuild-bins/esbuild-0.27.7 node node_modules/vitest/vitest.mjs run ...`).
- pytest `workers/python/test_gdelt_adverse_media_worker.py`: **22/22 passed**.
- sqlglot parse of 0146: **3 statements OK** (postgres dialect).
- Worker fail-loud verified: `--once` without `GDELT_WATCH_DB_API_URL`/`ADVERSE_MEDIA_DB_API_URL` exits 2.
- `tsc --noEmit` (full project): **0 errors in owned files**; the 35 reported
  errors are pre-existing in files not owned by this workstream
  (e.g. CrossBorderDeclarationsReview.tsx, InternationalCooperation.tsx).

## Notes / residual risk

- Review of ingested items flows through the EXISTING `adverseMedia` queue
  (confirm/reject/link), which does not write `decision_feedback` rows; the
  telegram-watch pattern of prediction_id-keyed feedback is not replicated
  here because candidates live in the round-9 table, not a round-owned table.
  If feedback capture on these items is later required, add a prediction_id
  side-table rather than altering `adverse_media_items`.
- The seeded `osiris_gdelt`/`osiris_news` sources stay `enabled=false` so the
  round-9 adverse-media worker never treats them as fetchable feeds; the new
  worker maintains `last_status`/`last_polled_at` on those rows.
- Broadcast headlines carry no geocode, so their Nigeria relevance is
  entity-match-only by construction (keyword-only broadcast headlines are
  dropped); GDELT events additionally qualify via NG geolocation.
- `triggerPoll` uses a 120s timeout (a full poll cycle fetches two sources);
  worker URL via `OSIRIS_INTEL_WORKER_URL` (default `http://localhost:8118`).
