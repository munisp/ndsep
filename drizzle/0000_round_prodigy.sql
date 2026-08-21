CREATE TYPE "public"."asset_status" AS ENUM('active', 'inactive', 'quarantined', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('hardware', 'software', 'cloud', 'network', 'database', 'saas');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('compliant', 'non_compliant', 'under_review', 'remediation');--> statement-breakpoint
CREATE TYPE "public"."data_classification" AS ENUM('tier1_pii', 'tier2_financial', 'tier3_health', 'tier4_government', 'tier5_public');--> statement-breakpoint
CREATE TYPE "public"."enforcement_status" AS ENUM('pending', 'notice_sent', 'audit_scheduled', 'penalty_imposed', 'settled', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."network_event_type" AS ENUM('cross_border_transfer', 'exfiltration_attempt', 'anomaly', 'policy_violation', 'normal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'auditor', 'org_admin');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"status" "asset_status" DEFAULT 'active',
	"ip_address" varchar(64),
	"mac_address" varchar(64),
	"hostname" varchar(256),
	"operating_system" varchar(128),
	"os_version" varchar(64),
	"location" varchar(256),
	"latitude" real,
	"longitude" real,
	"cloud_provider" varchar(64),
	"cloud_region" varchar(64),
	"data_classification" "data_classification",
	"is_within_borders" boolean DEFAULT true,
	"vulnerability_count" integer DEFAULT 0,
	"metadata" jsonb,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"organization_id" integer,
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64),
	"resource_id" integer,
	"details" text,
	"ip_address" varchar(64),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" varchar(128),
	"opa_rule" text,
	"severity" "severity" DEFAULT 'medium',
	"is_active" boolean DEFAULT true,
	"weight" real DEFAULT 1,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"policy_id" integer,
	"asset_id" integer,
	"title" text NOT NULL,
	"description" text,
	"severity" "severity" DEFAULT 'medium',
	"status" "compliance_status" DEFAULT 'non_compliant',
	"enforcement_status" "enforcement_status" DEFAULT 'pending',
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"penalty_amount" real,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_catalog_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_id" integer,
	"name" text NOT NULL,
	"description" text,
	"data_type" varchar(128),
	"classification" "data_classification",
	"schema" jsonb,
	"lineage" jsonb,
	"quality_score" real,
	"row_count" integer,
	"size_bytes" integer,
	"storage_location" text,
	"is_within_borders" boolean DEFAULT true,
	"latitude" real,
	"longitude" real,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enforcement_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"violation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"workflow_id" varchar(128),
	"action_type" varchar(64),
	"status" "enforcement_status" DEFAULT 'pending',
	"notice_issued_at" timestamp,
	"audit_scheduled_at" timestamp,
	"penalty_imposed_at" timestamp,
	"penalty_amount" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_penalties" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"violation_id" integer,
	"enforcement_action_id" integer,
	"amount" real NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"payment_status" "payment_status" DEFAULT 'pending',
	"tiger_beetle_transfer_id" varchar(128),
	"mojaloop_transfer_id" varchar(128),
	"due_date" timestamp,
	"paid_at" timestamp,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_risk_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"model_name" varchar(128),
	"current_risk_score" real,
	"predicted_risk_score" real,
	"confidence_interval" real,
	"prediction_horizon_days" integer,
	"features" jsonb,
	"recommendation" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"source_ip" varchar(64),
	"destination_ip" varchar(64),
	"source_country" varchar(64),
	"destination_country" varchar(64),
	"source_latitude" real,
	"source_longitude" real,
	"dest_latitude" real,
	"dest_longitude" real,
	"protocol" varchar(32),
	"port" integer,
	"bytes_transferred" integer,
	"event_type" "network_event_type" DEFAULT 'normal',
	"is_cross_border" boolean DEFAULT false,
	"ixp_site" varchar(128),
	"suricata_rule_id" varchar(64),
	"is_blocked" boolean DEFAULT false,
	"metadata" jsonb,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"registration_number" varchar(64),
	"sector" varchar(128),
	"country" varchar(64),
	"city" varchar(128),
	"latitude" real,
	"longitude" real,
	"compliance_score" real DEFAULT 0,
	"compliance_status" "compliance_status" DEFAULT 'under_review',
	"agent_installed" boolean DEFAULT false,
	"agent_version" varchar(32),
	"last_agent_heartbeat" timestamp,
	"declared_asset_count" integer DEFAULT 0,
	"discovered_asset_count" integer DEFAULT 0,
	"risk_score" real DEFAULT 50,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_registration_number_unique" UNIQUE("registration_number")
);
--> statement-breakpoint
CREATE TABLE "security_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"asset_id" integer,
	"source" varchar(64),
	"alert_type" varchar(128),
	"title" text NOT NULL,
	"description" text,
	"severity" "severity" DEFAULT 'medium',
	"is_resolved" boolean DEFAULT false,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"threat_actor_id" varchar(128),
	"mitre_technique" varchar(64),
	"raw_log" text,
	"metadata" jsonb,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaming_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"source" varchar(64),
	"event_type" varchar(128),
	"payload" jsonb,
	"partition" integer,
	"offset" integer,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_intelligence" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(64),
	"indicator_type" varchar(64),
	"indicator_value" text NOT NULL,
	"threat_actor" varchar(256),
	"campaign" varchar(256),
	"mitre_tactic" varchar(128),
	"mitre_technique" varchar(64),
	"severity" "severity" DEFAULT 'medium',
	"confidence" real DEFAULT 0.5,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
