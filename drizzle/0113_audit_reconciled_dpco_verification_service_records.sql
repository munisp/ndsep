CREATE TABLE IF NOT EXISTS public.dpco_verification_service_records (
  statement_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpco_verification_service_records_updated_at
  ON public.dpco_verification_service_records (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dpco_verification_service_records_status
  ON public.dpco_verification_service_records ((payload ->> 'status'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_dpco_verification_service_records_ref_number
  ON public.dpco_verification_service_records ((payload ->> 'ref_number'));
