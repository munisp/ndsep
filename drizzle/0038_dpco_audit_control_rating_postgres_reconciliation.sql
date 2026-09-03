-- DPCO audit-control-rating PostgreSQL reconciliation.
-- DDL only. Existing duplicate natural keys block migration for accountable
-- remediation rather than silently discarding regulatory assessment history.

ALTER TABLE public.dpco_audit_control_ratings
  ADD COLUMN IF NOT EXISTS dpco_org_id integer,
  ADD COLUMN IF NOT EXISTS control_ref varchar(255),
  ADD COLUMN IF NOT EXISTS control_title varchar(255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dpco_audit_control_ratings
    GROUP BY engagement_id, control_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce dpco_audit_control_ratings natural key: duplicate (engagement_id, control_id) rows exist. Resolve and document duplicates before retrying migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpco_audit_control_ratings_natural_key
  ON public.dpco_audit_control_ratings (engagement_id, control_id);

CREATE INDEX IF NOT EXISTS idx_dpco_audit_control_ratings_dpco_org
  ON public.dpco_audit_control_ratings (dpco_org_id, engagement_id);
