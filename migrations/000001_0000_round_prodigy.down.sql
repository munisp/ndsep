-- Rollback migration 000001: 0000_round_prodigy

DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "threat_intelligence" CASCADE;
DROP TABLE IF EXISTS "streaming_events" CASCADE;
DROP TABLE IF EXISTS "security_alerts" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;
DROP TABLE IF EXISTS "network_events" CASCADE;
DROP TABLE IF EXISTS "ml_risk_predictions" CASCADE;
DROP TABLE IF EXISTS "financial_penalties" CASCADE;
DROP TABLE IF EXISTS "enforcement_actions" CASCADE;
DROP TABLE IF EXISTS "data_catalog_entries" CASCADE;
DROP TABLE IF EXISTS "compliance_violations" CASCADE;
DROP TABLE IF EXISTS "compliance_policies" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "assets" CASCADE;
