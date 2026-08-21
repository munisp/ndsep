CREATE TYPE "public"."remediation_workflow_status" AS ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TABLE "remediation_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"violation_id" integer,
	"org_id" integer,
	"action_type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"description" text,
	"status" "remediation_workflow_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" integer,
	"deadline" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "remediation_workflows" ADD CONSTRAINT "remediation_workflows_violation_id_compliance_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."compliance_violations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_workflows" ADD CONSTRAINT "remediation_workflows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_workflows" ADD CONSTRAINT "remediation_workflows_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;