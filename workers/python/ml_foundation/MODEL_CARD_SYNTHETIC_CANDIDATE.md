# NDSEP Synthetic Candidate Model Card

**Artifact status:** Candidate only.
**Training classification:** Synthetic-only; no production, customer, financial-institution, personal, location, payment or CBN data was used.
**Decision-use status:** **Not approved for production, enforcement, payment, residency, regulatory or adverse decisions.**

## Validated local run

| Item | Observed value |
|---|---|
| Synthetic dataset digest | `97bfc6efedca91c4e06ff132688a3f2a377b402c6a9a91b7fbe923887e5c4e51` |
| Event records / graph edges | 1,200 / 221 |
| Tabular model | CPU PyTorch `event_risk_mlp` |
| Tabular artifact SHA-256 | `4c21b49d3dccd4983a77cb229f14826ea77736a63827a5eb2307b6127568a77f` |
| Tabular time-split test metrics | Accuracy 0.755556; F1 0.421053; precision 0.307692; recall 0.666667 |
| Graph model | CPU PyTorch-Geometric `organization_graphsage` |
| Graph artifact SHA-256 | `1d3e6a3b719e1cecbab4d3849b92a91c94bfd2a8132b80abf5182566c7bba982` |
| Graph synthetic test metrics | Accuracy 0.750000; F1 0.750000; precision 0.750000; recall 0.750000 |
| Artifact integrity result | Ed25519 manifest signature and artifact SHA-256 values verified |
| CPU inference smoke result | Service `ready`; verified MLP returned `human_review_required` |

## Intended use and non-use

The tabular model predicts only the **synthetic generator’s simulated review label**. The graph model predicts a synthetic organization-level proxy. Neither output represents fraud, non-compliance, data residency, risk, sanctions, a real organization or a real person. The models can only be used to validate the training, provenance, serving and human-review workflow.

The API returns a model score with `recommended_workflow: human_review_required` and a list of prohibited uses. It fails unavailable for a missing, changed or unsigned model; it does not fall back to a rule or fabricated result.

## Evidence and reproduction

The validated evidence bundle is retained under `/home/ubuntu/ndsep-ml-foundation-validation/` for this session, including the synthetic data manifest, signed model manifest, weights, training result and CPU inference result. The private key in that local bundle is **test-only**, was not committed and must not be reused.

Reproduce using `README.md` and retain the generated model manifest, data manifest, metrics and environment/dependency lock evidence. A production candidate requires a controlled signing service, immutable model registry, governed data contract, independent evaluation and accountable approval.
