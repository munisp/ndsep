-- Rollback migration 000003: 0002_yummy_malice

DROP TABLE IF EXISTS "transfer_approvals" CASCADE;
DROP TABLE IF EXISTS "sla_breaches" CASCADE;
DROP TABLE IF EXISTS "portal_submissions" CASCADE;
DROP TABLE IF EXISTS "onboarding_phases" CASCADE;
DROP TABLE IF EXISTS "monitoring_snapshots" CASCADE;
DROP TABLE IF EXISTS "drift_alerts" CASCADE;
