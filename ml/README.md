# NDSEP ML Stack (`ml/`)

A real, end-to-end, CPU-first machine-learning stack for the NDSEP
(Nigeria Data Protection Commission) regulatory platform: synthetic data
generation, PyTorch model definitions, real training loops with held-out
evaluation, a local lakehouse, a model registry, drift monitoring,
continuous-training hooks, and an inference module.

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

# 5. test
pytest ml/tests/test_pipeline.py -v
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

`ml/training/fine_tune.py`:
1. tries PostgreSQL via `DATABASE_URL` (read-only SELECTs over
   `organizations`, `compliance_violations`, `enforcement_actions`,
   `financial_penalties`, `breach_incidents`; degrades gracefully),
2. runs the drift report against the train-time feature stats and logs it,
3. fine-tunes from existing weights at a lower LR for a few epochs,
4. saves `ml/weights/<model>_net_<version>.pt` (canonical weights are
   **not** overwritten — promote explicitly after review) and registers
   the run.

Schedule with a Temporal cron workflow (nightly) or plain cron:

```
0 2 * * *  cd /app && python -m ml.training.fine_tune --model all \
           >> /var/log/ndsep/fine_tune.log 2>&1
```

## Pointing at production

Set `DATABASE_URL=postgresql://user:pass@host:5432/ndsep`. Registry
inserts and fine-tune data extraction both activate automatically and
fail soft (file registry / synthetic batch) when the DB is unreachable.

## Known limitations (honest)

- **No MLflow server** — the registry is a JSON file + the platform's own
  Postgres tables. Sufficient for audit, but no UI/experiment diffing.
- **A/B testing / shadow deployment is future work.** Inference returns a
  model version so routes *can* be split, but no traffic-splitting
  machinery exists yet.
- **Labels are synthetic** (multi-feature logistic + noise), so reported
  AUCs measure pipeline correctness, not production performance. Re-train
  via `fine_tune.py` against real tables before any production use.
- **GNN is full-batch** (fine at ~5k nodes). For much larger compliance
  graphs, add neighbour sampling.
- **Fraud labels are injected by construction**; the model demonstrably
  learns the typologies, but real fraud will need relabelled data and
  threshold/cost calibration.
- Ray is optional and off by default; without it, `--model all` trains
  sequentially.
