-- Synthetic fixture extension for tables not covered by the maintained Drizzle seed path.
--
-- SAFETY BOUNDARY: this script is for an explicitly confirmed non-production
-- synthetic database only. It creates no release, security, residency,
-- operational, compliance, or regulatory evidence. The companion Node runner
-- enforces the target and confirmation guard before this SQL is executed.
--
-- The script is idempotent and intentionally contains no transaction control;
-- scripts/seed-remaining-synthetic-fixtures.mjs owns the transaction.

DO $$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO missing_tables
  FROM (VALUES
    ('analytics_snapshots'),
    ('article40_codes'),
    ('dpco_audit_service_records'),
    ('dpco_registry_service_records'),
    ('dpco_verification_service_records'),
    ('dt_jurisdictions'),
    ('dt_monte_carlo_stats'),
    ('dt_org_agents'),
    ('dt_policies'),
    ('dt_policy_impacts'),
    ('dt_sandboxes'),
    ('dt_simulation_results'),
    ('dt_simulations'),
    ('marketplace_plugins'),
    ('mobile_push_devices'),
    ('noc_agent_memory'),
    ('onboarding_checklists'),
    ('users')
  ) AS required(table_name)
  WHERE to_regclass(format('public.%I', table_name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'Synthetic fixture schema is incomplete; missing public table(s): %. Apply the checked-in Drizzle migration journal before running fixtures.',
      array_to_string(missing_tables, ', ');
  END IF;
END
$$;

-- Runtime contracts: an aggregate-only metric with a non-null conflict key.
INSERT INTO analytics_snapshots (
  metric_name, dimension, dimension_value, metric_value, snapshot_date, metadata
) VALUES (
  'synthetic_fixture_coverage', 'scenario', '2026-08-31', 1.0000, DATE '2026-08-31',
  '{"synthetic":true,"scenario":"fixture-coverage","not_production_evidence":true}'::jsonb
)
ON CONFLICT (metric_name, dimension, dimension_value, snapshot_date) DO UPDATE SET
  metric_value = EXCLUDED.metric_value,
  metadata = EXCLUDED.metadata;

INSERT INTO article40_codes (
  code_name, sector, description, submitted_by, document_url, status, approved_by, approval_date
)
SELECT
  'SYNTHETIC-ARTICLE40-DEMO', 'synthetic-testing',
  'Fixture-only Article 40 demonstration code; it is not a regulatory submission or approval.',
  'synthetic-fixture-runner', 'https://example.invalid/ndsep/synthetic/article40',
  'draft', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM article40_codes
  WHERE code_name = 'SYNTHETIC-ARTICLE40-DEMO' AND sector = 'synthetic-testing'
);

-- DPCO service boundary: stable UUIDs and required lifecycle identifiers in JSON.
INSERT INTO dpco_audit_service_records (audit_id, payload)
VALUES (
  '00000000-0000-4000-8000-000000000035'::uuid,
  '{"synthetic":true,"dpco_org_id":"synthetic-dpco-001","status":"completed","audit_reference":"SYNTHETIC-AUDIT-001"}'::jsonb
)
ON CONFLICT (audit_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();

INSERT INTO dpco_registry_service_records (registry_id, payload)
VALUES (
  '00000000-0000-4000-8000-000000000036'::uuid,
  '{"synthetic":true,"dpco_org_id":"synthetic-dpco-001","status":"active","licence_number":"SYNTHETIC-DPCO-LIC-001"}'::jsonb
)
ON CONFLICT (registry_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();

INSERT INTO dpco_verification_service_records (statement_id, payload)
VALUES (
  '00000000-0000-4000-8000-000000000037'::uuid,
  '{"synthetic":true,"dpco_org_id":"synthetic-dpco-001","status":"issued","ref_number":"SYNTHETIC-VERIFY-001"}'::jsonb
)
ON CONFLICT (statement_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();

-- Digital-twin parent records. Values are intentionally labelled scenario data,
-- never real economic, policy, regulator, or organization assertions.
INSERT INTO dt_jurisdictions (
  code, name, region, data_protection_act, regulator, adequacy_status,
  population_millions, gdp_usd_billions, digital_economy_pct
) VALUES (
  'SYNTH', 'Synthetic Fixture Jurisdiction', 'Test Region',
  'Fixture Policy Only', 'Synthetic Test Authority', 'none', 0, 0, 0
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  data_protection_act = EXCLUDED.data_protection_act,
  regulator = EXCLUDED.regulator,
  adequacy_status = EXCLUDED.adequacy_status,
  updated_at = NOW();

INSERT INTO dt_policies (
  jurisdiction_id, code, name, category, status, effective_date, rules, parameters, created_by
)
SELECT
  jurisdiction.id, 'SYNTHETIC-FIXTURE-POLICY-001', 'Synthetic Fixture Policy',
  'consent', 'draft', DATE '2026-08-31',
  '[{"target_sector":"synthetic-testing","metric":"fixture_coverage","operator":">=","threshold":1}]'::jsonb,
  '{"synthetic":true,"not_regulatory_evidence":true}'::jsonb,
  'synthetic-fixture-runner'
FROM dt_jurisdictions AS jurisdiction
WHERE jurisdiction.code = 'SYNTH'
  AND NOT EXISTS (SELECT 1 FROM dt_policies WHERE code = 'SYNTHETIC-FIXTURE-POLICY-001');

INSERT INTO dt_org_agents (
  jurisdiction_id, org_name, sector, compliance_score, security_budget_usd,
  infosec_staff, tech_maturity, risk_appetite, breach_history, penalty_history,
  data_volume_gb, cross_border, last_audit_date, metadata
)
SELECT
  jurisdiction.id, 'Synthetic Fixture Organization', 'synthetic-testing', 75.00, 1000.00,
  2, 5.0, 3.0, 0, 0, 10.00, FALSE, DATE '2026-08-31',
  '{"synthetic":true,"not_an_organization_attestation":true}'::jsonb
FROM dt_jurisdictions AS jurisdiction
WHERE jurisdiction.code = 'SYNTH'
  AND NOT EXISTS (SELECT 1 FROM dt_org_agents WHERE org_name = 'Synthetic Fixture Organization');

INSERT INTO dt_simulations (
  simulation_id, name, type, jurisdictions, policies, parameters, duration_months,
  iterations, status, started_at, completed_at, created_by
) VALUES (
  'NDSEP-SYNTHETIC-FIXTURE-001', 'Synthetic Fixture Coverage Scenario', 'scenario',
  '["SYNTH"]'::jsonb, '["SYNTHETIC-FIXTURE-POLICY-001"]'::jsonb,
  '{"synthetic":true,"random_seed":20260831,"not_policy_evidence":true}'::jsonb,
  1, 1, 'completed', '2026-08-31T00:00:00.000Z'::timestamptz,
  '2026-08-31T00:01:00.000Z'::timestamptz, 'synthetic-fixture-runner'
)
ON CONFLICT (simulation_id) DO UPDATE SET
  name = EXCLUDED.name,
  jurisdictions = EXCLUDED.jurisdictions,
  policies = EXCLUDED.policies,
  parameters = EXCLUDED.parameters,
  status = EXCLUDED.status,
  completed_at = EXCLUDED.completed_at;

INSERT INTO dt_simulation_results (
  simulation_id, jurisdiction, month, iteration, avg_compliance, breach_count,
  total_penalties_local, cross_border_flows, gdp_impact_pct, fdi_confidence,
  insurance_cost_idx, sector_data
)
SELECT
  'NDSEP-SYNTHETIC-FIXTURE-001', 'SYNTH', 1, 1, 75.00, 0,
  0, 0, 0.000, 50.00, 100.00,
  '{"synthetic-testing":{"compliance":75.00,"records":1}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM dt_simulation_results
  WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND jurisdiction = 'SYNTH' AND month = 1 AND iteration = 1
);

INSERT INTO dt_monte_carlo_stats (
  simulation_id, jurisdiction, month, metric, p5, p25, p50, p75, p95, mean, std_dev
)
SELECT
  'NDSEP-SYNTHETIC-FIXTURE-001', 'SYNTH', 1, 'compliance',
  70.0000, 72.0000, 75.0000, 78.0000, 80.0000, 75.0000, 2.5000
WHERE NOT EXISTS (
  SELECT 1 FROM dt_monte_carlo_stats
  WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND jurisdiction = 'SYNTH'
    AND month = 1 AND metric = 'compliance'
);

INSERT INTO dt_policy_impacts (
  simulation_id, policy_id, jurisdiction, sector, compliance_delta, breach_delta_pct,
  penalty_delta_local, cost_benefit_ratio, effectiveness_score, sensitivity_rank, recommendations
)
SELECT
  'NDSEP-SYNTHETIC-FIXTURE-001', policy.id, 'SYNTH', 'synthetic-testing',
  5.00, -10.00, 0, 1.0000, 75.00, 1,
  '["Synthetic scenario only; do not use for regulatory, financial, or operational decisions."]'::jsonb
FROM dt_policies AS policy
WHERE policy.code = 'SYNTHETIC-FIXTURE-POLICY-001'
  AND NOT EXISTS (
    SELECT 1 FROM dt_policy_impacts AS impact
    WHERE impact.simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND impact.policy_id = policy.id
  );

INSERT INTO dt_sandboxes (
  sandbox_id, name, description, base_snapshot, policies_applied, status, created_by, expires_at
) VALUES (
  'NDSEP-SYNTHETIC-SANDBOX-001', 'Synthetic Fixture Sandbox',
  'Fixture-only simulation sandbox; it contains no production state or authorization.',
  '{"synthetic":true,"captured_at":"2026-08-31T00:00:00.000Z"}'::jsonb,
  '["SYNTHETIC-FIXTURE-POLICY-001"]'::jsonb, 'active', 'synthetic-fixture-runner',
  '2027-08-31T00:00:00.000Z'::timestamptz
)
ON CONFLICT (sandbox_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_snapshot = EXCLUDED.base_snapshot,
  policies_applied = EXCLUDED.policies_applied,
  expires_at = EXCLUDED.expires_at;

-- Marketplace and native-mobile boundaries: fake identifiers and no routable URL/token.
INSERT INTO marketplace_plugins (
  name, description, author, version, sector, category, install_count, status, manifest
) VALUES (
  'Synthetic Fixture Policy Connector',
  'Fixture-only marketplace catalog item. It has no executable URL, secret, or network capability.',
  'synthetic-fixture-runner', '0.0.0-fixture', 'synthetic-testing', 'testing', 0, 'published',
  '{"synthetic":true,"network":"disabled","capabilities":[]}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  author = EXCLUDED.author,
  version = EXCLUDED.version,
  sector = EXCLUDED.sector,
  category = EXCLUDED.category,
  install_count = EXCLUDED.install_count,
  status = EXCLUDED.status,
  manifest = EXCLUDED.manifest;

INSERT INTO mobile_push_devices (user_id, token, platform, device_id)
VALUES (
  'synthetic-user-001', 'ndsep-synthetic-token-do-not-use-001', 'web', 'synthetic-device-001'
)
ON CONFLICT (user_id, device_id) DO UPDATE SET
  token = EXCLUDED.token,
  platform = EXCLUDED.platform,
  updated_at = NOW();

-- NOC agent memory: a bounded synthetic learning record, not an operational event.
INSERT INTO noc_agent_memory (
  memory_id, memory_type, category, title, description, context, confidence,
  usage_count, tags, embedding_vector
) VALUES (
  'SYNTHETIC-NOC-MEMORY-001', 'service_baseline', 'synthetic-testing',
  'Synthetic fixture baseline',
  'Fixture-only NOC memory demonstrating schema shape; it is not an observed production incident or baseline.',
  '{"synthetic":true,"service":"fixture-service","not_operational_evidence":true}'::jsonb,
  0.5000, 0, ARRAY['synthetic','fixture'], '[0.0,0.0,0.0]'::jsonb
)
ON CONFLICT (memory_id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  context = EXCLUDED.context,
  confidence = EXCLUDED.confidence,
  tags = EXCLUDED.tags,
  embedding_vector = EXCLUDED.embedding_vector,
  updated_at = NOW();

-- Onboarding: create/select a fake-only account, then attach a completed fixture step.
INSERT INTO users (open_id, name, role, created_at, updated_at, last_signed_in)
VALUES (
  'synthetic-onboarding-user-001', 'Synthetic Onboarding User', 'user',
  '2026-08-31T00:00:00.000Z'::timestamp, '2026-08-31T00:00:00.000Z'::timestamp,
  '2026-08-31T00:00:00.000Z'::timestamp
)
ON CONFLICT (open_id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = EXCLUDED.updated_at;

INSERT INTO onboarding_checklists (user_id, step_id, completed_at)
SELECT user_record.id, 'synthetic_fixture_completed', '2026-08-31T00:00:00.000Z'::timestamptz
FROM users AS user_record
WHERE user_record.open_id = 'synthetic-onboarding-user-001'
ON CONFLICT (user_id, step_id) DO UPDATE SET completed_at = EXCLUDED.completed_at;
