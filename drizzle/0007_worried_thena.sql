CREATE TYPE "public"."enforcement_case_status" AS ENUM('open', 'under_investigation', 'notice_issued', 'escalated_to_nitda', 'settled', 'closed');--> statement-breakpoint
CREATE TABLE "enforcement_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"penalty_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"status" "enforcement_case_status" DEFAULT 'open' NOT NULL,
	"case_reference" varchar(64) NOT NULL,
	"assigned_officer_id" integer,
	"overdue_days" integer DEFAULT 0,
	"escalation_reason" text,
	"nitda_reference_number" varchar(128),
	"resolution_notes" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"escalated_at" timestamp,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "enforcement_cases_case_reference_unique" UNIQUE("case_reference")
);
--> statement-breakpoint
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_penalty_id_financial_penalties_id_fk" FOREIGN KEY ("penalty_id") REFERENCES "public"."financial_penalties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_assigned_officer_id_users_id_fk" FOREIGN KEY ("assigned_officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;