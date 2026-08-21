-- Migration 000014: production_indexes
-- Source: production-indexes.sql

-- ============================================================
-- NDSEP Production Database Indexes & Constraints
-- Run once after initial schema push to optimize query performance
-- ============================================================

-- ─── Organizations ────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_sector
  ON organizations(sector);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_compliance_status
  ON organizations(compliance_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_compliance_score
  ON organizations(compliance_score DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_risk_score
  ON organizations(risk_score DESC);

-- ─── Assets ───────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_org_id
  ON assets(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_status
  ON assets(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_type
  ON assets(asset_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_discovered_at
  ON assets(discovered_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_is_within_borders
  ON assets(is_within_borders) WHERE is_within_borders = false;

-- ─── Compliance Violations ────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_org_id
  ON compliance_violations(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_status
  ON compliance_violations(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_severity
  ON compliance_violations(severity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_detected_at
  ON compliance_violations(detected_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_enforcement_status
  ON compliance_violations(enforcement_status);

-- ─── Enforcement Actions ──────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_org_id
  ON enforcement_actions(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_violation_id
  ON enforcement_actions(violation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_status
  ON enforcement_actions(status);

-- ─── Financial Penalties ──────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalties_org_id
  ON financial_penalties(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalties_payment_status
  ON financial_penalties(payment_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalties_due_date
  ON financial_penalties(due_date) WHERE payment_status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalties_created_at
  ON financial_penalties(created_at DESC);

-- ─── Security Alerts ─────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_org_id
  ON security_alerts(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_severity
  ON security_alerts(severity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_is_resolved
  ON security_alerts(is_resolved) WHERE is_resolved = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_detected_at
  ON security_alerts(detected_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_mitre_technique
  ON security_alerts(mitre_technique) WHERE mitre_technique IS NOT NULL;

-- ─── Network Events ───────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_network_events_org_id
  ON network_events(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_network_events_type
  ON network_events(event_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_network_events_detected_at
  ON network_events(detected_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_network_events_is_blocked
  ON network_events(is_blocked) WHERE is_blocked = true;

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_org_id
  ON audit_logs(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);
-- Note: severity column may not exist on all audit_log schemas

-- ─── Citizen Requests ─────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_status
  ON citizen_requests(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_email
  ON citizen_requests(citizen_email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_org_id
  ON citizen_requests(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_submitted_at
  ON citizen_requests(submitted_at DESC);
-- Partial index for active requests
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_requests_active
  ON citizen_requests(submitted_at DESC) WHERE status IN ('submitted', 'acknowledged', 'in_progress', 'overdue');

-- ─── Monitoring Snapshots ─────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshots_org_id
  ON monitoring_snapshots(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshots_type
  ON monitoring_snapshots(snapshot_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshots_captured_at
  ON monitoring_snapshots(captured_at DESC);
-- Composite for leaderboard queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshots_org_type_captured
  ON monitoring_snapshots(organization_id, snapshot_type, captured_at DESC);

-- ─── Enforcement Cases ────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_cases_org_id
  ON enforcement_cases(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_cases_status
  ON enforcement_cases(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enforcement_cases_opened_at
  ON enforcement_cases(opened_at DESC);

-- ─── Portal Submissions ───────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portal_submissions_org_id
  ON portal_submissions(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portal_submissions_status
  ON portal_submissions(status);

-- ─── Transfer Approvals ───────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfer_approvals_org_id
  ON transfer_approvals(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfer_approvals_status
  ON transfer_approvals(status);

-- ─── ML Risk Predictions ─────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_org_id
  ON ml_risk_predictions(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_created_at
  ON ml_risk_predictions(created_at DESC);

-- ─── Remediation Workflows ────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_remediation_org_id
  ON remediation_workflows(org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_remediation_status
  ON remediation_workflows(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_remediation_deadline
  ON remediation_workflows(deadline) WHERE status = 'pending';

-- ─── BGP Routes ───────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bgp_routes_rpki_status
  ON bgp_routes(rpki_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bgp_routes_asn
  ON bgp_routes(origin_asn);

-- ─── SLA Breaches ─────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sla_breaches_org_id
  ON sla_breaches(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sla_breaches_status
  ON sla_breaches(status);

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role
  ON users(role);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_id
  ON users(organization_id);

-- ─── Streaming Events ─────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streaming_events_topic
  ON streaming_events(topic);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_streaming_events_created_at
  ON streaming_events(created_at DESC);

-- ─── Data Catalog ─────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_catalog_org_id
  ON data_catalog_entries(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_catalog_classification
  ON data_catalog_entries(classification);

-- ─── Statistics (for VACUUM ANALYZE) ─────────────────────────────────────────
ANALYZE organizations;
ANALYZE assets;
ANALYZE compliance_violations;
ANALYZE security_alerts;
ANALYZE financial_penalties;
ANALYZE audit_logs;
ANALYZE citizen_requests;
ANALYZE monitoring_snapshots;
