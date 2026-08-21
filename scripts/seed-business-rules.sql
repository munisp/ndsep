-- ============================================================
-- NDSEP Business Rules Seed Data
-- Phase 16: SLA Enforcement, Auto-Escalation, NDPA Deadlines
-- ============================================================

-- ── SLA Breaches (NDPA Article 40 — 72h breach notification) ──────────────────
INSERT INTO sla_breaches (organization_id, breach_type, description, severity, status, sla_deadline, breached_at, resolved_at)
SELECT
  o.id,
  'breach_notification',
  CONCAT('NDPA Art.40: Breach notification to NDPC overdue — incident detected ', DATE_FORMAT(DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*14+4) DAY), '%d %b %Y')),
  'high',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*72+1) HOUR),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*24+1) HOUR),
  NULL
FROM organizations o
WHERE o.compliance_status = 'non_compliant'
LIMIT 5;

INSERT INTO sla_breaches (organization_id, breach_type, description, severity, status, sla_deadline, breached_at, resolved_at)
SELECT
  o.id,
  'dsar_response',
  CONCAT('NDPA Art.23: DSAR response overdue — 30-day deadline exceeded for request filed ', DATE_FORMAT(DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*15+31) DAY), '%d %b %Y')),
  'medium',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*10+1) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*5+1) DAY),
  NULL
FROM organizations o
WHERE o.compliance_status IN ('non_compliant', 'under_review')
LIMIT 4;

INSERT INTO sla_breaches (organization_id, breach_type, description, severity, status, sla_deadline, breached_at, resolved_at)
SELECT
  o.id,
  'penalty_payment',
  CONCAT('NDPA Art.48: Penalty payment overdue — 14-day deadline exceeded'),
  'critical',
  'escalated',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*7+1) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*3+1) DAY),
  NULL
FROM organizations o
WHERE o.compliance_status = 'non_compliant'
LIMIT 3;

INSERT INTO sla_breaches (organization_id, breach_type, description, severity, status, sla_deadline, breached_at, resolved_at)
SELECT
  o.id,
  'dpo_appointment',
  CONCAT('NDPA Art.55: DPO appointment overdue — 90-day deadline exceeded for large data processor'),
  'high',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*30+1) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*10+1) DAY),
  NULL
FROM organizations o
WHERE o.sector IN ('banking', 'telecom', 'healthcare')
LIMIT 4;

INSERT INTO sla_breaches (organization_id, breach_type, description, severity, status, sla_deadline, breached_at, resolved_at)
SELECT
  o.id,
  'erasure_request',
  CONCAT('NDPA Art.26: Right to erasure request overdue — 30-day deadline exceeded'),
  'medium',
  'resolved',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*5+1) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*3+1) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*2) DAY)
FROM organizations o
WHERE o.compliance_status = 'compliant'
LIMIT 3;

-- ── Drift Alerts ──────────────────────────────────────────────────────────────
INSERT INTO drift_alerts (organization_id, alert_type, description, severity, status, detected_at, resolved_at)
SELECT
  o.id,
  'policy_drift',
  CONCAT('Data retention policy diverged from NDPA-approved baseline — ', FLOOR(RAND()*5+1), ' clauses modified without NDPC approval'),
  'high',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*7+1) DAY),
  NULL
FROM organizations o
WHERE o.compliance_status = 'under_review'
LIMIT 4;

INSERT INTO drift_alerts (organization_id, alert_type, description, severity, status, detected_at, resolved_at)
SELECT
  o.id,
  'config_drift',
  CONCAT('Security configuration drift detected — TLS version downgraded from 1.3 to 1.2 on ', FLOOR(RAND()*3+1), ' endpoints'),
  'medium',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*3+1) DAY),
  NULL
FROM organizations o
WHERE o.compliance_status = 'non_compliant'
LIMIT 3;

INSERT INTO drift_alerts (organization_id, alert_type, description, severity, status, detected_at, resolved_at)
SELECT
  o.id,
  'consent_drift',
  CONCAT('Consent management drift — ', FLOOR(RAND()*200+50), ' data subjects missing valid consent records after system migration'),
  'critical',
  'open',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*2+1) DAY),
  NULL
FROM organizations o
WHERE o.sector = 'fintech'
LIMIT 2;

INSERT INTO drift_alerts (organization_id, alert_type, description, severity, status, detected_at, resolved_at)
SELECT
  o.id,
  'access_drift',
  CONCAT('Access control drift — ', FLOOR(RAND()*10+3), ' privileged accounts created outside approved IAM workflow'),
  'high',
  'resolved',
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*5+3) DAY),
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*2) DAY)
FROM organizations o
WHERE o.compliance_status = 'compliant'
LIMIT 3;

