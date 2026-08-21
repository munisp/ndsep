CREATE TABLE IF NOT EXISTS public.dpco_registry_service_records (
  registry_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpco_registry_service_records_updated_at
  ON public.dpco_registry_service_records (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dpco_registry_service_records_status
  ON public.dpco_registry_service_records ((payload ->> 'status'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_dpco_registry_service_records_licence
  ON public.dpco_registry_service_records ((payload ->> 'licence_number'));
