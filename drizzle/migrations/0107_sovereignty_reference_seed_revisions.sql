-- 0107: Sovereignty reference-data hardening.
--   1. Seed the nigerian_cidr gap from 0096 (NIRA / Team Cymru-derived NG
--      prefixes; provenance-tagged 'seed-reference-verify').
--   2. Immutable revision history for asn_geo_reference (dual-control audit).
--   3. New violation_type 'unknown_classification_share' (sustained high
--      share of unclassifiable egress is itself a residency-visibility breach).
--   4. New readiness tier 'partial' (insufficient telemetry coverage cap).
-- Idempotent: safe to re-run. PostgreSQL only.

-- ─── 1. nigerian_cidr seed ───────────────────────────────────────────────────
-- Provenance: NIRA / Team Cymru-derived prefixes for the operators seeded as
-- nigerian_asn rows in 0096. REFERENCE DATA ONLY — verify every row against
-- AFRINIC WHOIS before enforcement reliance; operators re-announce prefixes.
INSERT INTO asn_geo_reference (reference_type, cidr, provider, country_code, is_nigerian, notes, source)
SELECT 'nigerian_cidr', v.cidr::cidr, v.provider, 'NG', TRUE,
       'Team Cymru/AFRINIC-derived NG prefix — verify against AFRINIC WHOIS before enforcement reliance',
       'seed-reference-verify'
FROM (VALUES
  ('105.112.0.0/12',  'MTN Nigeria'),
  ('197.210.0.0/16',  'MTN Nigeria'),
  ('102.88.0.0/13',   'Airtel Nigeria'),
  ('41.184.0.0/16',   'Globacom'),
  ('41.190.0.0/19',   '9mobile'),
  ('154.113.0.0/16',  'MainOne Cable'),
  ('41.58.0.0/16',    'SWIFT Networks'),
  ('41.217.0.0/17',   'Spectranet')
) AS v(cidr, provider)
WHERE NOT EXISTS (
  SELECT 1 FROM asn_geo_reference r
  WHERE r.reference_type = 'nigerian_cidr' AND r.cidr = v.cidr::cidr
);

-- ─── 2. asn_geo_reference_revisions (immutable) ─────────────────────────────
-- Every upsert of reference data appends one revision row with the prior and
-- new state plus a dual-control note (second-officer acknowledgement).
CREATE TABLE IF NOT EXISTS asn_geo_reference_revisions (
  id BIGSERIAL PRIMARY KEY,
  reference_id BIGINT NOT NULL REFERENCES asn_geo_reference(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update')),
  prior_state JSONB,
  new_state JSONB NOT NULL,
  change_reason TEXT NOT NULL,
  dual_control_note TEXT,      -- second-officer acknowledgement reference
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reference_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_asn_geo_revisions_ref
  ON asn_geo_reference_revisions (reference_id, revision_no DESC);

CREATE OR REPLACE FUNCTION asn_geo_reference_revisions_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'asn_geo_reference_revisions is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asn_geo_revisions_no_update ON asn_geo_reference_revisions;
CREATE TRIGGER trg_asn_geo_revisions_no_update
  BEFORE UPDATE OR DELETE ON asn_geo_reference_revisions
  FOR EACH ROW EXECUTE FUNCTION asn_geo_reference_revisions_immutable();

-- ─── 3. residency_violations: unknown-classification-share violation ────────
ALTER TABLE residency_violations
  DROP CONSTRAINT IF EXISTS residency_violations_violation_type_check;
ALTER TABLE residency_violations
  ADD CONSTRAINT residency_violations_violation_type_check
  CHECK (violation_type IN (
    'foreign_egress_threshold',
    'egress_changepoint_shift',
    'undeclared_hosting',
    'key_custody_foreign',
    'backup_foreign',
    'admin_access_foreign',
    'attestation_expired',
    'unknown_classification_share',
    'manual'
  ));

-- ─── 4. sovereignty_scores: 'partial' readiness tier ────────────────────────
-- Entities with insufficient telemetry coverage are capped at 'partial'
-- (see server/sovereigntyScore.ts coverage gate).
ALTER TABLE sovereignty_scores
  DROP CONSTRAINT IF EXISTS sovereignty_scores_readiness_tier_check;
ALTER TABLE sovereignty_scores
  ADD CONSTRAINT sovereignty_scores_readiness_tier_check
  CHECK (readiness_tier IN
    ('sovereign_ready', 'on_track', 'at_risk', 'critical', 'non_compliant', 'partial'));
