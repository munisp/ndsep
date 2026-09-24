# NDSEP ML Stack (`ml/`)

A real, end-to-end, CPU-first machine-learning stack for the NDSEP
(Nigeria Data Protection Commission) regulatory platform: synthetic data
generation, PyTorch model definitions, real training loops with held-out
evaluation, a local lakehouse, a model registry, drift monitoring,
champion/challenger A/B testing, optional MLflow tracking,
continuous-training orchestration, live performance monitoring with
alerts, a rigorous validation harness, and an inference module.

## What is REAL here

- **Trained weights** committed under `ml/weights/` (`fraud_net.pt`,
  `credit_net.pt`, `gnn_net.pt`), produced by actual gradient-descent
  training (`ml/training/train.py`) with Adam, class-weighted
  `BCEWithLogitsLoss`, early stopping on validation ROC-AUC.
- **Real test metrics** in `ml/weights/*_metrics.json` (accuracy,
  precision, recall, F1, ROC-AUC on a held-out test split).
- **Real drift detection** (PSI + two-sample KS test, scipy) in
  `ml/monitoring/drift.py`, wired into `fine_tune.py`.
- **A lakehouse** (`ml/lakehouse/`): versioned parquet snapshots with a
  `_manifest.json` catalog; `load_latest(dataset)` used by training.
- **A registry** (`ml/registry.py`): every run is appended to
  `ml/weights/registry.json` and — when `DATABASE_URL` is reachable —
  INSERTed into the platform's existing `ml_model_registry` /
  `ml_model_metrics` Postgres tables (columns verified against
  `server/routers/aimlRouter.ts`).
- **Champion/challenger A/B testing** (`ml/ab_testing.py`): experiments in
  `ml/weights/experiments.json`, deterministic per-subject assignment,
  result logging to `ml/lakehouse/ab_results/`, and metric-gated promotion
  (logged outcomes first, lakehouse holdout proxy as fallback). Wired into
  every `score_*` function in `ml/inference.py`.
- **Optional MLflow tracking** (`ml/tracking.py`): logs params/metrics/
  artifacts for every train/fine-tune run when the `mlflow` package is
  installed AND `MLFLOW_TRACKING_URI` is set; otherwise a graceful no-op.
  The MLflow server runs via docker-compose (service `mlflow` in
  `docker-compose-workers-addition.yml`).
- **Continuous-training orchestration** (`ml/training/continuous.py`):
  cron-friendly `--once` cycle that fine-tunes a model only when drift is
  detected, weights are stale (> 72h), or `--force` is given; auditable run
  records in `ml/lakehouse/training_runs/` and failure alerts. Scheduling:
  `ml/CONTINUOUS_TRAINING.md` (cron + Temporal schedule).
- **Live performance monitoring** (`ml/monitoring/performance_monitor.py`):
  rolling inference log (score distribution, latency, volume), PSI-based
  degradation checks against the training-time score reference, alerts to
  `ml/lakehouse/alerts/` + Postgres `compliance_drift_alerts` when
  reachable. Opt-out via `NDSEP_ML_MONITOR=0`; failure-safe by design.
- **A validation harness** (`ml/validation/`): time-based holdout for
  fraud, k-fold CV for credit, bootstrap AUC CIs, calibration bins,
  threshold analysis at the real 0.3% base rate — see
  `ml/validation/VALIDATION_REPORT.md` — plus a real-fraud-case ingest
  path with quarantine (`real_case_ingest.py`).

## What is SYNTHETIC

- **All training data.** `ml/data/generate_synthetic.py` fabricates
  Nigerian organizations (banks/fintechs/telcos/MFBs/PSPs/insurers),
  NIP-style instant transfers (log-normal naira amounts, salary-cycle and
  business-hours seasonality) with ~0.3% fraud across five typologies
  (structuring below the ₦10m NFIU reporting threshold, account takeover,
  card-not-present, insider collusion, money-mule chains), per-org
  credit/compliance features with default labels from a **multi-feature
  logistic function + noise** (deliberately no single-feature leakage),
  and a compliance graph whose high-risk labels depend on graph
  neighbourhoods. It is seeded for reproducibility and stands in **until
  production DB pipelines feed real data** (see `fine_tune.py`, which
  already reads real tables when `DATABASE_URL` is set).

