-- Migration 0096: Data sovereignty — reference data & sovereignty scores.
--
--   asn_geo_reference              classification reference for the egress
--                                  monitor worker + APISIX plugin: Nigerian
--                                  ASN ranges, Nigerian provider CIDRs, and
--                                  major cloud-provider region CIDRs.
--                                  *** REFERENCE DATA ONLY ***
--                                  Rows are admin-editable via the
--                                  dataSovereignty router. Seed rows are
--                                  best-effort starting points and MUST be
--                                  verified against AFRINIC WHOIS and the
--                                  cloud providers' published ip-ranges
--                                  feeds before enforcement reliance
--                                  (providers re-issue CIDRs frequently).
--   sovereignty_scores             per-entity 0..1 sovereignty score +
--                                  component breakdown, one row per sweep.
--   sovereignty_score_explanations ranked explanation payload per score:
--                                  [{factor, weight, value, contribution,
--                                    detail}] so a regulator can see exactly
--                                  why an entity scores as it does.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS asn_geo_reference (
  id             BIGSERIAL PRIMARY KEY,
  reference_type TEXT NOT NULL
                 CHECK (reference_type IN
                   ('nigerian_asn', 'nigerian_cidr', 'cloud_region_cidr')),
  asn            INTEGER,                          -- set for nigerian_asn rows
  cidr           CIDR,                             -- set for *_cidr rows
  provider       TEXT,                             -- e.g. 'MTN Nigeria', 'aws', 'azure', 'gcp'
  region         TEXT,                             -- cloud region code, e.g. 'eu-west-1'
  country_code   CHAR(2) NOT NULL,                 -- ISO-3166 alpha-2 of the resource
  is_nigerian    BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE => destination counts as domestic
  notes          TEXT,
  source         TEXT NOT NULL DEFAULT 'seed-reference-verify', -- provenance marker
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT asn_or_cidr_present CHECK (asn IS NOT NULL OR cidr IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS asn_geo_reference_asn_uq
  ON asn_geo_reference (reference_type, asn) WHERE asn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asn_geo_reference_cidr_uq
  ON asn_geo_reference (reference_type, cidr) WHERE cidr IS NOT NULL;
CREATE INDEX IF NOT EXISTS asn_geo_reference_nigerian_idx
  ON asn_geo_reference (is_nigerian) WHERE is_nigerian;

CREATE TABLE IF NOT EXISTS sovereignty_scores (
  id             BIGSERIAL PRIMARY KEY,
  entity_ref     TEXT NOT NULL,
  score          DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 1),
  components     JSONB NOT NULL,      -- {declared_observed_consistency, attestation_freshness,
                                      --  violation_history, foreign_egress_ratio}
  weights        JSONB NOT NULL,      -- weight snapshot used for this computation
  readiness_tier TEXT NOT NULL
                 CHECK (readiness_tier IN
                   ('sovereign_ready', 'on_track', 'at_risk', 'critical', 'non_compliant')),
  computed_by    TEXT NOT NULL DEFAULT 'system',
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sovereignty_scores_entity
  ON sovereignty_scores (entity_ref, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sovereignty_scores_tier
  ON sovereignty_scores (readiness_tier, computed_at DESC);

CREATE TABLE IF NOT EXISTS sovereignty_score_explanations (
  id          BIGSERIAL PRIMARY KEY,
  score_id    BIGINT NOT NULL REFERENCES sovereignty_scores(id) ON DELETE CASCADE,
  entity_ref  TEXT NOT NULL,
  explanation JSONB NOT NULL,  -- [{factor, weight, value, contribution, detail}] ranked desc
  summary     TEXT NOT NULL,   -- one-paragraph human-readable rationale
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sovereignty_explanations_entity
  ON sovereignty_score_explanations (entity_ref, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sovereignty_explanations_score
  ON sovereignty_score_explanations (score_id);

-- ─── Seed reference data (REFERENCE ONLY — verify before enforcement) ────────
-- Nigerian mobile/fixed operators & major local ISPs. ASN assignments are
-- stable but MUST be verified against AFRINIC WHOIS; add local peering and
-- IXPs (e.g. IXPN) as they are confirmed.
INSERT INTO asn_geo_reference (reference_type, asn, provider, country_code, is_nigerian, notes, source)
SELECT v.reference_type, v.asn, v.provider, 'NG', TRUE, v.notes, 'seed-reference-verify'
FROM (VALUES
  ('nigerian_asn', 29465, 'MTN Nigeria',        'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 36873, 'Airtel Nigeria',     'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 37148, 'Globacom',           'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 30999, '9mobile',            'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 37282, 'MainOne Cable',      'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 37084, 'ipNX Nigeria',       'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 37340, 'Spectranet',         'verify against AFRINIC WHOIS'),
  ('nigerian_asn', 37637, 'Smile Nigeria',      'verify against AFRINIC WHOIS')
) AS v(reference_type, asn, provider, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM asn_geo_reference r
  WHERE r.reference_type = v.reference_type AND r.asn = v.asn
);

-- Example cloud-provider region CIDRs (foreign for Nigerian-residency
-- purposes). Cloud CIDRs churn — refresh from the providers' published
-- feeds (AWS ip-ranges.json, Azure Service Tags, GCP cloud.json).
INSERT INTO asn_geo_reference (reference_type, cidr, provider, region, country_code, is_nigerian, notes, source)
SELECT 'cloud_region_cidr', v.cidr::cidr, v.provider, v.region, v.cc, FALSE,
       'seed example — refresh from provider ip-ranges feed', 'seed-reference-verify'
FROM (VALUES
  ('3.248.0.0/13',   'aws',   'eu-west-1',      'IE'),
  ('52.30.0.0/15',   'aws',   'eu-west-1',      'IE'),
  ('13.52.0.0/16',   'aws',   'us-west-1',      'US'),
  ('13.104.0.0/14',  'azure', 'global-example', 'US'),
  ('34.64.0.0/10',   'gcp',   'multi-example',  'US')
) AS v(cidr, provider, region, cc)
WHERE NOT EXISTS (
  SELECT 1 FROM asn_geo_reference r
  WHERE r.reference_type = 'cloud_region_cidr' AND r.cidr = v.cidr::cidr
);
