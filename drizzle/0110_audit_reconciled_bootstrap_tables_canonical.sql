-- Canonicalize the tables historically created by application bootstrap code.
-- Each statement is additive and idempotent so deployments that already have
-- the runtime tables converge without losing data.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id integer NOT NULL,
  name varchar(128) NOT NULL,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_prefix varchar(12) NOT NULL,
  scopes text[] NOT NULL DEFAULT '{read}',
  rate_limit_rpm integer NOT NULL DEFAULT 60,
  expires_at timestamptz,
  last_used_at timestamptz,
  total_requests integer DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid,
  endpoint varchar(256) NOT NULL,
  method varchar(8) NOT NULL,
  status_code integer,
  response_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.compliance_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id integer,
  org_name text,
  event_type varchar(128) NOT NULL,
  aggregate_type varchar(64) NOT NULL,
  aggregate_id varchar(128) NOT NULL,
  summary text NOT NULL,
  severity varchar(32),
  actor_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enforcement_summary (
  org_id integer PRIMARY KEY,
  org_name text,
  open_cases integer DEFAULT 0,
  total_penalties_ngn numeric(15,2) DEFAULT 0,
  pending_penalties integer DEFAULT 0,
  breaches_reported integer DEFAULT 0,
  last_event_at timestamptz,
  compliance_score_impact real DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_name varchar(128) NOT NULL UNIQUE,
  last_event_id uuid,
  last_processed_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'active',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(64) NOT NULL,
  aggregate_id varchar(128) NOT NULL,
  version integer NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id)
);

CREATE TABLE IF NOT EXISTS public.event_store (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(64) NOT NULL,
  aggregate_id varchar(128) NOT NULL,
  event_type varchar(128) NOT NULL,
  version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  hash varchar(64) NOT NULL,
  prev_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, version)
);

CREATE TABLE IF NOT EXISTS public.feature_flag_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name varchar(128) NOT NULL,
  action varchar(16) NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_plugins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL UNIQUE,
  description text,
  author varchar(128),
  version varchar(16) NOT NULL DEFAULT '1.0.0',
  sector varchar(64),
  category varchar(64),
  install_count integer DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'published',
  manifest jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_checklists (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  step_id varchar(100) NOT NULL,
  completed_at timestamptz DEFAULT now(),
  UNIQUE (user_id, step_id)
);

CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
  id serial PRIMARY KEY,
  org_id integer NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret text NOT NULL,
  active boolean DEFAULT true,
  failure_count integer DEFAULT 0,
  last_delivery_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id serial PRIMARY KEY,
  subscription_id integer,
  event text NOT NULL,
  payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  attempt integer DEFAULT 1,
  delivered_at timestamptz DEFAULT now(),
  success boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_api_usage_created ON public.api_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_key_id_fk ON public.api_usage_log (api_key_id);
CREATE INDEX IF NOT EXISTS idx_compliance_timeline_org ON public.compliance_timeline (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_store_aggregate ON public.event_store (aggregate_type, aggregate_id, version);
CREATE INDEX IF NOT EXISTS idx_event_store_created ON public.event_store (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_store_type ON public.event_store (event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_sub ON public.webhook_deliveries (subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_org ON public.webhook_subscriptions (org_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_usage_log_api_key_id_fkey') THEN
    ALTER TABLE public.api_usage_log
      ADD CONSTRAINT api_usage_log_api_key_id_fkey
      FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_deliveries_subscription_id_fkey') THEN
    ALTER TABLE public.webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_subscription_id_fkey
      FOREIGN KEY (subscription_id) REFERENCES public.webhook_subscriptions(id);
  END IF;
END $$;
