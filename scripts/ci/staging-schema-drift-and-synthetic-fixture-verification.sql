-- NDSEP staging schema-drift and synthetic-fixture verification query pack.
--
-- RUN AS: a read-only staging database role, after the guarded
--         `pnpm seed:remaining` command has succeeded.
-- DO NOT use this file to load fixtures. Apart from the read-only transaction
-- boundary, it contains SELECT and SHOW statements only.
--
-- Correct zero-drift protocol:
--   1. Apply the same immutable commit's Drizzle journal to a clean
--      disposable baseline database.
--   2. Run the schema fingerprint sections in this file against both the
--      baseline and staging database.
--   3. Require identical fingerprints and zero rows from every mismatch
--      query. A fingerprint from staging alone cannot prove zero drift.

BEGIN TRANSACTION READ ONLY;

-- 1. Confirm this is a read-only verification session. Review the returned
-- database name/host/role manually; do not use a production/live target.
SHOW transaction_read_only;
SELECT
  current_database() AS database_name,
  current_user AS database_role,
  current_setting('server_version_num') AS server_version_num,
  inet_server_addr()::text AS server_address,
  inet_server_port() AS server_port,
  current_setting('search_path') AS search_path;

-- 2. Active migration journal health. Drizzle records migration hashes/times,
-- not source file tags, so use this as a count/history health check and the
-- schema-contract queries below to prove that the 0035 objects exist.
SELECT
  COUNT(*) AS applied_drizzle_migrations,
  MIN(created_at) AS earliest_migration_at,
  MAX(created_at) AS latest_migration_at,
  COUNT(DISTINCT hash) AS distinct_migration_hashes
FROM drizzle.__drizzle_migrations;

-- 3. Required table-existence check. ZERO rows is required.
WITH expected(table_name) AS (
  VALUES
    ('analytics_snapshots'),
    ('article40_codes'),
    ('dpco_audit_service_records'),
    ('dpco_registry_service_records'),
    ('dpco_verification_service_records'),
    ('dt_jurisdictions'),
    ('dt_policies'),
    ('dt_org_agents'),
    ('dt_simulations'),
    ('dt_simulation_results'),
    ('dt_monte_carlo_stats'),
    ('dt_policy_impacts'),
    ('dt_sandboxes'),
    ('marketplace_plugins'),
    ('mobile_push_devices'),
    ('noc_agent_memory'),
    ('onboarding_checklists'),
    ('users')
)
SELECT expected.table_name AS missing_required_table
FROM expected
LEFT JOIN information_schema.tables actual
  ON actual.table_schema = 'public' AND actual.table_name = expected.table_name
WHERE actual.table_name IS NULL
ORDER BY expected.table_name;

-- 4. Required active-schema columns for the fixture extension. ZERO rows is
-- required. This is a targeted contract for the extension; compare the full
-- schema fingerprints below for platform-wide drift.
WITH expected(table_name, column_name) AS (
  VALUES
    ('analytics_snapshots', 'metric_name'), ('analytics_snapshots', 'dimension'),
    ('analytics_snapshots', 'dimension_value'), ('analytics_snapshots', 'metric_value'),
    ('analytics_snapshots', 'snapshot_date'), ('analytics_snapshots', 'metadata'),
    ('article40_codes', 'code_name'), ('article40_codes', 'sector'),
    ('article40_codes', 'description'), ('article40_codes', 'submitted_by'),
    ('article40_codes', 'document_url'), ('article40_codes', 'status'),
    ('dpco_audit_service_records', 'audit_id'), ('dpco_audit_service_records', 'payload'),
    ('dpco_registry_service_records', 'registry_id'), ('dpco_registry_service_records', 'payload'),
    ('dpco_verification_service_records', 'statement_id'), ('dpco_verification_service_records', 'payload'),
    ('dt_jurisdictions', 'code'), ('dt_jurisdictions', 'name'),
    ('dt_policies', 'jurisdiction_id'), ('dt_policies', 'code'), ('dt_policies', 'rules'),
    ('dt_org_agents', 'jurisdiction_id'), ('dt_org_agents', 'org_name'),
    ('dt_simulations', 'simulation_id'), ('dt_simulations', 'jurisdictions'),
    ('dt_simulation_results', 'simulation_id'), ('dt_simulation_results', 'jurisdiction'),
    ('dt_monte_carlo_stats', 'simulation_id'), ('dt_monte_carlo_stats', 'metric'),
    ('dt_policy_impacts', 'simulation_id'), ('dt_policy_impacts', 'policy_id'),
    ('dt_sandboxes', 'sandbox_id'), ('dt_sandboxes', 'base_snapshot'),
    ('marketplace_plugins', 'name'), ('marketplace_plugins', 'manifest'),
    ('mobile_push_devices', 'user_id'), ('mobile_push_devices', 'token'), ('mobile_push_devices', 'device_id'),
    ('noc_agent_memory', 'memory_id'), ('noc_agent_memory', 'context'),
    ('onboarding_checklists', 'user_id'), ('onboarding_checklists', 'step_id'),
    ('users', 'open_id'), ('users', 'role')
)
SELECT expected.table_name, expected.column_name AS missing_required_column
FROM expected
LEFT JOIN information_schema.columns actual
  ON actual.table_schema = 'public'
 AND actual.table_name = expected.table_name
 AND actual.column_name = expected.column_name
