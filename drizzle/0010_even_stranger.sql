ALTER TYPE "public"."compliance_status" ADD VALUE 'resolved';--> statement-breakpoint
ALTER TABLE "monitoring_snapshots" ADD COLUMN "compliance_score" real;--> statement-breakpoint
ALTER TABLE "monitoring_snapshots" ADD COLUMN "snapshot_data" jsonb;--> statement-breakpoint
ALTER TABLE "monitoring_snapshots" ADD COLUMN "issues_found" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "monitoring_snapshots" ADD COLUMN "critical_issues" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "monitoring_snapshots" ADD COLUMN "worker_name" varchar(64);