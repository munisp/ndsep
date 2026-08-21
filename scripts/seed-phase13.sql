-- ============================================================
-- NDSEP Phase 13 Demo Seed Data (corrected column names)
-- Run: PGPASSWORD=ndsep_secure_2026 psql -U ndsep_user -d ndsep_db -h localhost -f scripts/seed-phase13.sql
-- ============================================================

BEGIN;

-- ── 1. Consent Records ────────────────────────────────────────────────────────
INSERT INTO consent_records_v2 (org_id, data_subject_id, data_subject_email, purpose, legal_basis, data_categories, third_party_sharing, third_parties, status, consent_given, expiry_date, created_at, updated_at)
VALUES
  (9,  'DS-001', 'user001@9mobile.com.ng',    'service_delivery',     'consent',              ARRAY['name','email','phone'],      false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '1 year',  NOW() - INTERVAL '30 days', NOW()),
  (10, 'DS-002', 'patient002@luth.gov.ng',    'healthcare_treatment', 'vital_interests',      ARRAY['health_data','name'],        false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '2 years', NOW() - INTERVAL '25 days', NOW()),
  (11, 'DS-003', 'employee003@nnpc.com.ng',   'employment_records',   'contract',             ARRAY['name','address','salary'],   false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '5 years', NOW() - INTERVAL '20 days', NOW()),
  (15, 'DS-004', 'user004@flutterwave.com',   'payment_processing',   'contract',             ARRAY['name','bank_details'],       true,  ARRAY['Stripe','Paystack'], 'active', true, NOW() + INTERVAL '1 year', NOW() - INTERVAL '15 days', NOW()),
  (16, 'DS-005', 'merchant005@paystack.co',   'marketing',            'consent',              ARRAY['email','phone'],             false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '6 months', NOW() - INTERVAL '10 days', NOW()),
  (17, 'DS-006', 'customer006@kuda.com',      'fraud_prevention',     'legitimate_interests', ARRAY['transaction_data','device'], true,  ARRAY['Experian'], 'active',  true,  NOW() + INTERVAL '3 years', NOW() - INTERVAL '8 days',  NOW()),
  (9,  'DS-007', 'user007@9mobile.com.ng',    'analytics',            'consent',              ARRAY['usage_data'],                false, ARRAY[]::text[], 'withdrawn', false, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '60 days', NOW()),
  (10, 'DS-008', 'patient008@luth.gov.ng',    'research',             'consent',              ARRAY['anonymised_health'],         false, ARRAY[]::text[], 'expired',   false, NOW() - INTERVAL '10 days', NOW() - INTERVAL '400 days', NOW()),
  (13, 'DS-009', 'insured009@axa.com.ng',     'insurance_underwriting','contract',            ARRAY['name','health_data','age'],  true,  ARRAY['Munich Re'], 'active',  true,  NOW() + INTERVAL '1 year', NOW() - INTERVAL '5 days',  NOW()),
  (14, 'DS-010', 'client010@leadway.com',     'claims_processing',    'contract',             ARRAY['name','bank_details'],       false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '2 years', NOW() - INTERVAL '3 days',  NOW()),
  (12, 'DS-011', 'employee011@dangote.com',   'payroll',              'legal_obligation',     ARRAY['name','salary','tax_id'],    true,  ARRAY['FIRS'], 'active',      true,  NOW() + INTERVAL '7 years', NOW() - INTERVAL '2 days',  NOW()),
  (11, 'DS-012', 'contractor012@nnpc.com.ng', 'contractor_management','contract',             ARRAY['name','address'],            false, ARRAY[]::text[], 'active',    true,  NOW() + INTERVAL '1 year', NOW() - INTERVAL '1 day',   NOW())
ON CONFLICT DO NOTHING;

