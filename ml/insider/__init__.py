"""Insider-threat & fraud-fusion capability for NDSEP.

Combines four independent signals into a single explainable insider-risk
score per platform staff/officer subject:

    ml.insider.features         per-subject behavioral feature extraction
                                (Postgres audit_logs/audit_ledger when
                                available, deterministic synthetic fallback)
    ml.insider.process_controls codified (non-ML) process rules:
                                segregation-of-duties matrix, maker-checker
                                requirements, dormant-account reactivation
                                and privilege-escalation watches, plus the
                                dual-control state machine mirrored by the
                                server router
    ml.insider.fusion           weighted fraud-fusion scorer combining GNN
                                structural risk, Gamma-Poisson shrinkage
                                event-rate posteriors, IsolationForest
                                behavioral anomaly scores and process-rule
                                violation scores, with explanations
    ml.insider.run_detection    CLI full sweep -> insider risk register
                                (JSON + optional Postgres insert)

Everything is CPU-only and deterministic given the same inputs.
"""
