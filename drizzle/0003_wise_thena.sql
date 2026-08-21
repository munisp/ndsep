CREATE TYPE "public"."appeal_status" AS ENUM('submitted', 'under_review', 'upheld', 'dismissed', 'withdrawn');--> statement-breakpoint
CREATE TABLE "penalty_appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"penalty_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"submitted_by" varchar(256) NOT NULL,
	"contact_email" varchar(256) NOT NULL,
	"grounds_for_appeal" text NOT NULL,
	"evidence_summary" text,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb,
	"requested_outcome" varchar(64) DEFAULT 'reduction',
	"status" "appeal_status" DEFAULT 'submitted',
	"reviewed_by" integer,
	"review_notes" text,
	"reviewed_at" timestamp,
	"temporal_workflow_id" varchar(256),
	"escrow_transfer_id" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
