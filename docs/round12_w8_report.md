# Round 12 — Wave 8: Learned Advisory Models (roadmap P2)

**Status: implemented.** Three learned, feedback-looped advisory models now
sit alongside the platform's authoritative rule engines: a settlement-terms
recommender (P(fulfilled) for a proposed term sheet), a penalty-calibration
badge (P(upheld on appeal) for a computed s.48 penalty), and learned
supervision risk weights (replacing the hand-seeded constants ONLY when an
active, fresh model exists). Every suggestion mints a `decision_feedback`
prediction (Wave-1 keystone) and every human verdict lands in the same
append-only acceptance log.

## What was delivered

| Artifact | Path |
|---|---|
| Settlement-terms recommender trainer | `ml/models/settlement_recommender.py` |
| Penalty-calibration trainer | `ml/models/penalty_calibration.py` |
| Risk-weight learner | `ml/models/risk_weight_learner.py` |
| Shared HGB JSON export/scorer | `ml/models/hgb_json.py` |
| Trainer tests (pytest, 17 tests) | `ml/tests/test_round12_w8_trainers.py` |
| Migration (learned weights) | `drizzle/migrations/0137_learned_risk_weights.sql` |
| Migration (calibration audit) | `drizzle/migrations/0138_penalty_calibration_audit.sql` |
| Extension schema | `drizzle/schema_ext/learnedRiskWeights.ts` |
| Recommender service | `server/services/settlementRecommender.ts` |
| Calibration service | `server/services/penaltyCalibration.ts` |
| Risk-weights accessor | `server/services/riskWeights.ts` |
| Pure-TS HGB scorer | `server/services/hgbArtifact.ts` |
| Routers (integrator mounts) | `server/routers/settlementRecommender.ts`, `server/routers/penaltyCalibration.ts` |
| Service tests (vitest) | `server/services/__tests__/{settlementRecommender,penaltyCalibration,riskWeights}.test.ts` |
| Client cards | `client/src/components/SettlementRecommendationCard.tsx`, `client/src/components/PenaltyCalibrationBadge.tsx` |
| Card mounts (additive) | `client/src/pages/SettlementWorkflow.tsx` (proposal panel), `client/src/pages/RevenueVerification.tsx` (below `SimilarPrecedentsPanel`) |
| Weekly training trigger | `ml/training/continuous.py` (`_run_weekly_trainers`, 168h cadence, fail-open) |
| Surgical weights wiring | `server/routers/supervisionRisk.ts` (`loadWeights` base from `getActiveWeights()`) |

## 1. Settlement-terms recommender

**Training** (`ml/models/settlement_recommender.py`):
HistGradientBoostingClassifier (scikit-learn is in
`workers/python/requirements.txt`, 1.7.2 in the dev env) trained on the
Wave-5 settlement outcome labels
(`ml/lakehouse/labels/settlement_outcome`). Features — all reproducible from
a *proposed* term sheet at serve time: `log_monetary_amount`,
`n_instalments`, `n_obligations`, `confidential`, `reduction_ratio`, plus
optional DB enrichments `duration_days` (instalment span) and
`org_size_score` (data-volume class ordinal) + one-hot `sector=<level>`
(joined via the SAME salted `org:<id>` pseudonym the label builder emitted —
no raw identifiers ever enter the frame). Artifact →
`ml/weights/settlement_recommender.json` with recorded feature list,
categorical levels, baseline, exported trees, and metrics (in-sample always;
25% holdout AUC/logloss when n>=40). Frames under 20 samples produce a
`usable=false` artifact with an explicit provisional warning.

**Serving** (`server/services/settlementRecommender.ts`): pure TS — the
exported ensemble is evaluated by `hgbArtifact.predictProba`
(`raw = baseline + Σ leaf`; leaf values already carry the learning rate —
pinned by a 1e-9 export-parity pytest). Suggested adjustments come from
FULFILLED similar settlements: `casePrecedents.searchCases`
(caseType='settlement', outcome='fulfilled') → their final
`settlement_terms` → median instalments / median reduction ratio; proposals
below/above those norms get an advisory adjustment (silent when fewer than
3 fulfilled precedents). Response: `{predictionId, fulfillmentProbability,
suggestedAdjustments[], precedentStats, degraded, reason}`. Degradation
(missing artifact, unreachable vector worker, failed DB) is explicit —
never a fabricated probability.

**UI**: "Recommendation" card in the SettlementWorkflow proposal panel with
Score → Accept / Edit terms / Reject; all three record to
`decision_feedback` (`surface='settlement_terms'`) via
`client/src/lib/feedback.ts`. Advisory only — the card never mutates the
proposal.

## 2. Penalty calibration (advisory; s.48 stays authoritative)

**Training** (`ml/models/penalty_calibration.py`): learns
`P(upheld | penalty_band, violation_type, org_size, legal_basis_section)`
by joining the Wave-5 penalty-survival labels to per-appeal context
(`penalty_appeals` ⋈ `financial_penalties` ⋈ `compliance_violations` ⋈
`organizations` ⋈ latest `enforcement_notices.legal_instrument_ref`) on the
pseudonymous `appeal_hash` — the join key requires the label hash salt and
RAISES without it (fail-closed). All features are one-hot categoricals with
an always-present `unknown` level; `penalty_band` derives from the amount
by the s.48 floors (`under_floor | 2m_10m | 10m_100m | over_100m`);
`legal_basis_section` is the parsed section token (e.g. `s.48`).

