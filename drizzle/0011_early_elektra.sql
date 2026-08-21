CREATE TABLE "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"penalty_issued" boolean DEFAULT true NOT NULL,
	"penalty_paid" boolean DEFAULT true NOT NULL,
	"penalty_appeal_filed" boolean DEFAULT true NOT NULL,
	"penalty_appeal_decision" boolean DEFAULT true NOT NULL,
	"enforcement_case_opened" boolean DEFAULT true NOT NULL,
	"certificate_granted" boolean DEFAULT true NOT NULL,
	"portal_phase_update" boolean DEFAULT true NOT NULL,
	"citizen_request_update" boolean DEFAULT true NOT NULL,
	"sla_breach_warning" boolean DEFAULT true NOT NULL,
	"compliance_score_change" boolean DEFAULT false NOT NULL,
	"dpo_email" varchar(256),
	"technical_email" varchar(256),
	"legal_email" varchar(256),
	"digest_frequency" varchar(32) DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;