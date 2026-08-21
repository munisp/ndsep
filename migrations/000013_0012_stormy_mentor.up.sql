-- Migration 000013: 0012_stormy_mentor
-- Source: 0012_stormy_mentor.sql

CREATE TABLE "in_app_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"severity" varchar(32) DEFAULT 'info' NOT NULL,
	"category" varchar(64) DEFAULT 'system' NOT NULL,
	"organization_id" integer,
	"user_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"action_url" varchar(512),
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;