WHERE actual.column_name IS NULL
ORDER BY expected.table_name, expected.column_name;

-- 5. Every foreign key and check constraint in public must be validated.
-- ZERO rows is required unless a separately approved historical remediation
-- explicitly documents a NOT VALID constraint.
SELECT
  conrelid::regclass::text AS table_name,
  conname AS constraint_name,
  CASE contype WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check' ELSE contype::text END AS constraint_type
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND contype IN ('f', 'c')
  AND NOT convalidated
ORDER BY table_name, constraint_name;

-- 6. No invalid or not-ready public index may exist. ZERO rows is required.
SELECT
  indexes.indexrelid::regclass::text AS index_name,
  indexes.indrelid::regclass::text AS table_name,
  indexes.indisvalid,
  indexes.indisready,
  indexes.indisunique,
  indexes.indisprimary
FROM pg_index AS indexes
JOIN pg_class AS relation ON relation.oid = indexes.indrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND (NOT indexes.indisvalid OR NOT indexes.indisready)
ORDER BY table_name, index_name;

-- 7. Schema fingerprints. Run this exact section in clean baseline and
-- staging. Require the schema_column_fingerprint and schema_constraint_fingerprint
-- results to match exactly. Hashes do not disclose row data.
WITH columns_contract AS (
  SELECT
    table_schema, table_name, ordinal_position, column_name, data_type, udt_schema,
    udt_name, is_nullable, COALESCE(column_default, '') AS column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
), canonical AS (
  SELECT string_agg(
    format('%s.%s#%s:%s:%s.%s:%s:%s:%s',
      table_schema, table_name, ordinal_position, column_name, data_type,
      udt_schema, udt_name, is_nullable, column_default
    ),
    E'\n' ORDER BY table_schema, table_name, ordinal_position
  ) AS contents
  FROM columns_contract
)
SELECT md5(COALESCE(contents, '')) AS schema_column_fingerprint
FROM canonical;

WITH constraint_contract AS (
  SELECT
    conrelid::regclass::text AS table_name,
    conname,
    contype,
    condeferrable,
    condeferred,
    convalidated,
    pg_get_constraintdef(oid, true) AS definition
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
), canonical AS (
  SELECT string_agg(
    format('%s:%s:%s:%s:%s:%s:%s', table_name, conname, contype, condeferrable, condeferred, convalidated, definition),
    E'\n' ORDER BY table_name, conname
  ) AS contents
  FROM constraint_contract
)
SELECT md5(COALESCE(contents, '')) AS schema_constraint_fingerprint
FROM canonical;

WITH index_contract AS (
  SELECT
    schemaname, tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
), canonical AS (
  SELECT string_agg(
    format('%s.%s:%s:%s', schemaname, tablename, indexname, indexdef),
    E'\n' ORDER BY schemaname, tablename, indexname
  ) AS contents
  FROM index_contract
)
SELECT md5(COALESCE(contents, '')) AS schema_index_fingerprint
FROM canonical;