## Quick start

```bash
pip install -r workers/python/requirements-ml.txt

# 1. generate data (also done automatically by train.py if missing)
python -m ml.data.generate_synthetic --n-transactions 120000 --n-orgs 800

# 2. train (real loops; weights + metrics land in ml/weights/)
python -m ml.training.train --model all          # or fraud|credit|gnn
python -m ml.training.train --model all --use-ray # parallel IF ray installed

# 3. score
python -m ml.inference                           # smoke test

# 4. fine-tune on new data (Postgres if DATABASE_URL set, else new
#    synthetic batch; runs the drift check first; saves VERSIONED weights)
python -m ml.training.fine_tune --model all

# 5. continuous-training cycle (drift/staleness-gated; cron-friendly)
python -m ml.training.continuous --once --model all

# 6. rigorous validation (time-based holdout / k-fold, CIs, calibration,
#    threshold recommendation) -> ml/validation/validation_results.json
python -m ml.validation.validate --model all

# 7. A/B test a challenger version
python -m ml.ab_testing --create fraud-v2 --model fraud \
    --challenger <version> --split 0.1
python -m ml.ab_testing --evaluate fraud-v2
python -m ml.ab_testing --promote fraud-v2 --min-samples 200

# 8. live performance / drift check over the rolling inference log
python -m ml.monitoring.performance_monitor --check all

# 9. ingest real labeled fraud cases (when NDPC provides them)
python -m ml.validation.real_case_ingest cases.csv --dry-run

# 10. test
pytest ml/tests/ -v
```

## Models

| Model | File | Task | Architecture |
|---|---|---|---|
| `fraud_net` | `ml/models/fraud_net.py` | transaction fraud | MLP 16→128→64→32→1, BatchNorm + Dropout |
| `credit_net` | `ml/models/credit_net.py` | org default risk (24m) — **fills the "no credit scoring" gap** | MLP 10→64→32→1 |
| `gnn_net` | `ml/models/gnn_net.py` | high-risk org node on compliance graph | GraphSAGE-style mean-aggregation, pure PyTorch (no torch_geometric) |

All are `torch.nn.Module`, CPU-first, with `save`/`load` helpers
(`state_dict` + JSON config).

## Continuous training

`ml/training/continuous.py` is the orchestrator (fine-tune decisions +
reporting); `ml/training/fine_tune.py` is the per-model worker it calls:
1. tries PostgreSQL via `DATABASE_URL` (read-only SELECTs over
   `organizations`, `compliance_violations`, `enforcement_actions`,
   `financial_penalties`, `breach_incidents`; degrades gracefully),
2. runs the drift report against the train-time feature stats and logs it,
3. fine-tunes from existing weights at a lower LR for a few epochs,
   up-weighting any ingested real fraud cases (`real_cases` lakehouse
   dataset) 3× via per-sample weights,
4. saves `ml/weights/<model>_net_<version>.pt` (canonical weights are
   **not** overwritten — promote via the A/B harness) and registers
   the run.

Scheduling (cron line, Temporal schedule snippet, and how the platform's
daily / 72h cadences map): **`ml/CONTINUOUS_TRAINING.md`**.

## A/B testing

`ml/ab_testing.py` + `ml/inference.py`:

```python
from ml import ab_testing, inference
ab_testing.create_experiment("fraud-v2", "fraud",
                             challenger_version="20261001T020000Z",
                             traffic_split=0.1)
r = inference.score_transaction(features, experiment="fraud-v2",
                                subject_id=tx_id)   # + "variant" key
ab_testing.record_outcome("fraud-v2", tx_id, 1)     # when labels arrive
ab_testing.promote("fraud-v2", min_samples=200)     # metric-gated
```

