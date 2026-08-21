CREATE TYPE "public"."bgp_route_status" AS ENUM('valid', 'invalid', 'unknown', 'hijacked', 'leaked');--> statement-breakpoint
CREATE TYPE "public"."ledger_tx_status" AS ENUM('pending', 'processing', 'settled', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."ledger_tx_type" AS ENUM('penalty', 'fine', 'settlement', 'refund', 'escrow', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."residency_status" AS ENUM('compliant', 'violation', 'warning', 'unknown');--> statement-breakpoint
CREATE TABLE "bgp_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"prefix" varchar(64) NOT NULL,
	"origin_asn" integer NOT NULL,
	"peer_asn" integer,
	"as_path" text,
	"next_hop" varchar(64),
	"rpki_status" "bgp_route_status" DEFAULT 'unknown',
	"is_hijacked" boolean DEFAULT false,
	"is_leaked" boolean DEFAULT false,
	"is_cross_border" boolean DEFAULT false,
	"organization_id" integer,
	"ixp_site" varchar(64),
	"community_tags" text[],
	"metadata" jsonb,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" varchar(128) NOT NULL,
	"organization_id" integer NOT NULL,
	"penalty_id" integer,
	"violation_id" integer,
	"tx_type" "ledger_tx_type" NOT NULL,
	"status" "ledger_tx_status" DEFAULT 'pending',
	"amount" real NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN',
	"debit_account" varchar(128),
	"credit_account" varchar(128),
	"tiger_beetle_id" varchar(128),
	"mojaloop_id" varchar(128),
	"description" text,
	"metadata" jsonb,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "financial_ledger_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "residency_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"data_asset_id" integer,
	"data_asset_name" varchar(256),
	"data_classification" "data_classification",
	"storage_location" varchar(128),
	"storage_country" varchar(8),
	"storage_latitude" real,
	"storage_longitude" real,
	"is_within_borders" boolean NOT NULL,
	"residency_status" "residency_status" DEFAULT 'unknown',
	"policy_id" integer,
	"violation_reason" text,
	"remediation_action" varchar(256),
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
