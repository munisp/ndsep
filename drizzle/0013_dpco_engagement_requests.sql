-- Migration: Add dpco_engagement_requests table
-- Allows regulated organisations to request a DPCO audit via the Org Portal

CREATE TYPE IF NOT EXISTS "public"."dpco_engagement_request_status" AS ENUM(
  'pending', 'accepted', 'declined', 'withdrawn', 'converted'
);

CREATE TABLE IF NOT EXISTS "dpco_engagement_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_name" varchar(255) NOT NULL,
  "org_sector" varchar(100),
  "org_country" varchar(100),
  "org_registration_number" varchar(100),
  "contact_name" varchar(255) NOT NULL,
  "contact_email" varchar(320) NOT NULL,
  "contact_phone" varchar(50),
  "dpco_org_id" integer NOT NULL,
  "audit_scope" text,
  "preferred_start_date" timestamp,
  "estimated_data_subjects" varchar(100),
  "processing_activities" text[],
  "status" "dpco_engagement_request_status" DEFAULT 'pending' NOT NULL,
  "dpco_response_note" text,
  "responded_at" timestamp,
  "engagement_id" integer,
  "reference_token" varchar(64) NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
