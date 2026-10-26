# Round 12 — Wave 6: Case-Similarity Retrieval (roadmap §4.3)

**Status: implemented.** The Commission's own decided cases are now embedded
into a dedicated Qdrant collection (`ndsep_cases`), and collapsible "Similar
precedents" panels surface scored precedent cards in the triage, settlement,
and penalty screens. Suggestion acceptance on those panels is logged through
the Wave-1 `decision_feedback` keystone (`surface='precedents'`).

## What was delivered

| Artifact | Path |
|---|---|
| Incremental case embedder worker | `workers/python/case_embedder_worker.py` (port 8202) |
| Watermark migration | `drizzle/migrations/0134_case_embeddings.sql` |
| tRPC router | `server/routers/casePrecedents.ts` (`casePrecedentsRouter`) |
| Client panel | `client/src/components/SimilarPrecedentsPanel.tsx` |
| Panel mounts | `client/src/pages/ComplaintTriage.tsx` (complaint detail side panel), `client/src/pages/SettlementWorkflow.tsx` (proposal/counter stage), `client/src/pages/RevenueVerification.tsx` (s.48 penalty preview) |
| Router tests (vitest) | `server/routers/__tests__/casePrecedents.test.ts` |
| Redaction tests (pytest) | `workers/python/test_case_embedder_worker.py` |

## How it works

### Embedding pipeline (`case_embedder_worker.py`)

Sources, decided/closed rows only:

| Source table | Embedded when |
|---|---|
| `public_complaints` | `status IN ('resolved','closed')` |
| `enforcement_cases` | `status IN ('settled','closed')` |
| `settlements` | `status IN ('fulfilled','defaulted')` |
| `tribunal_escalations` | `status = 'decided'` |

For each new row the worker builds a **redacted text card** (case type,
category, sector, violation types, outcome, penalty band, decided-at, plus a
truncated redacted summary), embeds it with the **same sentence-transformers
path as `qdrant_vector_worker.py`** (`EMBED_MODEL=all-MiniLM-L6-v2`, dim 384,
batch 32, cosine), and upserts into `ndsep_cases` with payload
`{case_type, case_id, reference, category, sector, outcome, penalty_band,
decided_at, indexed_at}`. Point ids are deterministic
(`md5("case-<type>-<id>")`, same pattern as the existing worker), so re-runs
are idempotent.

**PII hard constraint.** Complainant/respondent PII columns
(`complainant_name/email/phone`, `respondent_name/email`, submitter IP hash,
data-subject fields) are *never SELECTed* (enforced by a test). Free-text
fields that may incidentally carry PII pass through `redact_pii()`, which
replaces emails, Nigerian/international MSISDN shapes, 11-digit NIN/BVN runs,
and 8–16 digit identifier runs with keyed-HMAC masks
(`NDSEP_PII_HMAC_KEY`; warns loudly when unset). Penalty amounts are bucketed
into bands (`none / under_2m / 2m_10m / 10m_50m / over_50m / non_ngn`) — the
raw amount is never embedded.

**Incrementality.** `case_embedding_watermarks` (migration 0134:
`source_table text PK, last_id text, last_run_at timestamptz`) stores the
highest embedded source id per table. A run processes `id > last_id`
ascending and advances the watermark **only after a successful Qdrant
upsert**, so crashes retry safely. On embedding or upsert failure the
watermark is not advanced.

### Retrieval (`server/routers/casePrecedents.ts`)

- `similarCases({caseType?, queryText? | complaintId?, limit=5})` —
  `staffProcedure` (admin / government_staff / auditor, same gate as
  complaint-handling). With `complaintId` the server builds the query from
  the complaint's category/subject/description. Query text is PII-scrubbed
  (`redactQueryText`) before leaving the server. Retrieval is over HTTP to
  the vector worker's `GET /search?q=…&collection=ndsep_cases`
  (`QDRANT_WORKER_URL`, default `http://localhost:8200`) — the pattern other
  server code uses for Qdrant (there is no direct Qdrant client in `server/`).
  **Fail-closed:** worker unreachable/error/empty →
  `{results: [], degraded: true, reason}`; no fabricated precedents, no
  exception breaking the host screen. Every non-degraded response mints a
  `decision_feedback` prediction (via Wave-1 `mintPrediction`,
  `surface='precedents'`) and returns its `predictionId`.
- `logPrecedentOutcome({predictionId, helpful, caseType?, caseId?, note?})` —
  delegates to `decisionFeedback.record` (helpful→`accept`,
  not-helpful→`reject`, verdict in `finalValue`) so verdicts land in the
  same append-only acceptance log with outbox event + audit-ledger trail.