-- 8. Exact expected fixture records. All actual_rows must be >= minimum_rows.
-- A 0 count is a failed fixture extension. Counts greater than one should be
-- investigated for idempotency drift before any report is accepted.
WITH fixture_counts AS (
  SELECT 'analytics_snapshots'::text AS fixture_table, 1 AS minimum_rows,
    COUNT(*) FILTER (WHERE metric_name = 'synthetic_fixture_coverage' AND dimension = 'scenario' AND dimension_value = '2026-08-31')::bigint AS actual_rows
  FROM analytics_snapshots
  UNION ALL SELECT 'article40_codes', 1,
    COUNT(*) FILTER (WHERE code_name = 'SYNTHETIC-ARTICLE40-DEMO' AND sector = 'synthetic-testing')::bigint FROM article40_codes
  UNION ALL SELECT 'dpco_audit_service_records', 1,
    COUNT(*) FILTER (WHERE audit_id = '00000000-0000-4000-8000-000000000035'::uuid AND payload ->> 'synthetic' = 'true')::bigint FROM dpco_audit_service_records
  UNION ALL SELECT 'dpco_registry_service_records', 1,
    COUNT(*) FILTER (WHERE registry_id = '00000000-0000-4000-8000-000000000036'::uuid AND payload ->> 'synthetic' = 'true')::bigint FROM dpco_registry_service_records
  UNION ALL SELECT 'dpco_verification_service_records', 1,
    COUNT(*) FILTER (WHERE statement_id = '00000000-0000-4000-8000-000000000037'::uuid AND payload ->> 'synthetic' = 'true')::bigint FROM dpco_verification_service_records
  UNION ALL SELECT 'dt_org_agents', 1,
    COUNT(*) FILTER (WHERE org_name = 'Synthetic Fixture Organization')::bigint FROM dt_org_agents
  UNION ALL SELECT 'dt_simulations', 1,
    COUNT(*) FILTER (WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001')::bigint FROM dt_simulations
  UNION ALL SELECT 'dt_simulation_results', 1,
    COUNT(*) FILTER (WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND jurisdiction = 'SYNTH' AND month = 1 AND iteration = 1)::bigint FROM dt_simulation_results
  UNION ALL SELECT 'dt_monte_carlo_stats', 1,
    COUNT(*) FILTER (WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND jurisdiction = 'SYNTH' AND month = 1 AND metric = 'compliance')::bigint FROM dt_monte_carlo_stats
  UNION ALL SELECT 'dt_policy_impacts', 1,
    COUNT(*) FILTER (WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND jurisdiction = 'SYNTH' AND sector = 'synthetic-testing')::bigint FROM dt_policy_impacts
  UNION ALL SELECT 'dt_sandboxes', 1,
    COUNT(*) FILTER (WHERE sandbox_id = 'NDSEP-SYNTHETIC-SANDBOX-001')::bigint FROM dt_sandboxes
  UNION ALL SELECT 'marketplace_plugins', 1,
    COUNT(*) FILTER (WHERE name = 'Synthetic Fixture Policy Connector' AND manifest ->> 'synthetic' = 'true')::bigint FROM marketplace_plugins
  UNION ALL SELECT 'mobile_push_devices', 1,
    COUNT(*) FILTER (WHERE user_id = 'synthetic-user-001' AND device_id = 'synthetic-device-001' AND token = 'ndsep-synthetic-token-do-not-use-001')::bigint FROM mobile_push_devices
  UNION ALL SELECT 'noc_agent_memory', 1,
    COUNT(*) FILTER (WHERE memory_id = 'SYNTHETIC-NOC-MEMORY-001' AND context ->> 'synthetic' = 'true')::bigint FROM noc_agent_memory
  UNION ALL SELECT 'onboarding_checklists', 1,
    COUNT(*) FILTER (
      WHERE step_id = 'synthetic_fixture_completed'
        AND user_id = (SELECT id FROM users WHERE open_id = 'synthetic-onboarding-user-001')
    )::bigint FROM onboarding_checklists
)
SELECT fixture_table, minimum_rows, actual_rows,
  CASE WHEN actual_rows >= minimum_rows THEN 'PASS' ELSE 'FAIL' END AS result
FROM fixture_counts
ORDER BY fixture_table;

-- 9. Detect duplicate exact fixture markers. ZERO rows is required.
SELECT fixture_table, actual_rows
FROM (
  SELECT 'analytics_snapshots'::text AS fixture_table, COUNT(*)::bigint AS actual_rows
  FROM analytics_snapshots WHERE metric_name = 'synthetic_fixture_coverage' AND dimension = 'scenario' AND dimension_value = '2026-08-31'
  UNION ALL SELECT 'article40_codes', COUNT(*)::bigint FROM article40_codes WHERE code_name = 'SYNTHETIC-ARTICLE40-DEMO' AND sector = 'synthetic-testing'
  UNION ALL SELECT 'dt_simulations', COUNT(*)::bigint FROM dt_simulations WHERE simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001'
  UNION ALL SELECT 'dt_sandboxes', COUNT(*)::bigint FROM dt_sandboxes WHERE sandbox_id = 'NDSEP-SYNTHETIC-SANDBOX-001'
  UNION ALL SELECT 'marketplace_plugins', COUNT(*)::bigint FROM marketplace_plugins WHERE name = 'Synthetic Fixture Policy Connector'
  UNION ALL SELECT 'mobile_push_devices', COUNT(*)::bigint FROM mobile_push_devices WHERE user_id = 'synthetic-user-001' AND device_id = 'synthetic-device-001'
  UNION ALL SELECT 'noc_agent_memory', COUNT(*)::bigint FROM noc_agent_memory WHERE memory_id = 'SYNTHETIC-NOC-MEMORY-001'
) AS counts
WHERE actual_rows <> 1
ORDER BY fixture_table;

-- 10. Fixture-only parent-child relationship integrity. ZERO rows is required.
SELECT issue, child_reference
FROM (
  SELECT 'missing synthetic jurisdiction for organization agent'::text AS issue, agent.org_name AS child_reference
  FROM dt_org_agents agent
  LEFT JOIN dt_jurisdictions jurisdiction ON jurisdiction.id = agent.jurisdiction_id
  WHERE agent.org_name = 'Synthetic Fixture Organization' AND jurisdiction.code <> 'SYNTH'

  UNION ALL
  SELECT 'missing synthetic simulation for result', result.simulation_id
  FROM dt_simulation_results result
  LEFT JOIN dt_simulations simulation ON simulation.simulation_id = result.simulation_id
  WHERE result.simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND simulation.simulation_id IS NULL

  UNION ALL
  SELECT 'missing synthetic simulation for monte-carlo statistic', statistic.simulation_id
  FROM dt_monte_carlo_stats statistic
  LEFT JOIN dt_simulations simulation ON simulation.simulation_id = statistic.simulation_id
  WHERE statistic.simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001' AND simulation.simulation_id IS NULL

  UNION ALL
  SELECT 'missing synthetic simulation or policy for policy impact', impact.simulation_id
  FROM dt_policy_impacts impact
  LEFT JOIN dt_simulations simulation ON simulation.simulation_id = impact.simulation_id
  LEFT JOIN dt_policies policy ON policy.id = impact.policy_id
  WHERE impact.simulation_id = 'NDSEP-SYNTHETIC-FIXTURE-001'
    AND (simulation.simulation_id IS NULL OR policy.code <> 'SYNTHETIC-FIXTURE-POLICY-001')

  UNION ALL
  SELECT 'missing synthetic user for onboarding checklist', checklist.step_id
  FROM onboarding_checklists checklist
  LEFT JOIN users user_record ON user_record.id = checklist.user_id
  WHERE checklist.step_id = 'synthetic_fixture_completed'
    AND (user_record.open_id <> 'synthetic-onboarding-user-001' OR user_record.open_id IS NULL)
) AS integrity_failures
ORDER BY issue, child_reference;

-- 11. Full public table population. This is the SQL equivalent of the strict
-- `pnpm seed:verify` count pass. Any returned row identifies a still-empty table.
-- ZERO rows is required before claiming full synthetic fixture coverage. The
-- table identifier is escaped with %I before the dynamic read-only count query.
SELECT public_table.tablename AS empty_public_table
FROM pg_tables AS public_table
CROSS JOIN LATERAL (
  SELECT ((xpath(
    '/table/row/row_count/text()',
    query_to_xml(
      format('SELECT COUNT(*) AS row_count FROM public.%I', public_table.tablename),
      false,
      false,
      ''
    )
  ))[1]::text)::bigint AS row_count
) AS exact_count
WHERE public_table.schemaname = 'public'
  AND exact_count.row_count = 0
ORDER BY public_table.tablename;

-- 12. The query pack itself makes no readiness, release, or compliance claim.
SELECT
  'synthetic-fixture-verification-only'::text AS evidence_scope,
  false AS grants_readiness_credit,
  false AS grants_release_or_compliance_evidence;

ROLLBACK;
