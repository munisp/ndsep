CREATE TYPE "public"."mobile_middleware_status" AS ENUM('planned', 'connected', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."mobile_user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."mobile_obligation_status" AS ENUM('pending', 'satisfied', 'at_risk');--> statement-breakpoint
CREATE TYPE "public"."mobile_permit_priority" AS ENUM('routine', 'elevated', 'critical');--> statement-breakpoint
CREATE TYPE "public"."mobile_permit_sector" AS ENUM('mining', 'oil_gas', 'multi_agency');--> statement-breakpoint
CREATE TYPE "public"."mobile_permit_stage" AS ENUM('intake', 'spatial_clearance', 'technical_review', 'environmental_review', 'agency_coordination', 'payment_pending', 'approval', 'issued', 'active_monitoring');--> statement-breakpoint
CREATE TYPE "public"."mobile_service_health" AS ENUM('healthy', 'warning');--> statement-breakpoint
CREATE TYPE "public"."mobile_service_language" AS ENUM('typescript', 'python', 'go', 'rust');--> statement-breakpoint
CREATE TYPE "public"."mobile_service_runtime_mode" AS ENUM('webdev_backend', 'external_service', 'reserved_worker');--> statement-breakpoint
CREATE TABLE "middlewareComponents" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"purpose" text NOT NULL,
	"status" "mobile_middleware_status" NOT NULL,
	"ownerService" varchar(120) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permitCases" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"sector" "mobile_permit_sector" NOT NULL,
	"permitType" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"applicantName" varchar(255) NOT NULL,
	"locationLabel" varchar(255) NOT NULL,
	"assetReference" varchar(120) NOT NULL,
	"stage" "mobile_permit_stage" NOT NULL,
	"priority" "mobile_permit_priority" NOT NULL,
	"leadAgencyId" varchar(80) NOT NULL,
	"participatingAgencyIds" jsonb NOT NULL,
	"summary" text NOT NULL,
	"timeline" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permitObligations" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"permitCaseId" varchar(80) NOT NULL,
	"title" varchar(255) NOT NULL,
	"dueAt" timestamp with time zone NOT NULL,
	"status" "mobile_obligation_status" NOT NULL,
	"owner" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permittingAgencies" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" text NOT NULL,
	"jurisdiction" varchar(120) NOT NULL,
	"reviewSlaHours" integer NOT NULL,
	"queueDepth" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serviceTopology" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"language" "mobile_service_language" NOT NULL,
	"responsibility" text NOT NULL,
	"runtimeMode" "mobile_service_runtime_mode" NOT NULL,
	"endpointPath" varchar(255) NOT NULL,
	"health" "mobile_service_health" NOT NULL,
	"middlewareKeys" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "mobile_user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mobile_touch_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "mobile_users_touch_updated_at"
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "mobile_middleware_components_touch_updated_at"
BEFORE UPDATE ON "middlewareComponents"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "mobile_permit_cases_touch_updated_at"
BEFORE UPDATE ON "permitCases"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "mobile_permit_obligations_touch_updated_at"
BEFORE UPDATE ON "permitObligations"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "mobile_permitting_agencies_touch_updated_at"
BEFORE UPDATE ON "permittingAgencies"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "mobile_service_topology_touch_updated_at"
BEFORE UPDATE ON "serviceTopology"
FOR EACH ROW EXECUTE FUNCTION "mobile_touch_updated_at"();
