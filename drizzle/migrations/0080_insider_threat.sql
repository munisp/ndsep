-- Migration 0080: Insider-threat & fraud-fusion capability.
--
-- Tables backing ml/insider/ (Python detector) and
-- server/routers/insiderThreat.ts (tRPC surface):
--
--   insider_risk_scores   one row per subject per sweep: fused fraud-fusion
--                         score (GNN structural + Bayesian shrinkage +
--                         IsolationForest behavioral + process violations),
--                         the component breakdown and an explanation payload
--                         (top contributing signals).
--   sod_violations        codified process-control findings: segregation-of-
--                         duties breaches, maker-checker breaches, dormant
--                         reactivations, privilege escalations.
--   dual_control_requests maker-checker queue for sensitive actions (fine
--                         settlement, DPCO approval, role grants, vault
--                         sealing overrides). Two DISTINCT approvers,
--                         neither being the requester; requests expire.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS insider_risk_scores (
  id                 BIGSERIAL PRIMARY KEY,
  subject_id         TEXT NOT NULL,            -- officer/staff ref (OFF-000123 or user id)
  subject_type       TEXT NOT NULL DEFAULT 'officer',
  fused_score        DOUBLE PRECISION NOT NULL CHECK (fused_score >= 0 AND fused_score <= 1),
  components         JSONB NOT NULL,           -- {gnn_structural, bayesian_rate, behavioral, process}
  explanation        JSONB NOT NULL,           -- [{signal, contribution, detail}] top signals, ranked
  recommended_action TEXT NOT NULL DEFAULT 'monitor'
                     CHECK (recommended_action IN
                       ('monitor', 'require_dual_approval',
                        'suspend_privileges', 'investigate')),
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insider_risk_scores_subject
  ON insider_risk_scores (subject_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_insider_risk_scores_score
  ON insider_risk_scores (fused_score DESC);
CREATE INDEX IF NOT EXISTS idx_insider_risk_scores_computed_at
  ON insider_risk_scores (computed_at DESC);

CREATE TABLE IF NOT EXISTS sod_violations (
  id           BIGSERIAL PRIMARY KEY,
  rule         TEXT NOT NULL,                  -- sod:penalty_lifecycle / maker_checker:* / watch:*
  subject_refs JSONB NOT NULL,                 -- {actor_id, roles, scope, scope_ref, ...}
  evidence     JSONB NOT NULL,                 -- rule-specific evidence references
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sod_violations_rule
  ON sod_violations (rule);
CREATE INDEX IF NOT EXISTS idx_sod_violations_status
  ON sod_violations (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sod_violations_subject_refs
  ON sod_violations USING GIN (subject_refs);

CREATE TABLE IF NOT EXISTS dual_control_requests (
  id                 BIGSERIAL PRIMARY KEY,
  action_type        TEXT NOT NULL
                     CHECK (action_type IN
                       ('fine_settlement', 'dpco_approval', 'role_grant',
                        'vault_sealing_override')),
  payload            JSONB NOT NULL,           -- action-specific parameters
  requested_by       TEXT NOT NULL,            -- requester CANNOT approve
  first_approver     TEXT,
  second_approver    TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN
                       ('pending', 'approved', 'rejected', 'expired')),
  threshold_snapshot JSONB NOT NULL DEFAULT '{}', -- policy in force at request time
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,
  decision_reason    TEXT,
  -- maker-checker invariants at the storage layer as well:
  -- approvers must be distinct from each other and from the requester.
  CONSTRAINT dual_control_no_self_first  CHECK (first_approver  IS NULL OR first_approver  <> requested_by),
  CONSTRAINT dual_control_no_self_second CHECK (second_approver IS NULL OR second_approver <> requested_by),
  CONSTRAINT dual_control_distinct       CHECK (second_approver IS NULL OR second_approver <> first_approver)
);

CREATE INDEX IF NOT EXISTS idx_dual_control_requests_status
  ON dual_control_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dual_control_requests_requested_by
  ON dual_control_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dual_control_requests_expiry
  ON dual_control_requests (expires_at) WHERE status = 'pending';
