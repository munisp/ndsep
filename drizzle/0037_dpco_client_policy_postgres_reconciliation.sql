-- DPCO client-policy PostgreSQL reconciliation.
-- This migration is intentionally DDL-only. It fails closed when legacy duplicates
-- exist, because selecting an arbitrary row would erase audit history.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dpco_client_policies
    GROUP BY dpco_org_id, client_id, template_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce dpco_client_policies natural key: duplicate (dpco_org_id, client_id, template_id) rows exist. Resolve and document duplicates before retrying migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpco_client_policies_natural_key
  ON public.dpco_client_policies (dpco_org_id, client_id, template_id);

ALTER TYPE public.dpco_client_policy_status ADD VALUE IF NOT EXISTS 'customised';
ALTER TYPE public.dpco_client_policy_status ADD VALUE IF NOT EXISTS 'delivered';
