-- Migration 000009: 0008_adorable_the_hand
-- Source: 0008_adorable_the_hand.sql

CREATE TABLE "case_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_name" varchar(256),
	"from_status" varchar(64),
	"to_status" varchar(64) NOT NULL,
	"note" text,
	"nitda_ref" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_timeline" ADD CONSTRAINT "case_timeline_case_id_enforcement_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."enforcement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_timeline" ADD CONSTRAINT "case_timeline_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;