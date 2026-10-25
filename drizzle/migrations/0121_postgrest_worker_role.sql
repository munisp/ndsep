-- Migration 0121: least-privilege PostgREST role for sovereign-data workers.
--
-- The egress_monitor and adverse_media Python workers talk to Postgres
-- exclusively through PostgREST (SOVEREIGNTY_DB_API_URL /
-- ADVERSE_MEDIA_DB_API_URL). Before this migration there was no dedicated
-- role for that path. This creates:
--
--   ndsep_worker                NOLOGIN role the workers run AS (via the JWT
--                               `role` claim), with GRANTs limited to exactly
--                               the tables the two workers use:
--                                 egress_monitor_worker.py:
--                                   asn_geo_reference      SELECT   (reference classifier)
--                                   egress_thresholds      SELECT   (breach thresholds)
--                                   hosting_declarations   SELECT   (residency scope)
--                                   egress_flow_rollups    SELECT/INSERT/UPDATE (window rollups)
--                                   residency_violations   SELECT/INSERT        (violation emission)
--                                 adverse_media_worker.py:
--                                   adverse_media_sources  SELECT/UPDATE        (source state)
--                                   adverse_media_items    SELECT/INSERT        (ingested items)
--                                   adverse_media_entity_matches SELECT/INSERT  (org matches)
--                                   supervision_risk_signals     SELECT/INSERT  (risk signals)
--                                   organizations          SELECT (id, name)    (entity registry)
--                               No DELETE anywhere; UPDATE only where the
--                               worker actually PATCHes.
--   ndsep_postgrest_anon        NOLOGIN role used as PostgREST's
--                               db-anon-role: zero table privileges, so an
--                               unauthenticated request can read NOTHING.
--   ndsep_postgrest_authenticator  NOLOGIN role allowed to switch into the
--                               two roles above. LOGIN + password are granted
--                               OUT OF BAND (see infra/postgrest/README.md) —
--                               migrations never embed credentials.
--
-- Row-Level Security is ENABLED on every worker-reachable table with policies
-- granting access TO ndsep_worker only. Table owners (the application role)
-- bypass RLS by default, so the main app is unaffected; any FUTURE
-- PostgREST-exposed role other than ndsep_worker gets zero rows.
--
-- Idempotent: role creation guarded by pg_roles checks; GRANTs and
-- ALTER ... ENABLE RLS are naturally idempotent; policies use
-- DROP POLICY IF EXISTS + CREATE POLICY. PostgreSQL only.

-- ─── Roles ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ndsep_worker') THEN
    CREATE ROLE ndsep_worker NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ndsep_postgrest_anon') THEN
    CREATE ROLE ndsep_postgrest_anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ndsep_postgrest_authenticator') THEN
    CREATE ROLE ndsep_postgrest_authenticator NOLOGIN NOINHERIT;
  END IF;
END $$;

-- The authenticator may switch into the worker/anon roles (PostgREST model).
GRANT ndsep_worker TO ndsep_postgrest_authenticator;
GRANT ndsep_postgrest_anon TO ndsep_postgrest_authenticator;

-- Schema visibility (no table privileges implied).
GRANT USAGE ON SCHEMA public TO ndsep_worker;
GRANT USAGE ON SCHEMA public TO ndsep_postgrest_anon;

-- ─── Table grants (least privilege) ──────────────────────────────────────────
-- egress_monitor reads
GRANT SELECT ON asn_geo_reference TO ndsep_worker;
GRANT SELECT ON egress_thresholds TO ndsep_worker;
GRANT SELECT ON hosting_declarations TO ndsep_worker;
-- egress_monitor writes
GRANT SELECT, INSERT, UPDATE ON egress_flow_rollups TO ndsep_worker;
GRANT SELECT, INSERT ON residency_violations TO ndsep_worker;
-- adverse_media worker
GRANT SELECT, UPDATE ON adverse_media_sources TO ndsep_worker;
GRANT SELECT, INSERT ON adverse_media_items TO ndsep_worker;
GRANT SELECT, INSERT ON adverse_media_entity_matches TO ndsep_worker;
GRANT SELECT, INSERT ON supervision_risk_signals TO ndsep_worker;
GRANT SELECT (id, name) ON organizations TO ndsep_worker;

-- Sequence usage for BIGSERIAL id inserts (guarded — sequence names follow
-- the <table>_<col>_seq convention but are resolved dynamically).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'egress_flow_rollups', 'residency_violations',
    'adverse_media_items', 'adverse_media_entity_matches',
    'supervision_risk_signals'
  ] LOOP
    IF to_regclass(format('public.%I_id_seq', t)) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I_id_seq TO ndsep_worker', t);
    END IF;
  END LOOP;
END $$;

-- ─── Row-Level Security: worker role only ────────────────────────────────────
ALTER TABLE egress_flow_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE residency_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE adverse_media_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE adverse_media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE adverse_media_entity_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE asn_geo_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE egress_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ndsep_worker_all ON egress_flow_rollups;
CREATE POLICY ndsep_worker_all ON egress_flow_rollups
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_all ON residency_violations;
CREATE POLICY ndsep_worker_all ON residency_violations
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_all ON adverse_media_sources;
CREATE POLICY ndsep_worker_all ON adverse_media_sources
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_all ON adverse_media_items;
CREATE POLICY ndsep_worker_all ON adverse_media_items
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_all ON adverse_media_entity_matches;
CREATE POLICY ndsep_worker_all ON adverse_media_entity_matches
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_all ON supervision_risk_signals;
CREATE POLICY ndsep_worker_all ON supervision_risk_signals
  TO ndsep_worker USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ndsep_worker_read ON asn_geo_reference;
CREATE POLICY ndsep_worker_read ON asn_geo_reference
  FOR SELECT TO ndsep_worker USING (true);

DROP POLICY IF EXISTS ndsep_worker_read ON egress_thresholds;
CREATE POLICY ndsep_worker_read ON egress_thresholds
  FOR SELECT TO ndsep_worker USING (true);

DROP POLICY IF EXISTS ndsep_worker_read ON hosting_declarations;
CREATE POLICY ndsep_worker_read ON hosting_declarations
  FOR SELECT TO ndsep_worker USING (true);

DROP POLICY IF EXISTS ndsep_worker_read ON organizations;
CREATE POLICY ndsep_worker_read ON organizations
  FOR SELECT TO ndsep_worker USING (true);