Assignment is deterministic (sha256 of experiment + subject), results are
logged with latency to `ml/lakehouse/ab_results/`, and promotion compares
variants on logged outcomes (falling back to a lakehouse-holdout proxy AUC
when outcomes are scarce), then updates `experiments.json` and the
registry. Promotion never overwrites weights files — it only flips which
version is champion.

## MLflow tracking

`ml/tracking.py` is a thin optional client. When `mlflow` is installed and
`MLFLOW_TRACKING_URI=http://localhost:5000` is set, every `train.py` /
`fine_tune.py` run logs params, metrics, and the weights artifact to the
`ndsep-ml` experiment. Otherwise it is a no-op with a one-line warning —
training works identically. The server is the `mlflow` service in
`docker-compose-workers-addition.yml` (Postgres backend store on the
`mlflow` database — create it once, see the compose comment; artifacts on
the `mlflow-artifacts` volume; UI on :5000). The client line is commented
out in `workers/python/requirements-ml.txt`.

## Model monitoring & alerts

Every inference call is logged (score, latency, model version, variant) to
`ml/lakehouse/inference_log/` unless `NDSEP_ML_MONITOR=0`.
`ml/monitoring/performance_monitor.py --check <model>` compares the recent
window against the training-time reference (PSI on the score distribution,
p95-latency regression, optional labeled-outcome AUC) and emits alerts to
`ml/lakehouse/alerts/` AND Postgres `compliance_drift_alerts` when
`DATABASE_URL` is reachable (file alerts are the source of truth; the DB
insert is best-effort). Logging is failure-safe: it can never break a
scoring call.

## Validation

`python -m ml.validation.validate --model all` runs the rigorous protocol
(time-based holdout for fraud, k-fold for credit, bootstrap AUC CIs,
calibration bins, threshold analysis at the real base rate) and writes
`ml/validation/validation_results.json`. Current report:
**`ml/validation/VALIDATION_REPORT.md`**. Real labeled fraud cases (when
NDPC provides them) go through `ml/validation/real_case_ingest.py`
(schema in its docstring; unmappable rows quarantined; valid rows merged
into the lakehouse `real_cases` dataset and up-weighted in fine-tuning).

## Pointing at production

Set `DATABASE_URL=postgresql://user:pass@host:5432/ndsep`. Registry
inserts and fine-tune data extraction both activate automatically and
fail soft (file registry / synthetic batch) when the DB is unreachable.

## Known limitations (honest)

- **Labels are synthetic** (multi-feature logistic + noise), so reported
  AUCs measure pipeline correctness, not production performance. See
  `ml/validation/VALIDATION_REPORT.md` — the harness is ready for real
  NDPC-provided fraud cases; real labels are **pending** (data-sharing
  agreement + labeled data required).
- **credit_net is poorly calibrated** (ECE ≈ 0.34 under class-weighted
  training). Use it as a ranking score, or fit an isotonic/Platt
  calibrator on out-of-fold predictions before exposing probabilities.
- **A/B promotion proxy** (lakehouse-holdout AUC) is only a fallback;
  promotion decisions should ride on logged outcomes (`min_samples` per
  variant). Online metrics assume outcome labels actually flow back via
  `record_outcome` — wiring that to case-review UI is platform work.
- **No shadow deployment mode** (champion scores logged alongside live
  traffic without serving) — the experiment machinery supports it, but no
  route currently runs dual scoring.
- **GNN is full-batch** (fine at ~5k nodes). For much larger compliance
  graphs, add neighbour sampling.
- **Fraud labels are injected by construction**; the model demonstrably
  learns the typologies, but real fraud will need relabelled data and
  threshold/cost calibration.
- The MLflow server is **not** part of this repo's runtime — it starts
  with docker-compose; without it, tracking is a silent no-op by design.
- Ray is optional and off by default; without it, `--model all` trains
  sequentially (and Ray runs skip MLflow tracking).
