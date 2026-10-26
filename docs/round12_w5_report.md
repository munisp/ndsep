# Round 12 — Wave 5: ML-labeling loop (roadmap §4.2 + §4.5)

## Summary

Human verdicts and platform outcomes are now wired back into training, and the
A/B framework has a real ground-truth producer. Four new ML modules, one
surgical wiring change, one migration.

## Deliverables

### 1. `ml/validation/verdict_ingest.py` — officer verdicts → training rows
- Reads `fraud_alerts` rows with `status IN ('confirmed_fraud','false_positive')`
  joined to their scored `nip_transactions` (`transaction_ref` matched against
  `session_id`, `'NIP-<id>'`, then the bare id).
- Mapping: `confirmed_fraud → is_fraud=1`, `false_positive → 0` (pure,
  unit-tested `verdict_label()`); rows are feature-engineered with the same
  `engineer_fraud_features()` used at train time, `tx_id` follows the
  `NIP-<id>` convention of `fetch_fraud_from_db()`.
- Merges via the existing `_merge_real_cases()` pattern with sample weight
  **2.0×** (`VERDICT_CASE_WEIGHT`) — above synthetic (1.0), below externally
  adjudicated real cases (3.0), so one verdict never dominates a batch.
- Incremental via lakehouse watermark `fraud_alert_verdicts` (on
  `fraud_alerts.updated_at`); unmappable rows are quarantined with reasons,
  mirroring `real_case_ingest.py`. Snapshot ids carry microseconds to avoid
  same-second filename collisions (found in testing).

### 2. `ml/labels/case_outcome_labels.py` — case-outcome label builders
- **triage**: one row per complaint from `complaint_events` 'assigned'
  history (earliest = predicted, latest = final team/category) +
  `resolution_notes` presence; `triage_correct` where both recorded.
- **settlement**: terminal `settlements` only (`fulfilled→1`, `defaulted→0`,
  `void`/in-flight excluded), features from the latest `settlement_terms`
  version (amount, instalment/obligation counts, confidentiality, reduction
  ratio).
- **penalty_survival**: `appeal_hearings.outcome` (held) +
  `tribunal_escalations` (decided) → `penalty_upheld` 1/0 via
  `normalize_adjudication()`; latest decision per appeal wins (tribunal
  outranks hearing).
- Each writes lakehouse snapshots under `ml/lakehouse/labels/<name>/`
  (parquet; CSV fallback) with per-labeler watermarks and history merge
  (latest per key).
- **PII fail-closed**: no HMAC helper exists in `ml/`, so identifiers are
  pseudonymized with `sha256(salt:value)`; salt comes from
  `NDSEP_LABEL_HASH_SALT` (fallback `ANONYMIZATION_SALT`, matching
  `server/dataAnonymization.ts`); if unset, the builder **raises** — no raw
  identifiers can leak. Complaint subject/description, emails, officer names
  are never emitted.
- Every production run appends a best-effort audit row to `label_runs`.

### 3. `ml/lakehouse/ab_outcomes_producer.py` — A/B ground truth
- Joins scored fraud predictions (experiment result logs, keyed by
  `subject_id`) with subsequent `fraud_alerts` verdicts and appends
  `{"ts","subject_id","outcome"}` rows to `<experiment>_outcomes.jsonl` —
  exactly the format `ab_testing.load_labeled_results()` reads (latest
  outcome per subject wins, as its promotion logic expects).
- Targets every **running** fraud experiment (or `--experiment NAME`);
  watermarked (`ab_outcomes_fraud`); watermark advances only after writes.

### 4. Wiring (`ml/training/fine_tune.py`, `ml/training/continuous.py`)
- Fraud branch of `get_new_batch()` calls `_maybe_ingest_verdicts()`
  **before** batch assembly, behind `VERDICT_LABELS_ENABLED` (default true),
  fully fail-open (logged warning, never hard-fails).
- `_merge_verdict_cases()` mirrors `_merge_real_cases()`; combined order is
  synthetic 1.0× < verdict 2.0× < real 3.0×, applied on both the Postgres
  and synthetic-fallback paths.
- `continuous.run_cycle()` invokes the A/B outcomes producer once per cycle
  (fail-open).

### 5. `drizzle/migrations/0133_label_registry.sql`
- `label_runs (id uuid PK, labeler text, rows_produced int, watermark text,
  started_at/finished_at timestamptz)` + index on `(labeler, started_at)`.
- Postgres-native, idempotent; validated with sqlglot postgres dialect
  (2 statements parse clean). Journal convention: post-0034 migrations are
  SQL-only, so `_journal.json` was intentionally not touched.

### 6. Tests (16 new, all passing)
- `ml/tests/test_verdict_ingest.py` — mapping, quarantine reasons, feature
  presence, incremental watermarking, load-time dedupe.
- `ml/tests/test_case_outcome_labels.py` — all three builders, adjudication
  normalization, fail-closed salt behavior, PII absence.
- `ml/tests/test_ab_outcomes_producer.py` — join semantics (latest verdict
  wins, unscored subjects dropped), end-to-end production in the exact
  outcomes format, completed-experiment skip, empty/DB-down paths.

## Validation
- `pytest ml/tests/test_verdict_ingest.py test_case_outcome_labels.py
  test_ab_outcomes_producer.py` → **16 passed**.
- Existing suites re-run clean: `test_pipeline.py` (8), `test_ab.py` +
  `test_round9_registry.py` (8).
- Smoke: `_merge_verdict_cases` weights verified ([1,1,2] and combined
  [1,1,2,3]); fail-open paths exercised with `DATABASE_URL` unset.
- sqlglot postgres parse of 0133 → OK.

## Notes / residual risk
- `fraud_alerts.transaction_ref` is free-form; the join covers the three
  observed conventions. Alerts referencing unknown transactions are
  quarantined, never silently dropped.
- The A/B producer is invoked from `continuous.py`; verdict ingest also runs
  standalone (`python -m ml.validation.verdict_ingest`).
- `decision_feedback` (Wave 1) acceptance rows are not yet consumed by
  training — a natural next wave: feed accept/edit/reject rates into the
  triage labeler's confidence weighting.
