-- ============================================================
-- NDSEP Performance Indexes Migration
-- Creates an index only when its target table and column exist. This keeps
-- historical migrations executable while the canonical reconciliation creates
-- later-introduced tables and their matching indexes.
-- ============================================================
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('idx_organizations_sector', 'organizations', 'sector'),
      ('idx_organizations_status', 'organizations', 'status'),
      ('idx_organizations_compliance_score', 'organizations', 'compliance_score'),
      ('idx_organizations_created_at', 'organizations', 'created_at'),
      ('idx_users_role', 'users', 'role'),
      ('idx_users_created_at', 'users', 'created_at'),
      ('idx_audit_logs_user_id', 'audit_logs', 'user_id'),
      ('idx_audit_logs_action', 'audit_logs', 'action'),
      ('idx_audit_logs_resource_type', 'audit_logs', 'resource_type'),
      ('idx_audit_logs_created_at', 'audit_logs', 'created_at'),
      ('idx_citizen_requests_status', 'citizen_requests', 'status'),
      ('idx_citizen_requests_org_id', 'citizen_requests', 'organization_id'),
      ('idx_citizen_requests_submitted_at', 'citizen_requests', 'submitted_at'),
      ('idx_breach_incidents_org_id', 'breach_incidents', 'organization_id'),
      ('idx_breach_incidents_severity', 'breach_incidents', 'breach_incident_severity'),
      ('idx_breach_incidents_status', 'breach_incidents', 'breach_incident_status'),
      ('idx_violations_org_id', 'violations', 'organization_id'),
      ('idx_violations_status', 'violations', 'status'),
      ('idx_violations_severity', 'violations', 'severity'),
      ('idx_financial_penalties_org_id', 'financial_penalties', 'organization_id'),
      ('idx_financial_penalties_status', 'financial_penalties', 'status'),
      ('idx_enforcement_actions_org_id', 'enforcement_actions', 'organization_id'),
      ('idx_enforcement_actions_status', 'enforcement_actions', 'status'),
      ('idx_dpco_audit_engagements_dpco_org_id', 'dpco_audit_engagements', 'dpco_org_id'),
      ('idx_dpco_audit_engagements_stage', 'dpco_audit_engagements', 'current_stage'),
      ('idx_dpco_clients_dpco_org_id', 'dpco_clients', 'dpco_org_id'),
      ('idx_dpco_clients_status', 'dpco_clients', 'status'),
      ('idx_portal_submissions_status', 'portal_submissions', 'status'),
      ('idx_portal_submissions_created_at', 'portal_submissions', 'created_at'),
      ('idx_security_alerts_severity', 'security_alerts', 'severity'),
      ('idx_security_alerts_created_at', 'security_alerts', 'created_at'),
      ('idx_network_events_event_type', 'network_events', 'event_type'),
      ('idx_network_events_created_at', 'network_events', 'created_at'),
      ('idx_dpo_appointments_org_id', 'dpo_appointments', 'organization_id'),
      ('idx_compliance_audit_returns_org_id', 'compliance_audit_returns', 'org_id'),
      ('idx_compliance_audit_returns_status', 'compliance_audit_returns', 'status'),
      ('idx_consent_records_org_id', 'consent_records', 'organization_id'),
      ('idx_consent_records_status', 'consent_records', 'consent_status'),
      ('idx_transfer_instruments_org_id', 'transfer_instruments', 'organization_id'),
      ('idx_dpia_records_org_id', 'dpia_records', 'organization_id'),
      ('idx_dpia_records_status', 'dpia_records', 'status')
    ) AS targets(index_name, table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = spec.table_name
        AND column_name = spec.column_name
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', spec.index_name, spec.table_name, spec.column_name);
    END IF;
  END LOOP;
END $$;
