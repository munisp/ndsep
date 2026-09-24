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

## Neo4j graph store

The compliance graph (orgs / violations / enforcement actions / officers +
`HAS_VIOLATION` / `ENFORCED_BY` / `SECTOR_PEER` / `TRANSACTS_WITH` /
`EMPLOYS` edges) can live in a real Neo4j 5 database instead of only in
parquet/lakehouse snapshots.

### Architecture

```
Postgres / lakehouse snapshots / synthetic generator
        │  python -m ml.graph.sync_to_neo4j   (idempotent MERGE, UNWIND batches)
        ▼
      Neo4j 5.26-community  ──►  GNN training graph source (ml/graph/graph_source.py)
        ▲                        KGQA / graph analytics
        └── workers/python/neo4j_graph_service.py  (FastAPI, port 8220)
            /health /graph/push /graph/fetch /graph/neighbors /graph/path
            /graph/communities /graph/rings
```

### Pieces

- **`ml/graph/neo4j_store.py`** — real client on the official `neo4j`
  driver (`pip install neo4j`). `Neo4jGraphStore` is a context manager;
  `push_graph(nodes, edges, labels)` MERGEs nodes by `node_id`
  (labels `Organization` / `Violation` / `EnforcementAction` / `Officer` /
  `Sector`, uniqueness constraint per label) and relationships by
  `(src, dst, type)` in batched `UNWIND` write transactions — re-running
  is idempotent. `fetch_graph()` returns the exact
  `(nodes_df, edges_df, labels_df)` frames `train_gnn()` consumes.
  `neighbors()`, `shortest_path()`, `detect_communities()`,
  `collusion_rings()` (orgs sharing officer / enforcement signals,
  weighted connected components). Module-level wrappers open short-lived
  connections from env config. `HAS_NEO4J=False` when the driver is not
  installed — every caller degrades gracefully.
- **`ml/graph/graph_source.py`** — canonical training-graph source.
  `load_training_graph()` resolves in order: **Neo4j → lakehouse snapshot
  (`graph_nodes`/`graph_edges`/`graph_labels` via
  `ml/training/lakehouse.load_latest`) → fresh synthetic generation**.
  Force with `NDSEP_GRAPH_SOURCE=neo4j|lakehouse|synthetic`.
- **`ml/graph/sync_to_neo4j.py`** — CLI push job:
  `python -m ml.graph.sync_to_neo4j [--source lakehouse|synthetic]
  [--dry-run]`.
- **`workers/python/neo4j_graph_service.py`** — FastAPI worker on
  `NEO4J_SERVICE_PORT` (default **8220**). When Neo4j is unreachable it
  rebuilds the graph from Postgres (`DATABASE_URL`) in memory and serves
  reads from it; every response flags `source:
  "neo4j"|"postgres"|"unavailable"`. Pushes require Neo4j (503 otherwise).
- **Compose**: `neo4j` service in `docker-compose-workers-addition.yml`
  (image `neo4j:5.26-community`, ports `7474`/`7687`, APOC enabled,
  healthcheck via `cypher-shell`, data on the `neo4j_data` volume).

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | Bolt endpoint |
| `NEO4J_USER` | `neo4j` | auth user |
| `NEO4J_PASSWORD` | `ndsep-neo4j-dev` | auth password (dev default — override in compose/prod) |
| `NEO4J_SERVICE_PORT` | `8220` | FastAPI worker port |
| `NDSEP_GRAPH_SOURCE` | `auto` | force graph source for `load_training_graph()` |

### Wiring GNN training

`ml/training/train.py::train_gnn()` still loads the graph via
`get_dataset(...)` (that file is owned by another workstream and was not
modified). To adopt the canonical source, replace these three lines in
`train_gnn()`:

```python
nodes, src_n = get_dataset("graph_nodes", data_dir)
edges, _ = get_dataset("graph_edges", data_dir)
labels, _ = get_dataset("graph_labels", data_dir)
```

with the one-liner:

```python
from ml.graph.graph_source import load_training_graph
nodes, edges, labels, src_n = load_training_graph()
```

Everything downstream (`nodes[f"f{i}"]` feature columns, `edges.src/dst`,
`labels.node_id/high_risk`, the `src_n` provenance string) is unchanged —
`fetch_graph()` reconstructs the identical frame shapes.

### Honest limits

- **Community edition** (`neo4j:5.26-community`): no GDS plugin by
  default, so `detect_communities()` tries `gds.labelPropagation` and
  falls back to a deterministic pure-Python label propagation over the
  fetched edge list; `collusion_rings()` is Cypher for signal extraction
  + Python connected components. GDS (or Fabric/sharding) can be enabled
  later by adding the plugin and bumping the image — the code path is
  already there.
