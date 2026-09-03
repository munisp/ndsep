-- Runtime schema ownership and RLS reconciliation.
-- This migration owns the feature-flag columns formerly added at application startup
-- and the DPCO organization-isolation policy state formerly mutated at startup.

ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS strategy varchar(32) NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS parameters jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  target_table text;
  organization_column text;
  policy_name text;
BEGIN
  FOR target_table, organization_column IN
    SELECT * FROM (VALUES
      ('dpco_clients', 'dpco_org_id'),
      ('dpco_audit_engagements', 'dpco_org_id'),
      ('dpco_training_sessions', 'dpco_org_id'),
      ('dpco_policy_drafts', 'dpco_org_id'),
      ('dpco_subscriptions', 'dpco_org_id'),
      ('dpco_invoices', 'dpco_org_id'),
      ('dpco_payments', 'dpco_org_id'),
      ('platform_revenue_splits', 'dpco_org_id'),
      ('dpco_organisations', 'id')
    ) AS scoped_tables(table_name, organization_column_name)
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'required RLS table public.% is missing; apply canonical migrations before 0044', target_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    policy_name := target_table || '_org_isolation';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (
          %I = NULLIF(current_setting(''app.current_org_id'', true), '''')::integer
          OR current_setting(''app.is_admin'', true) = ''true''
        ) WITH CHECK (
          %I = NULLIF(current_setting(''app.current_org_id'', true), '''')::integer
          OR current_setting(''app.is_admin'', true) = ''true''
        )',
        policy_name,
        target_table,
        organization_column,
        organization_column
      );
    END IF;
  END LOOP;
END
$$;
