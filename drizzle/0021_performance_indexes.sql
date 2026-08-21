-- ============================================================
-- NDSEP Performance Indexes Migration
-- Adds indexes for frequently queried columns across all tables
-- ============================================================

-- Organizations
CREATE INDEX IF NOT EXISTS idx_organizations_sector ON organizations(sector);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_compliance_score ON organizations(compliance_score);
CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Citizen requests (DSAR)
CREATE INDEX IF NOT EXISTS idx_citizen_requests_status ON citizen_requests(status);
CREATE INDEX IF NOT EXISTS idx_citizen_requests_org_id ON citizen_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_citizen_requests_submitted_at ON citizen_requests(submitted_at);

-- Breach incidents
CREATE INDEX IF NOT EXISTS idx_breach_incidents_org_id ON breach_incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_breach_incidents_severity ON breach_incidents(breach_incident_severity);
CREATE INDEX IF NOT EXISTS idx_breach_incidents_status ON breach_incidents(breach_incident_status);

-- Compliance violations
CREATE INDEX IF NOT EXISTS idx_violations_org_id ON violations(organization_id);
CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);

-- Financial penalties
CREATE INDEX IF NOT EXISTS idx_financial_penalties_org_id ON financial_penalties(organization_id);
CREATE INDEX IF NOT EXISTS idx_financial_penalties_status ON financial_penalties(status);

-- Enforcement actions
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_org_id ON enforcement_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_status ON enforcement_actions(status);

-- DPCO audit engagements
CREATE INDEX IF NOT EXISTS idx_dpco_audit_engagements_dpco_org_id ON dpco_audit_engagements(dpco_org_id);
CREATE INDEX IF NOT EXISTS idx_dpco_audit_engagements_stage ON dpco_audit_engagements(current_stage);

-- DPCO clients
CREATE INDEX IF NOT EXISTS idx_dpco_clients_dpco_org_id ON dpco_clients(dpco_org_id);
CREATE INDEX IF NOT EXISTS idx_dpco_clients_status ON dpco_clients(status);

-- Portal submissions
CREATE INDEX IF NOT EXISTS idx_portal_submissions_status ON portal_submissions(status);
CREATE INDEX IF NOT EXISTS idx_portal_submissions_created_at ON portal_submissions(created_at);

-- Security alerts
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON security_alerts(created_at);

-- Network events
CREATE INDEX IF NOT EXISTS idx_network_events_event_type ON network_events(event_type);
CREATE INDEX IF NOT EXISTS idx_network_events_created_at ON network_events(created_at);

-- DPO appointments
CREATE INDEX IF NOT EXISTS idx_dpo_appointments_org_id ON dpo_appointments(organization_id);

-- Compliance audit returns
CREATE INDEX IF NOT EXISTS idx_compliance_audit_returns_org_id ON compliance_audit_returns(org_id);
CREATE INDEX IF NOT EXISTS idx_compliance_audit_returns_status ON compliance_audit_returns(status);

-- Consent records
CREATE INDEX IF NOT EXISTS idx_consent_records_org_id ON consent_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_status ON consent_records(consent_status);

-- Transfer instruments
CREATE INDEX IF NOT EXISTS idx_transfer_instruments_org_id ON transfer_instruments(organization_id);

-- DPIA records
CREATE INDEX IF NOT EXISTS idx_dpia_records_org_id ON dpia_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_dpia_records_status ON dpia_records(status);