**Serving** (`server/services/penaltyCalibration.ts`): takes the
ALREADY-COMPUTED s.48 amount and returns `{predictionId, upholdProbability,
similarMedian, ...}` — `similarMedian` is the median band midpoint of
similar DECIDED enforcement precedents via `casePrecedents.searchCases`.
Every badge appends a `penalty_calibration_audit` row (migration 0138) with
the badge next to the VERBATIM computed amount. **HARD RULE honoured: no
code path here mutates any penalty — the vitest suite asserts the only DB
write is the audit INSERT.** Feedback surface: `penalty_calibration`.

**UI**: `PenaltyCalibrationBadge` in the RevenueVerification penalty preview,
mounted BELOW the existing `SimilarPrecedentsPanel` (untouched), clearly
badged "advisory — does not change the amount".

## 3. Learned supervision risk weights

**Training** (`ml/models/risk_weight_learner.py`): logistic regression over
`risk_score_inputs` rows (the exact inputs the router captured), labelled by
whether the org attracted a new published/remediated `enforcement_notices`
row within 180 days after collection. Features are normalised with the SAME
caps/class-scores as `supervisionRiskScoring.normalizeInputs` (a pytest
asserts parity). Weight vector = |coef| with a 0.02 floor, renormalised to
sum 1. Outputs: `ml/weights/learned_risk_weights.json` + an **INACTIVE**
row in `learned_risk_weights` (migration 0137).

**Activation is deliberate SQL** (no admin UI):

```sql
UPDATE learned_risk_weights SET active = false WHERE active;
UPDATE learned_risk_weights SET active = true WHERE version = '<version>';
```

**Serving** (`server/services/riskWeights.ts`): `getActiveWeights()` returns
the learned vector ONLY when an active row exists AND `trained_at` is fresh
(< 30 days) AND the payload covers all six factor keys with finite
non-negative values — otherwise it **fails closed** to
`DEFAULT_RISK_WEIGHTS`. `supervisionRisk.loadWeights()` now uses this as its
BASE; admin-tuned rows in the legacy `risk_weights` table still layer on
top (explicit human override outranks the model). Everything downstream
(`renormalizeWeightsForAvailability`, `computeCompositeScore`) is unchanged.

## 4. Training trigger

`ml/training/continuous.py` `run_cycle` now calls `_run_weekly_trainers()`
after `_produce_ab_outcomes()`: the three wave-8 trainers run on a 168h
cadence (state file `ml/lakehouse/training_runs/_weekly_trainers_state.json`,
timestamp advances on any clean run; exceptions retry next cycle). Each
trainer is **fail-open** — a failure logs a WARNING and records a run row
but never fails the fraud/credit/gnn cycle.

## Fail-closed / privacy posture

- All three trainers refuse frames carrying raw-identifier columns
  (`hgb_json.assert_no_raw_identifiers`, denylist mirroring
  `decisionFeedback.ts`); the penalty-calibration appeal join raises
  without `NDSEP_LABEL_HASH_SALT`/`ANONYMIZATION_SALT` (tested).
- Minted suggestion payloads carry only aggregate/categorical features —
  no party identifiers (the decisionFeedback denylist would reject them
  anyway); the calibration audit stores `org_hash` (keyed HMAC) or NULL.
- Every serving path degrades explicitly (`degraded` + `reason`), never
  fabricates, and never blocks the host screen.

## Validation

- `pytest ml/tests/test_round12_w8_trainers.py` — **17/17 pass**, including
  HGB export-parity (JSON scorer == sklearn `predict_proba` to 1e-9),
  normalisation parity with the TS scoring constants, artifact schemas,
  provisional flags, and fail-closed salt/identifier behaviour. Full
  `ml/tests/` suite: no regressions (the 8 failed + 6 errors in
  `test_ab.py`/`test_neo4j_graph.py` are pre-existing environment issues —
  identical with the wave-8 test file excluded).
- Migrations 0137/0138 validated with `sqlglot` (postgres dialect, 3
  statements each).
- `py_compile` clean on all new/edited Python.
- **vitest NOT run** (no usable node/ts tooling in this environment —
  `npm`/`tsc` disallowed and `node_modules/.bin` absent). The three vitest
  files are written against the established mock patterns
  (`server/routers/__tests__/casePrecedents.test.ts`); run
  `vitest run server/services/__tests__` where tooling is available.

## Integration notes (round integrator)

- Mount `settlementRecommenderRouter` under `settlementRecommender` and
  `penaltyCalibrationRouter` under `penaltyCalibration` in
  `server/routers.ts`; the client cards use the `(trpc as any)` pattern
  until then (same as `SimilarPrecedentsPanel`).
- Merge `drizzle/schema_ext/learnedRiskWeights.ts` into `drizzle/schema.ts`
  alongside migrations 0137/0138.
- `penalty_calibration` is a new (free-form) feedback surface; snake_case
  validated by `decisionFeedback.ts`.
