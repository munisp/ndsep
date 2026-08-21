-- Migration: Billing tables for local PostgreSQL
-- dpco_invoices, dpco_payments, dpco_subscriptions, platform_revenue_splits

DO $$ BEGIN
  CREATE TYPE dpco_invoice_status AS ENUM('draft','sent','paid','overdue','cancelled','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_service_type AS ENUM('audit','dpia','training','advisory','gap_assessment','certification','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_payment_method AS ENUM('bank_transfer','card','ussd','paystack','flutterwave','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_subscription_tier AS ENUM('starter','professional','enterprise','unlimited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dpco_subscription_status AS ENUM('active','suspended','cancelled','trial','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS dpco_invoices (
  id serial PRIMARY KEY,
  invoice_number varchar(64) NOT NULL UNIQUE,
  dpco_org_id integer NOT NULL,
  client_id integer,
  client_name varchar(255) NOT NULL,
  status dpco_invoice_status DEFAULT 'draft' NOT NULL,
  service_type dpco_service_type DEFAULT 'audit' NOT NULL,
  description text NOT NULL,
  subtotal numeric(15,2) NOT NULL,
  vat_rate numeric(5,4) DEFAULT 0.075,
  vat_amount numeric(15,2) NOT NULL,
  total_amount numeric(15,2) NOT NULL,
  platform_fee_rate numeric(5,4) DEFAULT 0.1000 NOT NULL,
  platform_fee_amount numeric(15,2) NOT NULL,
  dpco_net_amount numeric(15,2) NOT NULL,
  currency varchar(8) DEFAULT 'NGN' NOT NULL,
  issue_date timestamp NOT NULL,
  due_date timestamp NOT NULL,
  paid_at timestamp,
  notes text,
  line_items jsonb,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS dpco_payments (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL,
  dpco_org_id integer NOT NULL,
  payment_reference varchar(128) NOT NULL UNIQUE,
  amount numeric(15,2) NOT NULL,
  platform_fee_amount numeric(15,2) NOT NULL,
  dpco_net_amount numeric(15,2) NOT NULL,
  currency varchar(8) DEFAULT 'NGN' NOT NULL,
  payment_method dpco_payment_method DEFAULT 'bank_transfer' NOT NULL,
  paid_at timestamp DEFAULT now() NOT NULL,
  gateway_reference varchar(256),
  notes text,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS dpco_subscriptions (
  id serial PRIMARY KEY,
  dpco_org_id integer NOT NULL UNIQUE,
  tier dpco_subscription_tier DEFAULT 'starter' NOT NULL,
  status dpco_subscription_status DEFAULT 'trial' NOT NULL,
  monthly_fee numeric(15,2) NOT NULL,
  currency varchar(8) DEFAULT 'NGN' NOT NULL,
  max_clients integer DEFAULT 10 NOT NULL,
  max_audits_per_month integer DEFAULT 5 NOT NULL,
  platform_fee_rate numeric(5,4) DEFAULT 0.1000 NOT NULL,
  trial_ends_at timestamp,
  current_period_start timestamp DEFAULT now() NOT NULL,
  current_period_end timestamp NOT NULL,
  cancelled_at timestamp,
  features jsonb,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_revenue_splits (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL,
  invoice_id integer NOT NULL,
  dpco_org_id integer NOT NULL,
  total_amount numeric(15,2) NOT NULL,
  platform_share numeric(15,2) NOT NULL,
  dpco_share numeric(15,2) NOT NULL,
  platform_fee_rate numeric(5,4) NOT NULL,
  currency varchar(8) DEFAULT 'NGN' NOT NULL,
  split_at timestamp DEFAULT now() NOT NULL,
  platform_paid_out boolean DEFAULT false NOT NULL,
  dpco_paid_out boolean DEFAULT false NOT NULL,
  platform_paid_out_at timestamp,
  dpco_paid_out_at timestamp,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);