-- ── 2. DPO Appointments ───────────────────────────────────────────────────────
INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone, dpco_name, credential_status, is_active, notes, created_at, updated_at)
VALUES
  (9,  'Adaeze Okonkwo',    'adaeze.okonkwo@9mobile.com.ng',    '+2348011111101', 'DataGuard Ltd',         'verified', true,  'CIPP/E certified, 8 years experience',              NOW() - INTERVAL '90 days', NOW()),
  (10, 'Dr. Emeka Eze',     'emeka.eze@luth.gov.ng',            '+2348011111102', 'HealthData Consult',    'verified', true,  'Medical data specialist, CIPM certified',           NOW() - INTERVAL '80 days', NOW()),
  (11, 'Fatima Al-Hassan',  'fatima.alhassan@nnpc.com.ng',      '+2348011111103', 'PetroData Services',    'verified', true,  'Energy sector DPO, ISO 27001 lead auditor',         NOW() - INTERVAL '70 days', NOW()),
  (15, 'Chukwuemeka Obi',   'chukwuemeka.obi@flutterwave.com',  '+2348011111104', 'FinTech Privacy Ltd',   'verified', true,  'Fintech privacy expert, PCI-DSS certified',         NOW() - INTERVAL '60 days', NOW()),
  (16, 'Ngozi Adeyemi',     'ngozi.adeyemi@paystack.co',        '+2348011111105', 'PayPrivacy Consult',    'verified', true,  'Payment data specialist',                           NOW() - INTERVAL '50 days', NOW()),
  (17, 'Babatunde Lawal',   'babatunde.lawal@kuda.com',         '+2348011111106', 'Digital Bank Privacy',  'pending',  true,  'Awaiting NDPC credential verification',             NOW() - INTERVAL '30 days', NOW()),
  (13, 'Amaka Nwosu',       'amaka.nwosu@axa.com.ng',           '+2348011111107', 'InsurePrivacy Ltd',     'verified', true,  'Insurance data specialist, CIPP/E',                 NOW() - INTERVAL '20 days', NOW()),
  (14, 'Segun Adeleke',     'segun.adeleke@leadway.com',        '+2348011111108', 'Leadway Privacy',       'pending',  true,  'Application under review',                          NOW() - INTERVAL '10 days', NOW()),
  (9,  'Hauwa Ibrahim',     'hauwa.ibrahim@9mobile2.com.ng',    '+2348011111109', 'IndustrialData Consult','revoked',  false, 'Credentials not meeting NDPA requirements',         NOW() - INTERVAL '5 days',  NOW()),
  (9,  'Oluwaseun Bello',   'oluwaseun.bello@9mobile.com.ng',   '+2348011111110', 'TelecomPrivacy Ltd',    'verified', true,  'Backup DPO, CIPM certified',                        NOW() - INTERVAL '2 days',  NOW())
ON CONFLICT DO NOTHING;

