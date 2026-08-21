-- Rollback migration 000005: 0004_rich_violations

DROP TABLE IF EXISTS "tia_assessments" CASCADE;
DROP TABLE IF EXISTS "sectors" CASCADE;
DROP TABLE IF EXISTS "policy_templates" CASCADE;
DROP TABLE IF EXISTS "evidence_packages" CASCADE;
DROP TABLE IF EXISTS "config_snapshots" CASCADE;
DROP TABLE IF EXISTS "citizen_requests" CASCADE;
DROP TABLE IF EXISTS "ai_systems" CASCADE;