- **Full-graph fetch**: `fetch_graph()` pulls the whole graph into
  memory per call — fine at the current ~5k-node scale; needs paging /
  sampling for much larger graphs.
- The synthetic graph stores features as a `features` float-array
  property; Postgres-fallback graphs built by the worker have no GNN
  feature vectors (structure-only reads).
- Sync is batch, not streaming: Neo4j reflects the last
  `sync_to_neo4j` run, not live Postgres state. Hook it into the
  continuous-training schedule (ml/CONTINUOUS_TRAINING.md) for
  periodic refresh.

## Bayesian/MCMC layer

`ml/bayesian/` adds **posterior inference** to the stack: instead of
point estimates from the PyTorch models, it answers regulatory questions
with full posterior distributions and credible intervals. Pure
numpy/scipy, CPU-only, fully seedable. No relation to the Rust
`workers/rust/monte_carlo` engine — that service is **forward scenario
simulation** (assume sector inputs, simulate 1,000+ possible futures,
report outcome percentiles); this layer is **inverse inference**
(observe events, infer the latent rates that generated them). They
complement each other: posteriors from here can feed priors/inputs
there.

### What each model answers

1. **Beta-Binomial sector fraud rates** (`models.beta_binomial_rates`) —
   *"Which sectors have genuinely elevated fraud?"* Posterior fraud rate
   per sector given observed frauds/transactions, with 95% HDIs and
   P(sector rate > pooled rate). Conjugate Beta posterior is analytic;
   an adaptive-MH sampler on logit(p) cross-checks it (R-hat/ESS in
   every output row).
2. **Poisson change-point** (`models.poisson_changepoint`) — *"Did the
   compliance-violation regime shift (e.g. after an enforcement
   campaign)?"* Single change-point in a count series; rates
   before/after, discrete uniform prior on the change location. The tau
   posterior is computed **exactly** on a grid (conjugate rate
   marginals), with P(rate increased) and rate HDIs.
3. **Gamma-Poisson insider-risk shrinkage**
   (`models.gamma_poisson_shrinkage`) — *"Which officers/units have
   genuinely elevated event rates?"* Per-unit event counts with
   exposures; empirical-Bayes Gamma population prior shrinks low-count
   units toward the population mean and flags units whose posterior mean
   exceeds the 99% population credible bound. Consumed by the
   insider-threat module; `run_analysis` runs it per-organization as a
   proxy until per-officer counts exist.

### The sampler

`ml/bayesian/mcmc.py`: random-walk Metropolis-Hastings with Robbins-Monro
proposal-scale adaptation targeting ~0.234 acceptance, multiple chains
(>= 2), burn-in/thinning, split-R-hat (Gelman-Rubin), autocorrelation
ESS with an initial-positive-sequence cutoff, and mean/median/95%-HDI
posterior summaries.

### Run

```bash
python3 -m ml.bayesian.run_analysis          # writes ml/bayesian/results/
pytest ml/tests/test_bayesian.py -v          # 9 correctness tests
```

`run_analysis` reads `transactions`/`organizations` from the lakehouse
(`load_latest`); if the lakehouse is unreadable (e.g. no parquet engine)
it regenerates the synthetic corpus via the generator. Outputs:
`sector_fraud_rates.json`, `changepoint_violations.json`,
`insider_risk_shrinkage.json`, `SUMMARY.md` — committed real numbers
under `ml/bayesian/results/`.

### Honest limits

- **Random-walk MH, no NUTS/HMC**: `numpyro` is optional and not
  installed here, so there is no gradient-based sampler. MH mixes poorly
  on correlated/high-dimensional posteriors — the models above are
  deliberately low-dimensional (per-sector rate, 3-parameter
  change-point, conjugate shrinkage) and rates are sampled on the
  logit/log scale. Always check R-hat (< 1.05) and ESS before trusting
  tails; install `numpyro` and port if correlated posteriors appear.
- **EB shrinkage can over-shrink**: the Gamma-Poisson population prior
  is fit by method of moments; when between-unit variance is
  Poisson-consistent, shrinkage is heavy by design — a unit needs
  genuinely disproportionate counts to be flagged. The flagging
  threshold (99% population bound) is a screening rule, not proof of
  misconduct.
- **Change-point is single-break only** and the tau grid posterior
  assumes a discrete uniform prior; multiple regime shifts need an
  extension (e.g. binary segmentation or BOCPD).
- Data remains **synthetic** until NDPC pipelines feed real counts, so
  the committed results demonstrate correctness, not production findings.