-- ── Remediation Workflows (auto-escalation triggers) ─────────────────────────
-- remediation_workflows columns: id, org_id, violation_type, status, steps, assigned_to, due_date, completed_at, notes, created_at, updated_at
INSERT INTO remediation_workflows (org_id, violation_type, status, steps, assigned_to, due_date, notes, created_at, updated_at)
SELECT
  o.id,
  'breach_notification',
  'in_progress',
  JSON_ARRAY(
    'Draft breach notification using NDPC Form BN-001',
    'Submit via NDPC portal within 2 hours',
    'Notify affected data subjects within 7 days',
    'File incident report with NDSEP'
  ),
  'compliance_team',
  DATE_ADD(NOW(), INTERVAL 2 HOUR),
  CONCAT('Auto-Escalation: NDPA Art.40 Breach Notification — ', o.name, '. 72-hour NDPC notification SLA breached. Immediate action required.'),
  NOW(),
  NOW()
FROM organizations o
WHERE o.compliance_status = 'non_compliant'
LIMIT 3;

INSERT INTO remediation_workflows (org_id, violation_type, status, steps, assigned_to, due_date, notes, created_at, updated_at)
SELECT
  o.id,
  'dsar_response',
  'pending',
  JSON_ARRAY(
    'Locate all personal data held for subject',
    'Compile data export in machine-readable format',
    'Verify identity of requestor',
    'Deliver response within 24 hours',
    'Log completion in NDSEP DSAR tracker'
  ),
  'data_protection_team',
  DATE_ADD(NOW(), INTERVAL 24 HOUR),
  CONCAT('DSAR Response Workflow — ', o.name, '. Data Subject Access Request response overdue.'),
  NOW(),
  NOW()
FROM organizations o
WHERE o.compliance_status = 'under_review'
LIMIT 3;

INSERT INTO remediation_workflows (org_id, violation_type, status, steps, assigned_to, due_date, notes, created_at, updated_at)
SELECT
  o.id,
  'dpo_appointment',
  'pending',
  JSON_ARRAY(
    'Identify qualified DPO candidate (CIPP/E or equivalent)',
    'Conduct background check and credential verification',
    'Register DPO with NDPC within 14 days of appointment',
    'Publish DPO contact details on organization website',
    'Notify NDSEP of appointment completion'
  ),
  'hr_legal_team',
  DATE_ADD(NOW(), INTERVAL 14 DAY),
  CONCAT('DPO Appointment Compliance — ', o.name, '. DPO appointment required under NDPA Article 55.'),
  NOW(),
  NOW()
FROM organizations o
WHERE o.sector IN ('banking', 'telecom', 'healthcare')
LIMIT 3;

INSERT INTO remediation_workflows (org_id, violation_type, status, steps, assigned_to, due_date, notes, created_at, updated_at)
SELECT
  o.id,
  'penalty_payment',
  'escalated',
  JSON_ARRAY(
    'Issue final demand notice',
    'Apply 10% late payment surcharge per NDPA Art.48(3)',
    'Refer to NITDA for enforcement action if unpaid within 7 days',
    'Record in enforcement case management system',
    'Publish non-compliance notice on public registry'
  ),
  'enforcement_team',
  DATE_ADD(NOW(), INTERVAL 7 DAY),
  CONCAT('Penalty Payment Escalation — ', o.name, '. Financial penalty payment overdue. Escalated to enforcement team.'),
  NOW(),
  NOW()
FROM organizations o
WHERE o.compliance_status = 'non_compliant'
LIMIT 2;

-- ── Compliance Score History (30-day trend) ───────────────────────────────────
INSERT INTO compliance_score_history (organization_id, score, scored_at, scored_by, notes)
SELECT
  o.id,
  GREATEST(0, LEAST(100, COALESCE(o.compliance_score, 50) + (RAND() * 10 - 5))),
  DATE_SUB(NOW(), INTERVAL d.day_offset DAY),
  'system_auto',
  CONCAT('Auto-scored: ', d.day_offset, '-day lookback')
FROM organizations o
CROSS JOIN (
  SELECT 1 AS day_offset UNION SELECT 3 UNION SELECT 7 UNION SELECT 14 UNION SELECT 21 UNION SELECT 30
) d
WHERE o.compliance_score IS NOT NULL
LIMIT 120;

SELECT 'Business rules seed complete' AS status,
  (SELECT COUNT(*) FROM sla_breaches) AS sla_breaches,
  (SELECT COUNT(*) FROM drift_alerts) AS drift_alerts,
  (SELECT COUNT(*) FROM remediation_workflows) AS remediation_workflows,
  (SELECT COUNT(*) FROM compliance_score_history) AS score_history_rows;
