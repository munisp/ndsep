CREATE TABLE IF NOT EXISTS public.dpco_audit_service_records (
  audit_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpco_audit_service_records_updated_at
  ON public.dpco_audit_service_records (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dpco_audit_service_records_dpco_org_id
  ON public.dpco_audit_service_records ((payload ->> 'dpco_org_id'));
