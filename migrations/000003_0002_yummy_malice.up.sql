-- Migration 000003: 0002_yummy_malice
-- Source: 0002_yummy_malice.sql

CREATE TYPE "public"."onboarding_phase" AS ENUM('registration', 'asset_inventory', 'data_catalog', 'self_assessment', 'initial_audit', 'remediation', 'certified');--> statement-breakpoint
CREATE TYPE "public"."transfer_approval_status" AS ENUM('pending', 'under_review', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TABLE "drift_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"drift_type" varchar(64) NOT NULL,
	"resource_name" text,
	"previous_state" jsonb,
	"current_state" jsonb,
	"severity" "severity" DEFAULT 'medium',
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"detected_by" varchar(64),
	"resolved_at" timestamp,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"snapshot_type" varchar(64) NOT NULL,
	"score" real,
	"previous_score" real,
	"delta" real,
	"status" varchar(32) NOT NULL,
	"worker_source" varchar(64),
	"details" jsonb,
	"alert_triggered" boolean DEFAULT false,
	"resolved_at" timestamp,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"phase" "onboarding_phase" NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"worker_results" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_token" varchar(128) NOT NULL,
	"organization_id" integer,
	"org_name" text NOT NULL,
	"org_sector" varchar(64) NOT NULL,
	"org_country" varchar(64) NOT NULL,
	"regulatory_id" varchar(128),
	"contact_name" text NOT NULL,
	"contact_email" varchar(320) NOT NULL,
	"contact_phone" varchar(32),
	"current_phase" "onboarding_phase" DEFAULT 'registration' NOT NULL,
	"asset_count" integer DEFAULT 0,
	"dataset_count" integer DEFAULT 0,
	"self_assessment_score" real,
	"compliance_score" real,
	"assigned_auditor_id" integer,
	"notes" text,
	"metadata" jsonb,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"certified_at" timestamp,
	CONSTRAINT "portal_submissions_submission_token_unique" UNIQUE("submission_token")
);
--> statement-breakpoint
CREATE TABLE "sla_breaches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sla_type" varchar(64) NOT NULL,
	"threshold" real NOT NULL,
	"actual" real NOT NULL,
	"severity" "severity" DEFAULT 'medium',
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"escalated_to" varchar(128),
	"notes" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "transfer_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" varchar(128) NOT NULL,
	"organization_id" integer NOT NULL,
	"submission_id" integer,
	"dataset_name" text NOT NULL,
	"dataset_id" integer,
	"source_country" varchar(64) NOT NULL,
	"destination_country" varchar(64) NOT NULL,
	"destination_entity" text NOT NULL,
	"volume_gb" real NOT NULL,
	"data_classification" "data_classification" NOT NULL,
	"business_justification" text NOT NULL,
	"transfer_method" varchar(64),
	"encryption_method" varchar(64),
	"status" "transfer_approval_status" DEFAULT 'pending' NOT NULL,
	"approver_id" integer,
	"approver_notes" text,
	"risk_score" real,
	"expires_at" timestamp,
	"approved_at" timestamp,
	"denied_at" timestamp,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_approvals_reference_id_unique" UNIQUE("reference_id")
);
