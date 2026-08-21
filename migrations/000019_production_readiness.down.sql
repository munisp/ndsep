-- Rollback: Remove production readiness enhancements
-- NOTE: This only removes indexes and constraints added in 000019.
-- Seed data removal is intentionally NOT included (additive-only data).

DROP INDEX IF EXISTS idx_breach_incidents_org_severity;
DROP INDEX IF EXISTS idx_breach_incidents_status_reported;
DROP INDEX IF EXISTS idx_consent_records_org_status;
DROP INDEX IF EXISTS idx_consent_records_expires;
DROP INDEX IF EXISTS idx_kyc_records_org_status;
DROP INDEX IF EXISTS idx_audit_logs_created;
DROP INDEX IF EXISTS idx_audit_logs_user_action;
DROP INDEX IF EXISTS idx_security_alerts_severity_status;
DROP INDEX IF EXISTS idx_ml_predictions_org_type;
DROP INDEX IF EXISTS idx_enforcement_actions_case_status;
DROP INDEX IF EXISTS idx_organizations_sector_score;
DROP INDEX IF EXISTS idx_organizations_status;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_compliance_score;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_risk_score;
ALTER TABLE breach_incidents DROP CONSTRAINT IF EXISTS chk_breach_severity;
ALTER TABLE enforcement_cases DROP CONSTRAINT IF EXISTS chk_enforcement_status;