### Client panel (`SimilarPrecedentsPanel.tsx`)

Collapsible card (collapsed by default; only queries when expanded). Lists
top-k precedents with similarity score, case type, outcome and penalty-band
badges, decided date, and per-card **Helpful / Not helpful** buttons wired to
`logPrecedentOutcome` with the response's `predictionId`; one vote per card.
Degraded state renders an explicit yellow notice. Mounts:

- **ComplaintTriage** — inside the complaint-detail side panel
  (`caseType="complaint"`, `complaintId` of the selected complaint).
- **SettlementWorkflow** — at the proposal/counter stage of a selected
  settlement (`caseType="settlement"`, query built from case ref + amounts).
- **RevenueVerification → Penalty preview tab** — below the s.48 preview
  result (`caseType="enforcement"`, query built from the s.48 factor posture:
  intent, data-subject count, DCPMI flag, remediation, priors — no PII).

The router is mounted under the `casePrecedents` namespace by the round
integrator in `server/routers.ts` (that file is owned by another workstream);
until then the panel uses the same `(trpc as any)` pattern as `bulkOps`.

## How to run the embedder

Prereqs: Postgres DSN (`WORKER_DATABASE_URL` or `DATABASE_URL`), Qdrant
(`QDRANT_URL`), migration 0134 applied, Python deps as per
`workers/python/requirements.txt` (psycopg2, qdrant-client,
sentence-transformers). Recommended: set `NDSEP_PII_HMAC_KEY`.

- **Long-running worker (default):** `python3 workers/python/case_embedder_worker.py`
  — runs one pass ~10s after boot, then every `CASE_EMBEDDER_INTERVAL`
  seconds (default 600). HTTP on port 8202: `GET /health`, `GET /status`,
  `POST /run` (trigger a pass).
- **Cron / Temporal pattern:** `python3 workers/python/case_embedder_worker.py --once`
  — a single incremental pass; exit code 0 on success, 1 if any source pass
  errored. Suitable for a cron entry or a Temporal activity
  (**do not** add Temporal schedules here — that is owned by the Temporal
  workstream).

## Validation performed

- `python3 -m py_compile workers/python/case_embedder_worker.py
  test_case_embedder_worker.py` — OK.
- Redaction/card/banding tests: **15/15 pass** (pytest unavailable in this
  offline sandbox, so the pytest module was executed with a minimal runner;
  the file is standard pytest and runs under `pytest
  workers/python/test_case_embedder_worker.py` in CI). Covered: emails,
  MSISDN variants (+234/234/0-prefix, spaced), NIN/BVN 11-digit runs, long
  identifier runs — raw PII strings asserted absent from output; PII columns
  asserted absent from all source SQL; decided/closed status filters
  asserted; penalty-band buckets; deterministic point ids.
- Migration 0134 is Postgres-native and mirrors the 0127/0131 header and
  `IF NOT EXISTS` conventions. **sqlglot validation could not be run** —
  `sqlglot` is not installed and the sandbox has no network (pip install
  fails); `psql`/`pglast` are also unavailable. The migration contains one
  `CREATE TABLE IF NOT EXISTS` and one idempotent `INSERT … ON CONFLICT DO
  NOTHING`, both standard Postgres.
- vitest suite `server/routers/__tests__/casePrecedents.test.ts` is written
  (mocked pg pool, mocked `../decisionFeedback`, stubbed global `fetch`;
  covers mapping, caseType filter, fail-closed degradation, complaintId path
  + PII scrub, staff AuthZ, helpful/not-helpful mapping, `redactQueryText`)
  but **could not be executed here**: `node_modules` is incomplete (no
  vitest/typescript/zod) and running npm installs is out of scope per the
  wave constraints. Run with `npx vitest run server/routers/__tests__/casePrecedents.test.ts`.

## Notes for the integrator

- Mount in `server/routers.ts`: `import { casePrecedentsRouter } from
  "./routers/casePrecedents"` and `casePrecedents: casePrecedentsRouter`
  (same treatment as `decisionFeedback` in Wave 1).
- `drizzle/schema_ext/caseEmbeddings.ts` was intentionally **not** created:
  the watermark table is only touched by the Python worker via raw SQL; no
  server TS code reads it, so a Drizzle binding would be dead code.
- Qdrant collection `ndsep_cases` is created lazily by the embedder worker
  (cosine, dim 384); no server-side provisioning needed.
- Residual risk: query-time PII scrub is regex-based defence-in-depth (the
  indexed side is guaranteed redacted; the query text is never persisted).
  Semantic similarity scores are cosine on MiniLM and are advisory only —
  the panel labels them as such.