-- ── 3. Notification Inbox ─────────────────────────────────────────────────────
INSERT INTO notification_inbox (user_id, notification_type, title, body, priority, is_read, action_url, created_at)
VALUES
  (NULL, 'compliance_alert',    'Critical Compliance Violation Detected',    '9mobile has recorded a compliance score drop of 23 points in the last 7 days. Immediate review required.', 'critical', false, '/compliance',           NOW() - INTERVAL '2 hours'),
  (NULL, 'dpo_appointment',     'New DPO Registration Pending Verification', 'Babatunde Lawal from Kuda Bank has submitted DPO credentials for NDPC verification.',                       'high',     false, '/dpo-registry',         NOW() - INTERVAL '4 hours'),
  (NULL, 'breach_notification', 'Data Breach Notification Received',         'Flutterwave has reported a potential data breach affecting 12,500 customers. NDPA timeline started.',        'critical', false, '/siem',                 NOW() - INTERVAL '6 hours'),
  (NULL, 'cross_border',        'Unnotified Cross-Border Transfer Detected', 'NNPC Limited has 3 cross-border transfers to the United States without NITDA notification.',               'high',     false, '/cross-border-monitor', NOW() - INTERVAL '8 hours'),
  (NULL, 'penalty_approved',    'Penalty Calculation Approved',              'Penalty of NGN 125,000,000 for AXA Mansard Insurance has been approved by the Director General.',           'medium',   true,  '/penalty-calculator',   NOW() - INTERVAL '12 hours'),
  (NULL, 'regulatory_report',   'Quarterly Report Due in 7 Days',            'Q1 2026 National Compliance Report is due for submission to NDPC by April 30, 2026.',                       'high',     false, '/regulatory-reporting', NOW() - INTERVAL '1 day'),
  (NULL, 'whistleblower',       'New Whistleblower Case Opened',             'Case WB-2026-0042 has been opened regarding suspected data misuse at Dangote Cement. Severity: High.',     'high',     false, '/whistleblower-cases',  NOW() - INTERVAL '2 days'),
  (NULL, 'dsar_completed',      'Bulk DSAR Job Completed',                   'Bulk data access request job for Paystack (150 subjects) has been completed successfully.',                  'low',      true,  '/bulk-dsar',            NOW() - INTERVAL '3 days'),
  (NULL, 'risk_scorecard',      'Critical Risk Item Requires Mitigation',    'Unencrypted PII Storage risk at LUTH has been escalated to Critical. Mitigation plan required within 48h.', 'critical', false, '/risk-scorecard',       NOW() - INTERVAL '4 days'),
  (NULL, 'consent_expiry',      '45 Consent Records Expiring This Month',    '45 consent records across 8 organisations will expire within 30 days. Renewal notifications sent.',        'medium',   true,  '/consent-records',      NOW() - INTERVAL '5 days'),
  (NULL, 'compliance_calendar', 'NDPA Annual Audit Deadline Approaching',    'Annual compliance audit for financial sector organisations is due by May 31, 2026.',                        'high',     false, '/compliance-calendar',  NOW() - INTERVAL '6 days'),
  (NULL, 'data_residency',      'Data Residency Violation Detected',         'Leadway Assurance is storing customer PII in a non-adequate jurisdiction (Belarus) without SCCs.',          'critical', false, '/data-residency',       NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ── 4. Penalty Calculations ───────────────────────────────────────────────────
INSERT INTO penalty_calculations (org_id, org_name, violation_type, violation_date, annual_turnover, base_penalty, aggravating_factors, mitigating_factors, aggravating_multiplier, mitigating_reduction, final_penalty, penalty_cap, calculation_basis, status, created_at, updated_at)
VALUES
  (9,  '9mobile',               'data_breach',         '2026-01-15', 45000000000, 900000000,  ARRAY['repeat_offender','large_scale'], ARRAY['cooperation'],            1.2, 0.05, 1026000000, 1125000000, 'NDPA 2023 s48: 2.5% of NGN 45B (repeat offender)', 'approved',  NOW() - INTERVAL '60 days', NOW()),
  (10, 'LUTH',                  'inadequate_security', '2026-01-20', 8000000000,  200000000,  ARRAY['sensitive_data'],               ARRAY['prompt_action','cooperation'], 1.1, 0.10, 198000000,  200000000,  'NDPA 2023 s48: 2.5% of NGN 8B',                    'approved',  NOW() - INTERVAL '45 days', NOW()),
  (11, 'NNPC Limited',          'unlawful_transfer',   '2026-02-01', 120000000000,2400000000, ARRAY['repeat_offender'],              ARRAY[]::text[],                 1.1, 0.00, 2640000000, 3000000000, 'NDPA 2023 s48: 2.5% of NGN 120B (repeat offender)', 'pending',   NOW() - INTERVAL '30 days', NOW()),
  (15, 'Flutterwave',           'data_breach',         '2026-02-10', 35000000000, 700000000,  ARRAY['large_scale','sensitive_data'], ARRAY['cooperation','prompt_action'], 1.2, 0.10, 756000000,  875000000,  'NDPA 2023 s48: 2% of NGN 35B',                     'approved',  NOW() - INTERVAL '20 days', NOW()),
  (13, 'AXA Mansard Insurance', 'consent_violation',   '2026-02-15', 25000000000, 500000000,  ARRAY[]::text[],                      ARRAY['cooperation'],            1.0, 0.05, 475000000,  625000000,  'NDPA 2023 s48: 2% of NGN 25B',                     'approved',  NOW() - INTERVAL '15 days', NOW()),
  (17, 'Kuda Bank',             'inadequate_security', '2026-03-01', 12000000000, 240000000,  ARRAY['sensitive_data'],               ARRAY['prompt_action'],          1.1, 0.05, 250800000,  300000000,  'NDPA 2023 s48: 2% of NGN 12B',                     'pending',   NOW() - INTERVAL '10 days', NOW()),
  (12, 'Dangote Cement',        'dsar_non_compliance', '2026-03-05', 180000000000,3600000000, ARRAY['repeat_offender','obstruction'],ARRAY[]::text[],                 1.3, 0.00, 4680000000, 4500000000, 'NDPA 2023 s48: 2.5% of NGN 180B (repeat offender)','draft',     NOW() - INTERVAL '5 days',  NOW()),
  (16, 'Paystack',              'data_retention',      '2026-03-10', 18000000000, 360000000,  ARRAY[]::text[],                      ARRAY['cooperation','prompt_action'], 1.0, 0.10, 324000000,  450000000,  'NDPA 2023 s48: 2% of NGN 18B',                     'draft',     NOW() - INTERVAL '2 days',  NOW())
ON CONFLICT DO NOTHING;

-- ── 5. Public Compliance Registry ─────────────────────────────────────────────
INSERT INTO public_compliance_registry (org_id, org_name, registration_number, sector, compliance_status, compliance_score, last_assessment_date, certificate_number, certificate_expiry, is_published, published_at, created_at, updated_at)
VALUES
  (9,  '9mobile',               'RC-9MOBILE-2024',   'telecom',      'partially_compliant', 62, '2025-11-01', 'NDPC-CERT-9MOB-2025', '2026-11-01', true,  NOW() - INTERVAL '30 days', NOW() - INTERVAL '60 days', NOW()),
  (10, 'LUTH',                  'RC-LUTH-2024',      'healthcare',   'compliant',           78, '2025-12-01', 'NDPC-CERT-LUTH-2025', '2026-12-01', true,  NOW() - INTERVAL '25 days', NOW() - INTERVAL '50 days', NOW()),
  (11, 'NNPC Limited',          'RC-NNPC-2024',      'energy',       'non_compliant',       41, '2025-10-01', NULL,                  NULL,         true,  NOW() - INTERVAL '20 days', NOW() - INTERVAL '40 days', NOW()),
  (15, 'Flutterwave',           'RC-FLUTTER-2024',   'fintech',      'compliant',           88, '2026-01-01', 'NDPC-CERT-FLUT-2026', '2027-01-01', true,  NOW() - INTERVAL '15 days', NOW() - INTERVAL '30 days', NOW()),
  (16, 'Paystack',              'RC-PAYSTACK-2024',  'fintech',      'compliant',           91, '2026-01-15', 'NDPC-CERT-PAYS-2026', '2027-01-15', true,  NOW() - INTERVAL '10 days', NOW() - INTERVAL '20 days', NOW()),
  (17, 'Kuda Bank',             'RC-KUDA-2024',      'fintech',      'partially_compliant', 71, '2025-12-15', 'NDPC-CERT-KUDA-2025', '2026-12-15', false, NULL,                       NOW() - INTERVAL '5 days',  NOW()),
  (13, 'AXA Mansard Insurance', 'RC-AXA-2024',       'insurance',    'compliant',           83, '2025-11-15', 'NDPC-CERT-AXA-2025',  '2026-11-15', true,  NOW() - INTERVAL '8 days',  NOW() - INTERVAL '15 days', NOW()),
  (14, 'Leadway Assurance',     'RC-LEADWAY-2024',   'insurance',    'partially_compliant', 68, '2025-10-15', 'NDPC-CERT-LEAD-2025', '2026-10-15', false, NULL,                       NOW() - INTERVAL '3 days',  NOW()),
  (12, 'Dangote Cement',        'RC-DANGOTE-2024',   'manufacturing','non_compliant',       38, '2025-09-01', NULL,                  NULL,         false, NULL,                       NOW() - INTERVAL '2 days',  NOW()),
  (8,  'Glo Mobile',            'RC-GLO-2024',       'telecom',      'partially_compliant', 59, '2025-10-01', 'NDPC-CERT-GLO-2025',  '2026-10-01', true,  NOW() - INTERVAL '12 days', NOW() - INTERVAL '25 days', NOW())
ON CONFLICT DO NOTHING;

-- ── 6. Risk Scorecard Entries ─────────────────────────────────────────────────
INSERT INTO risk_scorecard_entries (org_id, risk_category, risk_name, likelihood, impact, risk_level, owner, mitigation_plan, review_date, status, created_at, updated_at)
VALUES
  (9,  'data_security',    'Unencrypted Customer PII in Transit',        4, 5, 'critical', 'CISO',        'Implement TLS 1.3 on all internal APIs by Q2 2026',               '2026-06-01', 'open',        NOW() - INTERVAL '30 days', NOW()),
  (10, 'access_control',   'Excessive Privileged Access to EHR Systems', 3, 5, 'critical', 'IT Director', 'Implement PAM solution and quarterly access reviews',              '2026-05-01', 'in_progress', NOW() - INTERVAL '25 days', NOW()),
  (11, 'data_retention',   'Indefinite Retention of Contractor Data',    4, 3, 'high',     'DPO',         'Implement automated data retention schedules per NDPA s26',        '2026-04-15', 'open',        NOW() - INTERVAL '20 days', NOW()),
  (15, 'third_party',      'Inadequate Vendor DPA Coverage',             3, 4, 'high',     'Legal',       'Audit all 47 vendors and execute NDPAs by Q3 2026',                '2026-07-01', 'in_progress', NOW() - INTERVAL '18 days', NOW()),
  (16, 'consent',          'Consent Records Not Linked to Processing',   2, 4, 'high',     'DPO',         'Implement consent management platform integration',                '2026-05-15', 'open',        NOW() - INTERVAL '15 days', NOW()),
  (17, 'breach_response',  'No Tested Incident Response Plan',           3, 5, 'critical', 'CISO',        'Develop and test IRP with NDPC notification workflow by Q2 2026',  '2026-06-30', 'open',        NOW() - INTERVAL '12 days', NOW()),
  (13, 'cross_border',     'SCCs Not Updated for Schrems II',            2, 4, 'high',     'Legal',       'Update all SCCs to 2021 EU standard clauses',                      '2026-04-30', 'mitigated',   NOW() - INTERVAL '10 days', NOW()),
  (14, 'data_quality',     'Inaccurate Customer Data in Core System',    3, 3, 'medium',   'Operations',  'Implement data quality validation rules and annual cleanse',        '2026-08-01', 'open',        NOW() - INTERVAL '8 days',  NOW()),
  (12, 'physical_security','Unsecured Data Centre Access Logs',          2, 3, 'medium',   'Facilities',  'Install biometric access controls and CCTV in server rooms',        '2026-09-01', 'open',        NOW() - INTERVAL '5 days',  NOW()),
  (9,  'employee_training','Low NDPA Awareness Among Staff',             4, 2, 'medium',   'HR',          'Mandatory NDPA training for all 2,400 employees by Q2 2026',        '2026-06-30', 'in_progress', NOW() - INTERVAL '3 days',  NOW()),
  (11, 'data_mapping',     'Incomplete Data Processing Register',        3, 4, 'high',     'DPO',         'Complete Article 30 register for all 156 processing activities',    '2026-05-31', 'open',        NOW() - INTERVAL '2 days',  NOW()),
  (10, 'dpia',             'DPIA Not Conducted for New AI Diagnostics',  3, 5, 'critical', 'DPO',         'Conduct DPIA before AI system goes live in May 2026',               '2026-04-30', 'open',        NOW() - INTERVAL '1 day',   NOW())
ON CONFLICT DO NOTHING;

-- ── 7. Data Residency Locations ───────────────────────────────────────────────
INSERT INTO data_residency_locations (org_id, data_category, storage_country, storage_region, provider_name, provider_type, latitude, longitude, transfer_mechanism, volume_gb, adequacy_decision, created_at, updated_at)
VALUES
  (9,  'customer_data',    'NG', 'Lagos',         'AWS Lagos (af-south-1)',     'cloud',      6.5244,  3.3792,  'local_storage',                15000, true,  NOW() - INTERVAL '90 days', NOW()),
  (10, 'health_records',   'NG', 'Abuja',         'Azure Nigeria (on-premise)', 'on_premise', 9.0765,  7.3986,  'local_storage',                8500,  true,  NOW() - INTERVAL '80 days', NOW()),
  (11, 'operational_data', 'NG', 'Port Harcourt', 'NNPC Private Cloud',         'private',    4.8156,  7.0498,  'local_storage',                45000, true,  NOW() - INTERVAL '70 days', NOW()),
  (15, 'transaction_data', 'NG', 'Lagos',         'AWS Lagos (af-south-1)',     'cloud',      6.5244,  3.3792,  'local_storage',                25000, true,  NOW() - INTERVAL '60 days', NOW()),
  (15, 'backup_data',      'US', 'us-east-1',     'AWS US East',                'cloud',      37.0902,-95.7129, 'standard_contractual_clauses', 5000,  false, NOW() - INTERVAL '55 days', NOW()),
  (16, 'payment_data',     'NG', 'Lagos',         'Google Cloud Lagos',          'cloud',      6.5244,  3.3792,  'local_storage',                18000, true,  NOW() - INTERVAL '50 days', NOW()),
  (13, 'policy_data',      'NG', 'Lagos',         'Azure Nigeria',               'cloud',      6.5244,  3.3792,  'local_storage',                3200,  true,  NOW() - INTERVAL '40 days', NOW()),
  (13, 'reinsurance_data', 'DE', 'Frankfurt',     'Munich Re Data Centre',       'third_party',50.1109, 8.6821,  'standard_contractual_clauses', 800,   false, NOW() - INTERVAL '35 days', NOW()),
  (14, 'claims_data',      'NG', 'Lagos',         'Leadway Private Cloud',       'private',    6.5244,  3.3792,  'local_storage',                4500,  true,  NOW() - INTERVAL '30 days', NOW()),
  (14, 'archive_data',     'BY', 'Minsk',         'Belarusian Data Centre',      'third_party',53.9045,27.5615, 'none',                         200,   false, NOW() - INTERVAL '25 days', NOW()),
  (17, 'banking_data',     'NG', 'Lagos',         'AWS Lagos (af-south-1)',     'cloud',      6.5244,  3.3792,  'local_storage',                6000,  true,  NOW() - INTERVAL '20 days', NOW()),
  (12, 'employee_data',    'NG', 'Lagos',         'Dangote IT Centre',           'on_premise', 6.5244,  3.3792,  'local_storage',                2200,  true,  NOW() - INTERVAL '15 days', NOW())
ON CONFLICT DO NOTHING;

-- ── 8. Bulk DSAR Jobs ─────────────────────────────────────────────────────────
INSERT INTO bulk_dsar_jobs (org_id, job_name, job_type, total_subjects, processed_count, status, created_by, started_at, completed_at, created_at, updated_at)
VALUES
  (9,  'Q4 2025 Access Request Batch',          'data_export',        2400, 2400, 'completed',   1, NOW() - INTERVAL '45 days', NOW() - INTERVAL '44 days', NOW() - INTERVAL '45 days', NOW()),
  (10, 'Patient Records Erasure - Discharged',  'erasure',            850,  850,  'completed',   1, NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days', NOW() - INTERVAL '30 days', NOW()),
  (15, 'Merchant Data Portability Q1 2026',     'portability',        320,  320,  'completed',   1, NOW() - INTERVAL '20 days', NOW() - INTERVAL '19 days', NOW() - INTERVAL '20 days', NOW()),
  (16, 'Inactive Customer Consent Withdrawal',  'consent_withdrawal', 1200, 600,  'in_progress', 1, NOW() - INTERVAL '5 days',  NULL,                       NOW() - INTERVAL '5 days',  NOW()),
  (11, 'Employee Data Rectification Batch',     'rectification',      450,  0,    'pending',     1, NULL,                       NULL,                       NOW() - INTERVAL '2 days',  NOW()),
  (13, 'Insurance Policy Data Export',          'data_export',        180,  0,    'pending',     1, NULL,                       NULL,                       NOW() - INTERVAL '1 day',   NOW()),
  (17, 'Kuda Customer Access Requests',         'data_export',        950,  950,  'completed',   1, NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days', NOW() - INTERVAL '15 days', NOW()),
  (12, 'Dangote Employee Data Export',          'data_export',        3200, 0,    'cancelled',   1, NULL,                       NULL,                       NOW() - INTERVAL '10 days', NOW())
ON CONFLICT DO NOTHING;

-- ── 9. Whistleblower Cases ────────────────────────────────────────────────────
INSERT INTO whistleblower_cases (case_reference, org_id, org_name, category, severity, description, status, assigned_to, investigation_notes, resolution, is_anonymous, opened_at, closed_at, created_at, updated_at)
VALUES
  ('WB-2026-0001', 9,  '9mobile',              'data_breach',         'critical', 'Suspected unauthorised export of 50,000 customer records to external storage device by IT contractor.',                          'under_investigation', 'Aisha Mohammed (Lead Investigator)', 'CCTV footage reviewed. Contractor access logs obtained. Forensic analysis in progress.', NULL, true,  NOW() - INTERVAL '45 days', NULL, NOW() - INTERVAL '45 days', NOW()),
  ('WB-2026-0002', 10, 'LUTH',                 'consent_violation',   'high',     'Medical staff accessing patient records without clinical justification. Approximately 200 records accessed inappropriately.',     'resolved',            'Dr. Emeka Eze (DPO)',                 'Investigation confirmed 12 staff members accessed records without authorisation. Disciplinary action taken.', 'Staff disciplined, access controls tightened, mandatory training implemented.', false, NOW() - INTERVAL '40 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '40 days', NOW()),
  ('WB-2026-0003', 11, 'NNPC Limited',         'third_party_misuse',  'high',     'Vendor (TechServ Ltd) allegedly sharing NNPC employee data with third parties without DPA in place.',                            'under_investigation', 'Fatima Al-Hassan (DPO)',              'Vendor contract reviewed. DPA not executed. Vendor placed on suspension pending investigation.', NULL, true,  NOW() - INTERVAL '35 days', NULL, NOW() - INTERVAL '35 days', NOW()),
  ('WB-2026-0004', 15, 'Flutterwave',          'security_incident',   'medium',   'Weak password policy allowing dictionary attacks on merchant portal. Multiple failed login attempts observed.',                   'resolved',            'Chukwuemeka Obi (DPO)',               'Security audit conducted. Password policy updated to enforce 12-char minimum with MFA.', 'MFA enforced for all merchant accounts. Security awareness training completed.', false, NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 days',  NOW() - INTERVAL '30 days', NOW()),
  ('WB-2026-0005', 16, 'Paystack',             'data_retention',      'medium',   'Customer transaction data being retained beyond the 7-year statutory limit. Estimated 500,000 records affected.',                'new',                 NULL,                                  NULL, NULL, true,  NOW() - INTERVAL '15 days', NULL, NOW() - INTERVAL '15 days', NOW()),
  ('WB-2026-0006', 17, 'Kuda Bank',            'consent_violation',   'high',     'Marketing team sending promotional emails to customers who have opted out. Approximately 8,000 customers affected.',              'under_investigation', 'Babatunde Lawal (DPO)',               'Email marketing platform audit initiated. Opt-out list reconciliation in progress.', NULL, false, NOW() - INTERVAL '10 days', NULL, NOW() - INTERVAL '10 days', NOW()),
  ('WB-2026-0007', 13, 'AXA Mansard Insurance','access_control',      'critical', 'Shared administrator credentials used across 5 insurance systems. Credentials found in plaintext in shared drive.',               'escalated',           'Amaka Nwosu (DPO)',                   'NDPC notified. Credentials immediately rotated. Full security audit commissioned.', NULL, true,  NOW() - INTERVAL '7 days',  NULL, NOW() - INTERVAL '7 days',  NOW()),
  ('WB-2026-0008', 12, 'Dangote Cement',       'dsar_non_compliance', 'medium',   'DSAR requests from 45 employees not responded to within the 30-day NDPA deadline. Some requests over 90 days old.',              'new',                 NULL,                                  NULL, NULL, false, NOW() - INTERVAL '3 days',  NULL, NOW() - INTERVAL '3 days',  NOW())
ON CONFLICT DO NOTHING;

-- ── 10. Cross-Border Transfers ────────────────────────────────────────────────
INSERT INTO cross_border_transfers (org_id, org_name, destination_country, data_category, transfer_mechanism, volume_records, safeguards, risk_level, nitda_notified, status, created_at, updated_at)
VALUES
  (15, 'Flutterwave',           'US', 'payment_data',     'standard_contractual_clauses', 250000, 'SCCs executed, DPA in place, encryption in transit and at rest', 'medium',   true,  'active',                NOW() - INTERVAL '90 days', NOW()),
  (15, 'Flutterwave',           'GB', 'merchant_data',    'standard_contractual_clauses', 85000,  'SCCs executed, UK IDTA addendum signed',                         'medium',   true,  'active',                NOW() - INTERVAL '80 days', NOW()),
  (16, 'Paystack',              'US', 'transaction_data', 'standard_contractual_clauses', 180000, 'SCCs executed, annual security assessment required',             'medium',   true,  'active',                NOW() - INTERVAL '70 days', NOW()),
  (9,  '9mobile',               'US', 'subscriber_data',  'standard_contractual_clauses', 45000,  'SCCs executed, NCC approval obtained',                           'medium',   false, 'pending_notification',  NOW() - INTERVAL '60 days', NOW()),
  (11, 'NNPC Limited',          'US', 'operational_data', 'standard_contractual_clauses', 12000,  'SCCs executed, NITDA notification pending',                      'medium',   false, 'pending_notification',  NOW() - INTERVAL '50 days', NOW()),
  (11, 'NNPC Limited',          'CN', 'exploration_data', 'none',                         8000,   'No formal transfer mechanism in place',                          'critical', false, 'pending_notification',  NOW() - INTERVAL '45 days', NOW()),
  (13, 'AXA Mansard Insurance', 'DE', 'reinsurance_data', 'standard_contractual_clauses', 5000,   'SCCs executed, Munich Re DPA signed',                            'medium',   true,  'active',                NOW() - INTERVAL '40 days', NOW()),
  (14, 'Leadway Assurance',     'BY', 'archive_data',     'none',                         2000,   'No transfer mechanism. Data transferred without NITDA notification','critical',false,'suspended',             NOW() - INTERVAL '35 days', NOW()),
  (17, 'Kuda Bank',             'US', 'banking_data',     'standard_contractual_clauses', 35000,  'SCCs executed, CBN approval obtained',                           'medium',   true,  'active',                NOW() - INTERVAL '30 days', NOW()),
  (10, 'LUTH',                  'US', 'research_data',    'standard_contractual_clauses', 3000,   'Anonymised data only. SCCs executed for residual identifiers',   'low',      true,  'active',                NOW() - INTERVAL '20 days', NOW()),
  (12, 'Dangote Cement',        'RU', 'procurement_data', 'none',                         1500,   'No transfer mechanism. Emergency procurement transfer',          'critical', false, 'suspended',             NOW() - INTERVAL '15 days', NOW()),
  (8,  'Glo Mobile',            'US', 'roaming_data',     'standard_contractual_clauses', 28000,  'SCCs executed, NCC approval obtained',                           'medium',   true,  'active',                NOW() - INTERVAL '10 days', NOW())
ON CONFLICT DO NOTHING;

-- ── 11. Regulatory Reports ────────────────────────────────────────────────────
INSERT INTO regulatory_reports (report_name, report_type, reporting_period_start, reporting_period_end, org_id, status, generated_by, submitted_to, submission_date, data_snapshot, created_at, updated_at)
VALUES
  ('Q3 2025 National Compliance Report',       'quarterly_national',  '2025-07-01', '2025-09-30', NULL, 'submitted', 'NDPC Admin',      'NDPC',  '2025-10-15', '{"total_orgs":150,"breaches":8,"dsars":342,"fines":2450000000}',         NOW() - INTERVAL '180 days', NOW()),
  ('Q4 2025 National Compliance Report',       'quarterly_national',  '2025-10-01', '2025-12-31', NULL, 'submitted', 'NDPC Admin',      'NDPC',  '2026-01-15', '{"total_orgs":155,"breaches":12,"dsars":418,"fines":3200000000}',        NOW() - INTERVAL '90 days',  NOW()),
  ('2025 Annual Breach Notification Summary',  'annual_breach',       '2025-01-01', '2025-12-31', NULL, 'submitted', 'NDPC Admin',      'NDPC',  '2026-02-01', '{"total_breaches":35,"notified_on_time":28,"late_notifications":7}',     NOW() - INTERVAL '80 days',  NOW()),
  ('2025 Cross-Border Transfer Annual Report', 'cross_border_annual', '2025-01-01', '2025-12-31', NULL, 'submitted', 'NDPC Admin',      'NITDA', '2026-02-15', '{"total_transfers":248,"high_risk":12,"critical":4}',                    NOW() - INTERVAL '70 days',  NOW()),
  ('Q1 2026 Finance Sector Benchmark',         'sector_benchmark',    '2026-01-01', '2026-03-31', NULL, 'submitted', 'NDPC Admin',      'CBN',   '2026-04-10', '{"sector":"finance","avg_score":74.2,"compliant":18,"non_compliant":4}', NOW() - INTERVAL '11 days',  NOW()),
  ('Q1 2026 DSAR Summary Report',              'dsar_summary',        '2026-01-01', '2026-03-31', NULL, 'submitted', 'NDPC Admin',      'NDPC',  '2026-04-05', '{"total_dsars":156,"completed_on_time":142,"overdue":14}',               NOW() - INTERVAL '16 days',  NOW()),
  ('Q1 2026 Enforcement Actions Summary',      'enforcement_summary', '2026-01-01', '2026-03-31', NULL, 'draft',     'NDPC Admin',      NULL,    NULL,         '{"total_actions":23,"penalties_issued":8,"total_fines":4200000000}',     NOW() - INTERVAL '5 days',   NOW()),
  ('Q1 2026 National Compliance Report',       'quarterly_national',  '2026-01-01', '2026-03-31', NULL, 'draft',     'NDPC Admin',      NULL,    NULL,         '{"total_orgs":158,"breaches":5,"dsars":189,"fines":1800000000}',         NOW() - INTERVAL '3 days',   NOW()),
  ('9mobile Q1 2026 Compliance Report',        'sector_benchmark',    '2026-01-01', '2026-03-31', 9,   'submitted', 'Adaeze Okonkwo',  'NDPC',  '2026-04-12', '{"org":"9mobile","score":62,"violations":3}',                            NOW() - INTERVAL '9 days',   NOW()),
  ('Flutterwave Annual Privacy Report 2025',   'annual_breach',       '2025-01-01', '2025-12-31', 15,  'submitted', 'Chukwuemeka Obi', 'NDPC',  '2026-02-28', '{"org":"Flutterwave","breaches":2,"dsars":1240}',                        NOW() - INTERVAL '52 days',  NOW())
ON CONFLICT DO NOTHING;

-- ── 12. API Rate Limit Stats ──────────────────────────────────────────────────
INSERT INTO api_rate_limit_stats (endpoint, client_ip, requests_count, blocked_count, window_start, window_end, created_at)
VALUES
  ('/api/trpc/organizations.list',              '10.0.0.1',      450,  0,   NOW() - INTERVAL '23 hours', NOW() - INTERVAL '22 hours', NOW() - INTERVAL '23 hours'),
  ('/api/trpc/compliance.getViolations',        '10.0.0.2',      320,  2,   NOW() - INTERVAL '22 hours', NOW() - INTERVAL '21 hours', NOW() - INTERVAL '22 hours'),
  ('/api/trpc/siem.getAlerts',                  '10.0.0.3',      280,  0,   NOW() - INTERVAL '21 hours', NOW() - INTERVAL '20 hours', NOW() - INTERVAL '21 hours'),
  ('/api/trpc/network.getEvents',               '10.0.0.4',      210,  5,   NOW() - INTERVAL '20 hours', NOW() - INTERVAL '19 hours', NOW() - INTERVAL '20 hours'),
  ('/api/trpc/financial.getPenalties',          '10.0.0.5',      180,  0,   NOW() - INTERVAL '19 hours', NOW() - INTERVAL '18 hours', NOW() - INTERVAL '19 hours'),
  ('/api/trpc/phase13.consentRecords.list',     '10.0.0.1',      95,   0,   NOW() - INTERVAL '18 hours', NOW() - INTERVAL '17 hours', NOW() - INTERVAL '18 hours'),
  ('/api/trpc/phase13.dpoRegistry.list',        '10.0.0.2',      78,   0,   NOW() - INTERVAL '17 hours', NOW() - INTERVAL '16 hours', NOW() - INTERVAL '17 hours'),
  ('/api/trpc/phase13.riskScorecard.list',      '10.0.0.3',      65,   0,   NOW() - INTERVAL '16 hours', NOW() - INTERVAL '15 hours', NOW() - INTERVAL '16 hours'),
  ('/api/trpc/organizations.list',              '192.168.1.100', 1200, 850, NOW() - INTERVAL '6 hours',  NOW() - INTERVAL '5 hours',  NOW() - INTERVAL '6 hours'),
  ('/api/trpc/compliance.getViolations',        '192.168.1.101', 980,  620, NOW() - INTERVAL '5 hours',  NOW() - INTERVAL '4 hours',  NOW() - INTERVAL '5 hours'),
  ('/api/trpc/siem.getAlerts',                  '10.0.0.1',      350,  0,   NOW() - INTERVAL '4 hours',  NOW() - INTERVAL '3 hours',  NOW() - INTERVAL '4 hours'),
  ('/api/trpc/phase13.whistleblowerCases.list', '10.0.0.2',      42,   0,   NOW() - INTERVAL '3 hours',  NOW() - INTERVAL '2 hours',  NOW() - INTERVAL '3 hours'),
  ('/api/trpc/phase13.regulatoryReporting.list','10.0.0.3',      38,   0,   NOW() - INTERVAL '2 hours',  NOW() - INTERVAL '1 hour',   NOW() - INTERVAL '2 hours'),
  ('/api/trpc/organizations.list',              '10.0.0.4',      520,  0,   NOW() - INTERVAL '1 hour',   NOW(),                       NOW() - INTERVAL '1 hour'),
  ('/api/trpc/phase13.crossBorderMonitor.list', '10.0.0.5',      55,   0,   NOW() - INTERVAL '30 minutes',NOW(),                      NOW() - INTERVAL '30 minutes')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify seed counts
SELECT 'consent_records_v2' as tbl, COUNT(*) FROM consent_records_v2
UNION ALL SELECT 'dpo_appointments', COUNT(*) FROM dpo_appointments
UNION ALL SELECT 'notification_inbox', COUNT(*) FROM notification_inbox
UNION ALL SELECT 'penalty_calculations', COUNT(*) FROM penalty_calculations
UNION ALL SELECT 'public_compliance_registry', COUNT(*) FROM public_compliance_registry
UNION ALL SELECT 'risk_scorecard_entries', COUNT(*) FROM risk_scorecard_entries
UNION ALL SELECT 'data_residency_locations', COUNT(*) FROM data_residency_locations
UNION ALL SELECT 'bulk_dsar_jobs', COUNT(*) FROM bulk_dsar_jobs
UNION ALL SELECT 'whistleblower_cases', COUNT(*) FROM whistleblower_cases
UNION ALL SELECT 'cross_border_transfers', COUNT(*) FROM cross_border_transfers
UNION ALL SELECT 'regulatory_reports', COUNT(*) FROM regulatory_reports
UNION ALL SELECT 'api_rate_limit_stats', COUNT(*) FROM api_rate_limit_stats;
