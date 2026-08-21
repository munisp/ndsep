-- Final lifecycle states must carry their externally visible identifiers.
-- NOT VALID keeps historical malformed drafts deployable while enforcing the rule
-- for every inserted or updated record. Validate after historical remediation.

ALTER TABLE public.dpco_registry_service_records
  ADD CONSTRAINT dpco_registry_active_requires_licence_number
  CHECK (
    COALESCE(payload ->> 'status', '') <> 'active'
    OR COALESCE(length(btrim(payload ->> 'licence_number')), 0) > 0
  ) NOT VALID;

ALTER TABLE public.dpco_verification_service_records
  ADD CONSTRAINT dpco_verification_issued_requires_ref_number
  CHECK (
    COALESCE(payload ->> 'status', '') <> 'issued'
    OR COALESCE(length(btrim(payload ->> 'ref_number')), 0) > 0
  ) NOT VALID;

-- These constraints are enforced on all future writes immediately. Run the
-- following only after legacy records have been repaired:
-- ALTER TABLE public.dpco_registry_service_records
--   VALIDATE CONSTRAINT dpco_registry_active_requires_licence_number;
-- ALTER TABLE public.dpco_verification_service_records
--   VALIDATE CONSTRAINT dpco_verification_issued_requires_ref_number;
