-- Migration 000005: 0004_rich_violations
-- Source: 0004_rich_violations.sql

CREATE TYPE "public"."ai_risk_level" AS ENUM('minimal', 'limited', 'high', 'unacceptable');--> statement-breakpoint
CREATE TYPE "public"."ai_system_status" AS ENUM('registered', 'under_review', 'approved', 'suspended', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."citizen_request_status" AS ENUM('submitted', 'acknowledged', 'in_progress', 'completed', 'rejected', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."citizen_request_type" AS ENUM('access', 'erasure', 'portability', 'rectification', 'restriction', 'objection');--> statement-breakpoint
CREATE TYPE "public"."config_snapshot_status" AS ENUM('synced', 'drifted', 'pending', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evidence_package_status" AS ENUM('generating', 'ready', 'verified', 'expired');--> statement-breakpoint
CREATE TYPE "public"."policy_template_framework" AS ENUM('NDPR', 'GDPR', 'PIPL', 'DPDP', 'HIPAA', 'SOC2', 'ISO27001', 'DOJ_EO_14117', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."policy_template_status" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."tia_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."tia_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_systems" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"organization_id" integer NOT NULL,
	"vendor" varchar(256),
	"version" varchar(64),
	"purpose" text,
	"risk_level" "ai_risk_level" DEFAULT 'limited' NOT NULL,
	"status" "ai_system_status" DEFAULT 'registered' NOT NULL,
	"training_data_description" text,
	"personal_data_processed" boolean DEFAULT false NOT NULL,
	"cross_border_transfer" boolean DEFAULT false NOT NULL,
	"last_audit_at" timestamp,
	"next_audit_due" timestamp,
	"audit_notes" text,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citizen_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"citizen_name" varchar(256) NOT NULL,
	"citizen_email" varchar(256) NOT NULL,
	"citizen_nin" varchar(64),
	"request_type" "citizen_request_type" NOT NULL,
	"status" "citizen_request_status" DEFAULT 'submitted' NOT NULL,
	"organization_id" integer,
	"description" text,
	"response_notes" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_name" varchar(256) NOT NULL,
	"source" varchar(64) DEFAULT 'manual' NOT NULL,
	"config_data" jsonb NOT NULL,
	"status" "config_snapshot_status" DEFAULT 'synced' NOT NULL,
	"drift_summary" jsonb,
	"commit_hash" varchar(64),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"package_type" varchar(64) NOT NULL,
	"reference_id" integer,
	"reference_type" varchar(64),
	"status" "evidence_package_status" DEFAULT 'generating' NOT NULL,
	"file_url" text,
	"hmac_signature" varchar(128),
	"content_hash" varchar(128),
	"generated_by" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"framework" "policy_template_framework" NOT NULL,
	"version" varchar(32) DEFAULT '1.0' NOT NULL,
	"description" text,
	"policy_definition" jsonb NOT NULL,
	"status" "policy_template_status" DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"instantiated_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"code" varchar(32) NOT NULL,
	"parent_id" integer,
	"description" text,
	"regulatory_framework" varchar(128),
	"org_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sectors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tia_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_approval_id" integer,
	"organization_id" integer NOT NULL,
	"data_categories" jsonb,
	"destination_country" varchar(128),
	"legal_basis" varchar(256),
	"risk_level" "tia_risk_level" DEFAULT 'medium' NOT NULL,
	"status" "tia_status" DEFAULT 'draft' NOT NULL,
	"tia_document" text,
	"safeguards" text,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
