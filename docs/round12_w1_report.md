# Round 12 — Wave 1 Report: decision_feedback subsystem (roadmap §4.1)

## Summary

Implemented the decision_feedback keystone: one Postgres table + migration, a
tRPC router (`decisionFeedbackRouter`), acceptance logging instrumentation on
all existing AI surfaces, typed client helpers, and vitest unit tests.

Every AI/rule-based suggestion now gets a `predictionId` (uuid) minted at
generation time (baseline `action='ignore'` row — an unanswered suggestion is
statistically an implicit ignore); when the human acts, the UI calls
`decisionFeedback.record`, which appends the real outcome row
(accept/edit/reject/ignore), emits `ndsep.feedback.recorded` via
`publishWithOutbox` (durable outbox, no schema change to server/kafka.ts), and
appends to the anti-wipe hash-chained `audit_ledger`.

## Files created

| File | Purpose |
|---|---|
| `drizzle/migrations/0127_decision_feedback.sql` | CREATE TABLE decision_feedback (uuid PK default gen_random_uuid(), CHECK on action, timestamptz default now()) + indexes (surface, created_at) and (prediction_id). Idempotent (IF NOT EXISTS). Postgres-native; validated with `sqlglot.parse(..., dialect='postgres')` → 3 Create statements, OK. |
| `drizzle/schema_ext/decisionFeedback.ts` | Drizzle table def following schema.ts patterns (object-style index callback, `$inferSelect`/`$inferInsert` types). For integrator merge into drizzle/schema.ts. |
| `server/routers/decisionFeedback.ts` | Router + instrumentation helper (see below). |
| `server/routers/__tests__/decisionFeedback.test.ts` | Vitest unit tests (mocks ../../db getPool, ../../kafka publishWithOutbox, ../../antiwipe/ledger appendLedger; createCaller pattern from server/banking.test.ts). |
| `client/src/lib/feedback.ts` | Typed helpers `acceptSuggestion` / `editSuggestion` / `rejectSuggestion` / `ignoreSuggestion` / `recordFeedback` + `computeEditDistance` (normalized Levenshtein). |
| `docs/round12_w1_report.md` | This report. |

## Files modified

| File | Change (minimal, additive) |
|---|---|
| `server/routers/platformIntelligence.ts` | `aiComplianceQuery`, `aiGenerateDPIA`, `aiGapAnalysis` now return `{...result, predictionId}` (surfaces `compliance_query`, `dpiagen`, `gap_analysis`). Added local `withPredictionId()` helper; no logic rewritten. |
| `server/routers/aimlRouter.ts` | `ollamaRouter.complianceQA` response gains `predictionId` (surface `compliance_qa`); one import line added. No logic rewritten. |

## Router export + mount path

- Export: `export const decisionFeedbackRouter` from `server/routers/decisionFeedback.ts`
- Intended mount: `decisionFeedback: decisionFeedbackRouter` in `server/routers.ts` (owned by integrator — NOT edited by this wave).
- Also exported for AI-surface instrumentation: `mintPrediction({surface, suggestion, actorId, modelVersion?})`, `actorUuid()`, `FEEDBACK_ACTIONS`, `KNOWN_SURFACES`, `FEEDBACK_TOPIC` (`ndsep.feedback.recorded`).

### Procedures

- `record` (protectedProcedure, mutation): `{predictionId, surface, action: accept|edit|reject|ignore, modelVersion?, suggestion?, finalValue?, editDistance?}`. Suggestion copied from prior row when omitted; `edit` requires `finalValue`.
- `acceptanceRate` (protectedProcedure, query): `{surface, windowDays=30}` → counts per action using LATEST outcome per prediction_id (`DISTINCT ON`), plus `acceptanceRate`, `decidedAcceptanceRate`, `avgEditDistance`.
- `listRecent` (protectedProcedure, query): `{surface?, action?, predictionId?, limit≤200, offset}` → camelCase rows + total.

## Design decisions

- **Append-only outcomes**: mint writes a baseline `ignore` row; `record`
  appends the real outcome. Analytics use latest-per-prediction so
  re-decisions supersede the baseline without UPDATEs (anti-wipe friendly).
- **actor_id**: table requires uuid but `users.id` is serial; a deterministic
  pseudonymous uuid is derived via sha256 (`actorUuid`, version-5 style) —
  groupable, never a raw identifier, no FK needed.
- **HMAC pseudonymization constraint**: router comments + recursive key
  denylist (`nin`, `bvn`, `subject_ref`, `email`, `phone_number`, ...) reject
  suggestion/final_value payloads carrying raw data-subject identifier keys
  (BAD_REQUEST). Documented in router header and client helper.
- **Best-effort minting**: `mintPrediction` never blocks the AI response — on
  DB failure it logs and still returns a uuid; a later `record` with inline
  `suggestion` still works.

## Tests

`server/routers/__tests__/decisionFeedback.test.ts` — 9 tests: record happy
path (INSERT params, kafka topic/key, ledger action), suggestion-copy path,
raw-identifier rejection, edit-requires-finalValue, acceptanceRate math
(incl. DISTINCT ON latest semantics), listRecent mapping/pagination,
mintPrediction baseline insert + degraded-mode, actorUuid determinism/shape.

## Validation performed

- Migration SQL parsed with sqlglot (postgres dialect): OK (3 statements).
- **NOT run**: npm/tsc/vitest — node_modules was still copying per wave-1
  constraint. Code was type-checked by close adherence to existing patterns
  (complaintAnalytics.ts exec/TRPCError style, banking.test.ts mocking,
  schema.ts table callback style, kafka.ts publishWithOutbox signature).

## Known issues / integrator notes

1. `decisionFeedbackRouter` is NOT yet mounted in `server/routers.ts` (owned
   by another wave). Until merged, `client/src/lib/feedback.ts` uses a
   structural type cast for the `decisionFeedback` namespace (documented in
   the file); after merge the cast can be dropped for full AppRouter typing.
2. platformIntelligence response shape change is additive (`+predictionId`)
   but clients expecting the raw service payload type will see an extra key;
   non-object service results are wrapped as `{result, predictionId}`.
3. Run vitest + `tsc --noEmit` once node_modules settles; test mocks assume
   the SQL shapes in decisionFeedback.ts (regex dispatch) — update the stub
   if SQL text changes.
4. Remaining surfaces named in the roadmap (triage, form_copilot,
   settlement_terms, risk_weights) can be instrumented by calling
   `mintPrediction` exactly as done in platformIntelligence/aimlRouter.
