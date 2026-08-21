ALTER TABLE public.dpco_audit_service_records
  ADD COLUMN IF NOT EXISTS dpco_organisation_id integer,
  ADD COLUMN IF NOT EXISTS organisation_id integer,
  ADD COLUMN IF NOT EXISTS audit_engagement_id integer;

ALTER TABLE public.dpco_registry_service_records
  ADD COLUMN IF NOT EXISTS dpco_organisation_id integer;

ALTER TABLE public.dpco_verification_service_records
  ADD COLUMN IF NOT EXISTS dpco_organisation_id integer,
  ADD COLUMN IF NOT EXISTS organisation_id integer,
  ADD COLUMN IF NOT EXISTS audit_engagement_id integer;

-- Preserve only unambiguous numeric legacy references. Non-numeric historical
-- payload identifiers remain NULL and must be reconciled before a NOT NULL gate.
UPDATE public.dpco_audit_service_records
SET dpco_organisation_id = (payload ->> 'dpco_org_id')::integer
WHERE dpco_organisation_id IS NULL AND (payload ->> 'dpco_org_id') ~ '^[0-9]+$';

UPDATE public.dpco_audit_service_records
SET organisation_id = (payload ->> 'org_id')::integer
WHERE organisation_id IS NULL AND (payload ->> 'org_id') ~ '^[0-9]+$';

UPDATE public.dpco_audit_service_records
SET audit_engagement_id = (payload ->> 'audit_engagement_id')::integer
WHERE audit_engagement_id IS NULL AND (payload ->> 'audit_engagement_id') ~ '^[0-9]+$';

UPDATE public.dpco_registry_service_records
SET dpco_organisation_id = (payload ->> 'dpco_org_id')::integer
WHERE dpco_organisation_id IS NULL AND (payload ->> 'dpco_org_id') ~ '^[0-9]+$';

UPDATE public.dpco_verification_service_records
SET dpco_organisation_id = (payload ->> 'dpco_org_id')::integer
WHERE dpco_organisation_id IS NULL AND (payload ->> 'dpco_org_id') ~ '^[0-9]+$';

UPDATE public.dpco_verification_service_records
SET organisation_id = (payload ->> 'org_id')::integer
WHERE organisation_id IS NULL AND (payload ->> 'org_id') ~ '^[0-9]+$';

UPDATE public.dpco_verification_service_records
SET audit_engagement_id = (payload ->> 'audit_id')::integer
WHERE audit_engagement_id IS NULL AND (payload ->> 'audit_id') ~ '^[0-9]+$';

ALTER TABLE public.dpco_audit_service_records
  ADD CONSTRAINT dpco_audit_service_records_dpco_organisation_fk
  FOREIGN KEY (dpco_organisation_id) REFERENCES public.dpco_organisations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dpco_audit_service_records_organisation_fk
  FOREIGN KEY (organisation_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dpco_audit_service_records_engagement_fk
  FOREIGN KEY (audit_engagement_id) REFERENCES public.dpco_audit_engagements(id) ON DELETE RESTRICT;

ALTER TABLE public.dpco_registry_service_records
  ADD CONSTRAINT dpco_registry_service_records_dpco_organisation_fk
  FOREIGN KEY (dpco_organisation_id) REFERENCES public.dpco_organisations(id) ON DELETE RESTRICT;

ALTER TABLE public.dpco_verification_service_records
  ADD CONSTRAINT dpco_verification_service_records_dpco_organisation_fk
  FOREIGN KEY (dpco_organisation_id) REFERENCES public.dpco_organisations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dpco_verification_service_records_organisation_fk
  FOREIGN KEY (organisation_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dpco_verification_service_records_engagement_fk
  FOREIGN KEY (audit_engagement_id) REFERENCES public.dpco_audit_engagements(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_dpco_audit_service_records_dpco_organisation_id
  ON public.dpco_audit_service_records (dpco_organisation_id);
CREATE INDEX IF NOT EXISTS idx_dpco_audit_service_records_organisation_id
  ON public.dpco_audit_service_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dpco_audit_service_records_audit_engagement_id
  ON public.dpco_audit_service_records (audit_engagement_id);
CREATE INDEX IF NOT EXISTS idx_dpco_registry_service_records_dpco_organisation_id
  ON public.dpco_registry_service_records (dpco_organisation_id);
CREATE INDEX IF NOT EXISTS idx_dpco_verification_service_records_dpco_organisation_id
  ON public.dpco_verification_service_records (dpco_organisation_id);
CREATE INDEX IF NOT EXISTS idx_dpco_verification_service_records_organisation_id
  ON public.dpco_verification_service_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dpco_verification_service_records_audit_engagement_id
  ON public.dpco_verification_service_records (audit_engagement_id);
