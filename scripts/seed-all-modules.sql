-- NDSEP Full Module Seed Data (Schema-Correct)
-- Seeds ALL 47 tables with realistic Nigerian data protection scenario data
-- Run: psql $DATABASE_URL < scripts/seed-all-modules.sql
-- Uses individual transactions per section so one failure does not block others.

-- ══════════════════════════════════════════════════════════════════════════════
-- SECTORS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO sectors (name, code, description, regulatory_framework, org_count) VALUES
  ('Banking & Finance', 'BNK', 'Commercial banks, microfinance, insurance', 'CBN Prudential Guidelines + NDPA 2023', 45),
  ('Telecommunications', 'TEL', 'Mobile operators, ISPs, tower companies', 'NCC Consumer Code + NDPA 2023', 12),
  ('Oil & Gas', 'ONG', 'Upstream, midstream, downstream petroleum', 'DPR/NUPRC Regulations + NDPA 2023', 30),
  ('Healthcare', 'HCR', 'Hospitals, HMOs, pharmaceutical companies', 'NHIA Act + NDPA 2023 (sensitive data)', 25),
  ('E-Commerce & Technology', 'ECT', 'Online retail, SaaS, fintech platforms', 'NITDA Guidelines + NDPA 2023', 60),
  ('Education', 'EDU', 'Universities, ed-tech, vocational training', 'NUC/NBTE Guidelines + NDPA 2023', 18),
  ('Insurance', 'INS', 'Life, general, reinsurance companies', 'NAICOM Guidelines + NDPA 2023', 22),
  ('Government & Public Sector', 'GOV', 'MDAs, state agencies, parastatals', 'FoI Act + NDPA 2023', 35),
  ('Maritime & Transport', 'MAR', 'Shipping, ports, logistics companies', 'NPA Regulations + NDPA 2023', 15),
  ('Energy & Power', 'ENR', 'GenCos, DisCos, renewable energy', 'NERC Regulations + NDPA 2023', 20),
  ('Agriculture', 'AGR', 'Agri-tech, farming cooperatives, exports', 'FMARD Guidelines + NDPA 2023', 10),
  ('Real Estate', 'RES', 'Property development, proptech, REITs', 'SEC Guidelines + NDPA 2023', 8)
ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- AI SYSTEMS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_systems (name, organization_id, vendor, version, purpose, risk_level, status, training_data_description, personal_data_processed, cross_border_transfer)
SELECT ais.name, o.id, ais.vendor, ais.version, ais.purpose, ais.risk_level::ai_risk_level, ais.status::ai_system_status, ais.training_desc, ais.pii, ais.xborder
FROM (VALUES
  ('Fraud Detection Engine', 'Zenith Bank Plc', 'In-house', '3.2', 'Real-time transaction fraud scoring using ML', 'high', 'approved', 'Historical transaction data (10M+ records) including account patterns', true, false),
  ('Credit Scoring AI', 'Access Bank Plc', 'Experian NG', '2.1', 'Automated credit risk assessment for loan applications', 'high', 'approved', 'BVN-linked credit history, income declarations, repayment patterns', true, true),
  ('Customer Churn Predictor', 'MTN Nigeria Communications Plc', 'Huawei', '1.5', 'Predicting subscriber churn probability for retention campaigns', 'limited', 'under_review', 'Call records, data usage, payment history', true, true),
  ('KYC Document Verifier', 'Flutterwave Inc', 'Smile Identity', '4.0', 'Automated ID document verification and liveness check', 'high', 'approved', 'Government ID images, selfie captures, NIN database lookups', true, false),
  ('Supply Chain Optimizer', 'Dangote Industries Ltd', 'SAP AI', '2.0', 'Logistics and supply chain demand forecasting', 'minimal', 'registered', 'Shipping manifests, production schedules, weather data', false, false),
  ('Network Anomaly Detector', 'Globacom Ltd', 'Nokia NetGuard', '3.1', 'Detecting network intrusions and DDoS patterns', 'limited', 'approved', 'Network traffic logs, BGP routes, DNS queries', false, false),
  ('Sentiment Analyzer', 'Paystack', 'OpenAI', '4.0', 'Analyzing customer support tickets for sentiment and priority', 'limited', 'approved', 'Support ticket text, customer feedback forms', true, false)
) AS ais(name, org_name, vendor, version, purpose, risk_level, status, training_desc, pii, xborder)
JOIN organizations o ON o.name = ais.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- BGP ROUTES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO bgp_routes (prefix, origin_asn, peer_asn, as_path, next_hop, rpki_status, is_hijacked, is_leaked, is_cross_border, ixp_site, community_tags) VALUES
  ('41.58.0.0/16', 29465, 37282, '37282 29465', '196.216.2.1', 'valid', false, false, false, 'IXPN Lagos', ARRAY['29465:100','29465:200']),
  ('154.120.0.0/13', 36873, 37282, '37282 36873', '196.216.2.5', 'valid', false, false, false, 'IXPN Lagos', ARRAY['36873:100']),
  ('102.89.0.0/16', 37148, 37282, '37282 37148', '196.216.2.10', 'valid', false, false, true, 'IXPN Abuja', ARRAY['37148:300']),
  ('197.210.0.0/16', 29465, 6453, '6453 29465', '154.54.12.1', 'invalid', true, false, true, 'AMS-IX', ARRAY['29465:999']),
  ('41.190.0.0/15', 36877, 37282, '37282 36877', '196.216.2.15', 'valid', false, false, false, 'IXPN Lagos', ARRAY['36877:200']),
  ('105.112.0.0/12', 36873, 174, '174 36873', '154.54.56.1', 'valid', false, true, true, 'LINX London', ARRAY['36873:500']),
  ('160.152.0.0/16', 37705, 37282, '37282 37705', '196.216.2.20', 'valid', false, false, false, 'IXPN Lagos', ARRAY['37705:100']),
  ('196.46.0.0/16', 36923, 6939, '6939 36923', '196.216.2.25', 'unknown', false, false, true, 'NAPAfrica', ARRAY['36923:400'])
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- CITIZEN REQUESTS (DSAR)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO citizen_requests (organization_id, request_type, status, citizen_name, citizen_email, citizen_nin, description, submitted_at, updated_at)
SELECT o.id, cr.request_type::citizen_request_type, cr.status::citizen_request_status, cr.cname, cr.email, cr.nin, cr.description, cr.submitted_at::timestamp, cr.updated_at::timestamp
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'access', 'completed', 'Adebayo Ogunlesi', 'adebayo.o@gmail.com', 'NIN-12345678901', 'Request for copy of all personal data held including call records and location data', '2025-08-01', '2025-08-15'),
  ('First Bank of Nigeria Plc', 'erasure', 'in_progress', 'Chidinma Eze', 'chidinma.eze@yahoo.com', 'NIN-23456789012', 'Request to delete all account data following account closure', '2025-09-10', '2025-09-20'),
  ('Jumia Technologies AG', 'rectification', 'completed', 'Mohammed Ibrahim', 'mibrahim@outlook.com', 'NIN-34567890123', 'Incorrect delivery address and phone number stored', '2025-07-05', '2025-07-08'),
  ('Zenith Bank Plc', 'access', 'in_progress', 'Ngozi Okafor', 'ngozi.okafor@gmail.com', 'NIN-45678901234', 'Request for all transaction records and third-party data sharing logs', '2025-10-01', '2025-10-10'),
  ('Flutterwave Inc', 'portability', 'submitted', 'Emeka Nwosu', 'emeka.nwosu@hotmail.com', 'NIN-56789012345', 'Request to export payment history in machine-readable format', '2025-11-01', '2025-11-01'),
  ('Dangote Industries Ltd', 'objection', 'submitted', 'Aisha Abdullahi', 'aisha.abd@gmail.com', 'NIN-67890123456', 'Objection to processing of biometric data for attendance tracking', '2025-11-15', '2025-11-15'),
  ('Paystack', 'access', 'completed', 'Oluwafemi Adeoye', 'femi.adeoye@gmail.com', 'NIN-78901234567', 'Request for data shared with third-party merchants', '2025-06-20', '2025-07-01'),
  ('Interswitch Group', 'erasure', 'rejected', 'Blessing Obi', 'blessing.obi@yahoo.com', 'NIN-89012345678', 'Erasure rejected — retention required under CBN AML regulations', '2025-05-10', '2025-05-25')
) AS cr(org_name, request_type, status, cname, email, nin, description, submitted_at, updated_at)
JOIN organizations o ON o.name = cr.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- CONFIG SNAPSHOTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO config_snapshots (organization_id, snapshot_type, config, changed_by, change_reason, created_at)
SELECT o.id, cs.snapshot_type, cs.config::jsonb, cs.changed_by, cs.reason, cs.created_at::timestamp
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'security', '{"firewallRules":45,"encryptionAtRest":true,"mfaEnabled":true,"ssoProvider":"Okta","lastPenTest":"2025-05-15"}', 'CISO Team', 'Quarterly security config review', '2025-06-01'),
  ('First Bank of Nigeria Plc', 'compliance', '{"ndpaCompliant":true,"dpoAppointed":true,"dpiaCompleted":false,"consentMechanism":"opt-in","retentionPolicy":"7years"}', 'DPO Office', 'Annual compliance assessment', '2025-07-01'),
  ('Zenith Bank Plc', 'infrastructure', '{"cloudProvider":"AWS","region":"af-south-1","backupFrequency":"hourly","drSite":"Abuja","rpo":"1h","rto":"4h"}', 'IT Operations', 'DR configuration update', '2025-08-15'),
  ('Flutterwave Inc', 'security', '{"wafEnabled":true,"ddosProtection":"Cloudflare","apiRateLimit":1000,"tokenRotation":"24h","logRetention":"90days"}', 'Security Team', 'Post-incident security hardening', '2025-09-01')
) AS cs(org_name, snapshot_type, config, changed_by, reason, created_at)
JOIN organizations o ON o.name = cs.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO ORGANISATIONS (Data Protection Compliance Organizations)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_organisations (name, licence_number, status, tier, email, phone, address, cac_number, dpo_name, dpo_email, services, sectors, website) VALUES
  ('Olaniwun Ajayi LP', 'DPCO-001-2024', 'active', 'enterprise', 'dpco@olaniwunajayi.com', '+234-1-461-0091', '2 Theophilus Orji St, Lekki, Lagos', 'RC-12345', 'Yemisi Ogundipe', 'yemisi@olaniwunajayi.com', ARRAY['audit','advisory','training','dpia','certification'], ARRAY['Banking & Finance','Telecommunications'], 'https://olaniwunajayi.com'),
  ('Pavestones Legal', 'DPCO-002-2024', 'active', 'professional', 'privacy@pavestones.com', '+234-1-453-0200', '14 Adeola Odeku St, VI, Lagos', 'RC-23456', 'Lolade Ososami', 'lolade@pavestones.com', ARRAY['audit','advisory','gap_assessment'], ARRAY['E-Commerce & Technology','Fintech'], 'https://pavestones.com'),
  ('Templars Law', 'DPCO-003-2024', 'active', 'enterprise', 'dataprotection@templars-law.com', '+234-1-461-5500', '5B Alhaji Masha Rd, Surulere, Lagos', 'RC-34567', 'Ifeoma Ajunwa', 'ifeoma@templars-law.com', ARRAY['audit','advisory','training','dpia','gap_assessment','certification'], ARRAY['Oil & Gas','Healthcare','Government'], 'https://templars-law.com'),
  ('Data Privacy Nigeria', 'DPCO-004-2025', 'active', 'starter', 'hello@dataprivacyng.com', '+234-802-555-0100', '10 Wuse 2, Abuja', 'RC-45678', 'Chinedu Okeke', 'chinedu@dataprivacyng.com', ARRAY['training','advisory'], ARRAY['Education','Agriculture'], 'https://dataprivacyng.com'),
  ('Aluko & Oyebode', 'DPCO-005-2024', 'active', 'enterprise', 'compliance@aluko-oyebode.com', '+234-1-462-8360', '6th Floor, NNPC Towers, Abuja', 'RC-56789', 'Folake Elias-Adebowale', 'folake@aluko-oyebode.com', ARRAY['audit','advisory','dpia','certification','other'], ARRAY['Banking & Finance','Insurance','Energy'], 'https://aluko-oyebode.com')
ON CONFLICT (licence_number) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO CLIENTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, status, risk_level)
SELECT dorg.id, dc.org_name, dc.org_sector, dc.org_location, dc.contact_name, dc.email, dc.status::dpco_client_status, dc.risk_level::dpco_client_risk
FROM (VALUES
  ('Olaniwun Ajayi LP', 'Zenith Bank Plc', 'Banking', 'Lagos', 'Adaeze Nwankwo', 'adaeze@zenithbank.com', 'active', 'high'),
  ('Olaniwun Ajayi LP', 'MTN Nigeria Communications Plc', 'Telecommunications', 'Lagos', 'Tunde Bakare', 'tunde.b@mtn.ng', 'active', 'critical'),
  ('Pavestones Legal', 'Flutterwave Inc', 'Fintech', 'Lagos', 'Olu Adeyinka', 'olu@flutterwave.com', 'active', 'high'),
  ('Pavestones Legal', 'Paystack', 'Fintech', 'Lagos', 'Shola Akinlade', 'shola@paystack.com', 'active', 'medium'),
  ('Templars Law', 'NNPC Ltd', 'Oil & Gas', 'Abuja', 'Ibrahim Musa', 'ibrahim.m@nnpc.com', 'active', 'critical'),
  ('Templars Law', 'Lagos University Teaching Hospital', 'Healthcare', 'Lagos', 'Dr. Funke Adeboye', 'funke@luth.gov.ng', 'active', 'high'),
  ('Aluko & Oyebode', 'Access Bank Plc', 'Banking', 'Lagos', 'Kemi Olaleye', 'kemi@accessbankplc.com', 'active', 'high'),
  ('Aluko & Oyebode', 'Stanbic IBTC Holdings', 'Banking', 'Lagos', 'Paul Okonkwo', 'paul@stanbicibtc.com', 'active', 'medium')
) AS dc(dpco_name, org_name, org_sector, org_location, contact_name, email, status, risk_level)
JOIN dpco_organisations dorg ON dorg.name = dc.dpco_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO AUDIT ENGAGEMENTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, critical_findings, high_findings, medium_findings, low_findings, notes)
SELECT dorg.id, dc.id, ae.title, ae.stage::dpco_audit_stage, ae.score, ae.auditor, ae.p_start::timestamp, ae.p_end::timestamp, ae.crit, ae.high, ae.med, ae.low, ae.notes
FROM (VALUES
  ('Olaniwun Ajayi LP', 'Zenith Bank Plc', 'Annual NDPA Compliance Audit 2025', 'findings_review', 82, 'Yemisi Ogundipe', '2025-09-01', '2025-11-30', 1, 3, 5, 8, 'Cross-border transfer gaps identified'),
  ('Olaniwun Ajayi LP', 'MTN Nigeria Communications Plc', 'Post-Enforcement Remediation Audit', 'fieldwork', NULL, 'Yemisi Ogundipe', '2025-10-01', '2026-01-31', 0, 0, 0, 0, 'Following NDPC enforcement order on cross-border transfers'),
  ('Pavestones Legal', 'Flutterwave Inc', 'PCI-DSS + NDPA Integrated Audit', 'report_issued', 91, 'Lolade Ososami', '2025-06-01', '2025-08-31', 0, 1, 3, 4, 'Strong technical controls — minor consent improvements'),
  ('Templars Law', 'NNPC Ltd', 'Emergency Post-Breach Assessment', 'gap_assessment', NULL, 'Ifeoma Ajunwa', '2025-10-15', '2025-12-31', 0, 0, 0, 0, 'Triggered by ransomware and delayed notification'),
  ('Aluko & Oyebode', 'Access Bank Plc', 'NDPA Article 31 DPO Effectiveness Review', 'management_response', 78, 'Folake Elias-Adebowale', '2025-07-01', '2025-09-30', 0, 2, 4, 6, 'DPO independence concerns')
) AS ae(dpco_name, client_name, title, stage, score, auditor, p_start, p_end, crit, high, med, low, notes)
JOIN dpco_organisations dorg ON dorg.name = ae.dpco_name
JOIN dpco_clients dc ON dc.org_name = ae.client_name AND dc.dpco_org_id = dorg.id
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO CLIENT POLICIES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_client_policies (dpco_org_id, client_id, template_id, template_name, status, assigned_by, notes)
SELECT dorg.id, dc.id, cp.template_id, cp.template_name, cp.status::dpco_client_policy_status, cp.assigned_by, cp.notes
FROM (VALUES
  ('Olaniwun Ajayi LP', 'Zenith Bank Plc', 'TPL-PRIV-001', 'Privacy Policy Template (Banking)', 'signed', 'Yemisi Ogundipe', 'Customized for CBN regulatory requirements'),
  ('Olaniwun Ajayi LP', 'Zenith Bank Plc', 'TPL-RET-001', 'Data Retention Policy (Financial)', 'signed', 'Yemisi Ogundipe', '7-year retention per CBN guidelines'),
  ('Pavestones Legal', 'Flutterwave Inc', 'TPL-PRIV-002', 'Privacy Policy Template (Fintech)', 'signed', 'Lolade Ososami', 'Multi-jurisdiction privacy notice'),
  ('Pavestones Legal', 'Paystack', 'TPL-CONSENT-001', 'Consent Management Framework', 'reviewed', 'Lolade Ososami', 'Granular consent for payment processing'),
  ('Templars Law', 'NNPC Ltd', 'TPL-BREACH-001', 'Breach Notification Procedure', 'draft', 'Ifeoma Ajunwa', 'Updated post-ransomware incident'),
  ('Aluko & Oyebode', 'Access Bank Plc', 'TPL-DPIA-001', 'DPIA Template (Banking)', 'signed', 'Folake Elias-Adebowale', 'Standard DPIA for new product launches')
) AS cp(dpco_name, client_name, template_id, template_name, status, assigned_by, notes)
JOIN dpco_organisations dorg ON dorg.name = cp.dpco_name
JOIN dpco_clients dc ON dc.org_name = cp.client_name AND dc.dpco_org_id = dorg.id
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO EVIDENCE ITEMS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, title, description, file_url, file_name, mime_type, status, uploaded_by)
SELECT dorg.id, ae.id, ei.title, ei.description, ei.file_url, ei.file_name, ei.mime_type, ei.status::dpco_evidence_status, ei.uploaded_by
FROM (VALUES
  ('Olaniwun Ajayi LP', 'Annual NDPA Compliance Audit 2025', 'Data Processing Register', 'Complete register of all processing activities', '/evidence/zenith-dpr-2025.pdf', 'zenith-dpr-2025.pdf', 'application/pdf', 'active', 'Adaeze Nwankwo'),
  ('Olaniwun Ajayi LP', 'Annual NDPA Compliance Audit 2025', 'Consent Flow Screenshots', 'Mobile app and web consent screens', '/evidence/zenith-consent-flows.zip', 'consent-flows.zip', 'application/zip', 'active', 'IT Team'),
  ('Pavestones Legal', 'PCI-DSS + NDPA Integrated Audit', 'Penetration Test Report', 'Annual penetration test by Deloitte', '/evidence/fw-pentest-2025.pdf', 'fw-pentest-2025.pdf', 'application/pdf', 'active', 'Security Team'),
  ('Templars Law', 'Emergency Post-Breach Assessment', 'Incident Response Timeline', 'Detailed timeline from ransomware detection', '/evidence/nnpc-incident-timeline.pdf', 'incident-timeline.pdf', 'application/pdf', 'active', 'Ibrahim Musa'),
  ('Aluko & Oyebode', 'NDPA Article 31 DPO Effectiveness Review', 'DPO Annual Report 2024', 'DPO activities, training, incidents handled', '/evidence/access-dpo-report.pdf', 'dpo-report-2024.pdf', 'application/pdf', 'active', 'Kemi Olaleye')
) AS ei(dpco_name, engagement_title, title, description, file_url, file_name, mime_type, status, uploaded_by)
JOIN dpco_organisations dorg ON dorg.name = ei.dpco_name
JOIN dpco_audit_engagements ae ON ae.title = ei.engagement_title AND ae.dpco_org_id = dorg.id
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO INVOICES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_invoices (invoice_number, dpco_org_id, client_name, status, service_type, description, subtotal, vat_rate, vat_amount, total_amount, platform_fee_rate, platform_fee_amount, dpco_net_amount, issue_date, due_date) VALUES
  ('INV-2025-001', (SELECT id FROM dpco_organisations WHERE licence_number='DPCO-001-2024'), 'Zenith Bank Plc', 'paid', 'audit', 'Annual NDPA Compliance Audit', 8500000.00, 0.075, 637500.00, 9137500.00, 0.10, 913750.00, 8223750.00, '2025-09-01', '2025-10-01'),
  ('INV-2025-002', (SELECT id FROM dpco_organisations WHERE licence_number='DPCO-001-2024'), 'MTN Nigeria Communications Plc', 'sent', 'audit', 'Post-Enforcement Remediation Audit', 12000000.00, 0.075, 900000.00, 12900000.00, 0.10, 1290000.00, 11610000.00, '2025-10-15', '2025-11-15'),
  ('INV-2025-003', (SELECT id FROM dpco_organisations WHERE licence_number='DPCO-002-2024'), 'Flutterwave Inc', 'paid', 'audit', 'PCI-DSS + NDPA Integrated Audit', 6500000.00, 0.075, 487500.00, 6987500.00, 0.10, 698750.00, 6288750.00, '2025-08-01', '2025-09-01'),
  ('INV-2025-004', (SELECT id FROM dpco_organisations WHERE licence_number='DPCO-003-2024'), 'NNPC Ltd', 'draft', 'gap_assessment', 'Emergency Post-Breach Assessment', 15000000.00, 0.075, 1125000.00, 16125000.00, 0.10, 1612500.00, 14512500.00, '2025-11-01', '2025-12-01'),
  ('INV-2025-005', (SELECT id FROM dpco_organisations WHERE licence_number='DPCO-005-2024'), 'Access Bank Plc', 'paid', 'advisory', 'DPO Effectiveness Review & Advisory', 4500000.00, 0.075, 337500.00, 4837500.00, 0.10, 483750.00, 4353750.00, '2025-09-15', '2025-10-15')
ON CONFLICT (invoice_number) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO SUBSCRIPTIONS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_subscriptions (dpco_org_id, tier, status, monthly_fee, max_clients, max_audits_per_month, platform_fee_rate, current_period_start, current_period_end)
SELECT dorg.id, ds.tier::dpco_subscription_tier, ds.status::dpco_subscription_status, ds.fee, ds.max_clients, ds.max_audits, ds.plat_fee, ds.period_start::timestamp, ds.period_end::timestamp
FROM (VALUES
  ('Olaniwun Ajayi LP', 'enterprise', 'active', 500000.00, 50, 20, 0.10, '2025-01-01', '2025-12-31'),
  ('Pavestones Legal', 'professional', 'active', 150000.00, 20, 10, 0.10, '2025-01-01', '2025-12-31'),
  ('Templars Law', 'enterprise', 'active', 500000.00, 50, 20, 0.10, '2025-01-01', '2025-12-31'),
  ('Data Privacy Nigeria', 'starter', 'active', 50000.00, 10, 5, 0.10, '2025-01-01', '2025-12-31'),
  ('Aluko & Oyebode', 'enterprise', 'active', 500000.00, 50, 20, 0.10, '2025-01-01', '2025-12-31')
) AS ds(dpco_name, tier, status, fee, max_clients, max_audits, plat_fee, period_start, period_end)
JOIN dpco_organisations dorg ON dorg.name = ds.dpco_name
ON CONFLICT (dpco_org_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO TRAINING SESSIONS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_training_sessions (dpco_org_id, title, description, training_type, status, scheduled_date, completed_date, participant_count, facilitator, venue)
SELECT dorg.id, ts.title, ts.description, ts.training_type, ts.status::dpco_training_status, ts.sched::timestamp, ts.completed, ts.attendees, ts.facilitator, ts.venue
FROM (VALUES
  ('Olaniwun Ajayi LP', 'NDPA 2023 Essentials for Banking', 'Comprehensive overview of NDPA obligations for financial institutions', 'workshop', 'completed', '2025-06-15', '2025-06-15'::timestamp, 45, 'Yemisi Ogundipe', 'Eko Hotel Lagos'),
  ('Olaniwun Ajayi LP', 'DPO Certification Prep Workshop', 'Preparation for NDPC DPO certification examination', 'certification', 'completed', '2025-09-20', '2025-09-21'::timestamp, 30, 'External Faculty', 'Transcorp Hilton Abuja'),
  ('Pavestones Legal', 'Fintech Data Protection Masterclass', 'Data protection challenges for payment processors', 'masterclass', 'completed', '2025-07-10', '2025-07-10'::timestamp, 25, 'Lolade Ososami', 'Virtual'),
  ('Templars Law', 'Incident Response & Breach Notification', 'Practical workshop on NDPA Article 40', 'workshop', 'completed', '2025-11-05', '2025-11-05'::timestamp, 35, 'Ifeoma Ajunwa', 'NNPC Towers Abuja'),
  ('Data Privacy Nigeria', 'NDPA Awareness for SMEs', 'Basic data protection principles for SMEs', 'awareness', 'scheduled', '2026-02-01', NULL, 0, 'Chinedu Okeke', 'Abuja Tech Hub')
) AS ts(dpco_name, title, description, training_type, status, sched, completed, attendees, facilitator, venue)
JOIN dpco_organisations dorg ON dorg.name = ts.dpco_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO PAYMENTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_payments (invoice_id, dpco_org_id, payment_reference, amount, platform_fee_amount, dpco_net_amount, payment_method, paid_at)
SELECT inv.id, inv.dpco_org_id, dp.ref, dp.amount, dp.plat_fee, dp.net, dp.method::dpco_payment_method, dp.paid_at::timestamp
FROM (VALUES
  ('INV-2025-001', 'PAY-ZB-2025-001', 9137500.00, 913750.00, 8223750.00, 'bank_transfer', '2025-09-25'),
  ('INV-2025-003', 'PAY-FW-2025-001', 6987500.00, 698750.00, 6288750.00, 'bank_transfer', '2025-08-28'),
  ('INV-2025-005', 'PAY-AB-2025-001', 4837500.00, 483750.00, 4353750.00, 'bank_transfer', '2025-10-10')
) AS dp(inv_no, ref, amount, plat_fee, net, method, paid_at)
JOIN dpco_invoices inv ON inv.invoice_number = dp.inv_no
ON CONFLICT (payment_reference) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DPCO AUDIT CONTROL RATINGS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO dpco_audit_control_ratings (engagement_id, control_id, rating, notes, rated_by)
SELECT ae.id, acr.control_id, acr.rating::control_rating, acr.notes, acr.rated_by
FROM (VALUES
  ('Annual NDPA Compliance Audit 2025', 'NDPA-25', 'compliant', 'Consent mechanism properly implemented', 'Yemisi Ogundipe'),
  ('Annual NDPA Compliance Audit 2025', 'NDPA-28', 'partial', 'Cross-border transfers to SA lack adequacy', 'Yemisi Ogundipe'),
  ('Annual NDPA Compliance Audit 2025', 'NDPA-31', 'compliant', 'DPO appointed and registered with NDPC', 'Yemisi Ogundipe'),
  ('Annual NDPA Compliance Audit 2025', 'NDPA-36', 'compliant', 'DPIAs completed for high-risk processing', 'Yemisi Ogundipe'),
  ('Annual NDPA Compliance Audit 2025', 'NDPA-40', 'partial', 'Breach notification SOP not tested', 'Yemisi Ogundipe'),
  ('PCI-DSS + NDPA Integrated Audit', 'NDPA-24', 'compliant', 'Strong encryption at rest and in transit', 'Lolade Ososami'),
  ('PCI-DSS + NDPA Integrated Audit', 'NDPA-25', 'partial', 'Consent flow needs improvement', 'Lolade Ososami'),
  ('PCI-DSS + NDPA Integrated Audit', 'NDPA-37', 'compliant', 'Comprehensive data processing records', 'Lolade Ososami'),
  ('NDPA Article 31 DPO Effectiveness Review', 'NDPA-31', 'partial', 'DPO reports to CTO not Board', 'Folake Elias-Adebowale'),
  ('NDPA Article 31 DPO Effectiveness Review', 'NDPA-32', 'non_compliant', 'DPO has insufficient budget', 'Folake Elias-Adebowale')
) AS acr(engagement_title, control_id, rating, notes, rated_by)
JOIN dpco_audit_engagements ae ON ae.title = acr.engagement_title
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- DRIFT ALERTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO drift_alerts (organization_id, drift_type, severity, description, source, status, detected_at)
SELECT o.id, da.drift_type, da.severity::severity, da.description, da.source, da.status, da.detected_at::timestamp
FROM (VALUES
  ('Zenith Bank Plc', 'config_change', 'high', 'Firewall rule modified — port 3306 opened to public internet', 'AWS Config', 'open', '2025-10-15'),
  ('MTN Nigeria Communications Plc', 'policy_violation', 'critical', 'New data export transferring subscriber data to unregistered endpoint', 'Data Loss Prevention', 'escalated', '2025-11-01'),
  ('Flutterwave Inc', 'certificate_expiry', 'medium', 'TLS certificate for api.flutterwave.com expires in 14 days', 'Certificate Monitor', 'resolved', '2025-09-15'),
  ('Access Bank Plc', 'access_anomaly', 'high', 'Admin account accessed from unusual IP range (non-Nigerian)', 'SIEM', 'investigating', '2025-10-20'),
  ('NNPC Ltd', 'config_change', 'critical', 'Backup encryption key rotation missed — 90 days overdue', 'Key Management', 'open', '2025-11-10'),
  ('Paystack', 'policy_violation', 'medium', 'API key with write access shared via Slack channel', 'DLP Scanner', 'resolved', '2025-08-05')
) AS da(org_name, drift_type, severity, description, source, status, detected_at)
JOIN organizations o ON o.name = da.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- ENFORCEMENT CASES (needs financial_penalties FK)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO enforcement_cases (penalty_id, organization_id, status, case_reference, overdue_days, escalation_reason, opened_at)
SELECT fp.id, fp.organization_id, ec.status::enforcement_case_status, ec.case_ref, ec.overdue_days, ec.escalation_reason, ec.opened_at::timestamp
FROM (VALUES
  (1, 'open', 'NDPC-ENF-2025-001', 0, NULL, '2025-06-15'),
  (2, 'under_investigation', 'NDPC-ENF-2025-002', 15, NULL, '2025-08-20'),
  (3, 'notice_issued', 'NDPC-ENF-2025-003', 0, NULL, '2025-09-15'),
  (4, 'escalated_to_nitda', 'NDPC-ENF-2025-004', 45, 'Delayed breach notification — systemic concern', '2025-10-05'),
  (5, 'open', 'NDPC-ENF-2025-005', 0, NULL, '2025-12-01')
) AS ec(penalty_idx, status, case_ref, overdue_days, escalation_reason, opened_at)
JOIN financial_penalties fp ON fp.id = ec.penalty_idx
ON CONFLICT (case_reference) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- CASE TIMELINE
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO case_timeline (case_id, changed_by_user_id, changed_by_name, from_status, to_status, note, created_at)
SELECT ec.id, 1, ct.changed_by, ct.from_status, ct.to_status, ct.note, ct.created_at::timestamp
FROM (VALUES
  ('NDPC-ENF-2025-001', 'NDPC Intake', NULL, 'open', 'Complaint received from data subject', '2025-06-15'),
  ('NDPC-ENF-2025-001', 'Dr. Amina Bello', 'open', 'under_investigation', 'Investigation team assigned', '2025-06-20'),
  ('NDPC-ENF-2025-002', 'NDPC Intake', NULL, 'open', 'Whistleblower report received', '2025-08-20'),
  ('NDPC-ENF-2025-002', 'Barrister Chidi', 'open', 'under_investigation', 'Technical forensics underway', '2025-08-25'),
  ('NDPC-ENF-2025-004', 'NDPC Intake', NULL, 'open', 'NNPC reported ransomware 30 days late', '2025-10-05'),
  ('NDPC-ENF-2025-004', 'Commissioner', 'open', 'escalated_to_nitda', 'Escalated — systemic breach of notification', '2025-10-15')
) AS ct(case_ref, changed_by, from_status, to_status, note, created_at)
JOIN enforcement_cases ec ON ec.case_reference = ct.case_ref
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- ENFORCEMENT ACTIONS (needs compliance_violations FK)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO enforcement_actions (violation_id, organization_id, action_type, status, penalty_amount, notes, created_at)
SELECT cv.id, cv.organization_id, ea.action_type, ea.status::enforcement_status, ea.penalty_amount, ea.notes, ea.created_at::timestamp
FROM (VALUES
  (1, 'remediation_order', 'notice_sent', NULL, 'Cease unauthorized cross-border transfers — 90-day remediation', '2025-07-01'),
  (2, 'fine', 'penalty_imposed', 555800000.0, 'N555.8M fine for data privacy violation', '2025-09-15'),
  (3, 'warning', 'settled', NULL, 'Formal warning for non-compliant consent', '2025-05-15'),
  (4, 'fine', 'penalty_imposed', 250000000.0, 'N250M for delayed breach notification', '2025-11-01'),
  (5, 'audit_order', 'pending', NULL, 'Mandatory DPIA for biometric surveillance', '2025-12-15')
) AS ea(violation_idx, action_type, status, penalty_amount, notes, created_at)
JOIN compliance_violations cv ON cv.id = ea.violation_idx
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE PACKAGES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO evidence_packages (organization_id, package_type, status, file_url, created_at)
SELECT o.id, ep.pkg_type, ep.status::evidence_package_status, ep.file_url, ep.created_at::timestamp
FROM (VALUES
  ('Zenith Bank Plc', 'quarterly_report', 'verified', '/evidence/zenith-q3-2025.pdf', '2025-10-01'),
  ('First Bank of Nigeria Plc', 'incident_report', 'generating', '/evidence/firstbank-breach-report.pdf', '2025-09-01'),
  ('MTN Nigeria Communications Plc', 'tia_package', 'ready', '/evidence/mtn-tia-sa-uk-us.pdf', '2025-08-15'),
  ('NNPC Ltd', 'incident_report', 'ready', '/evidence/nnpc-ransomware-report.pdf', '2025-10-20'),
  ('Flutterwave Inc', 'annual_report', 'verified', '/evidence/flutterwave-annual-2025.pdf', '2025-12-01')
) AS ep(org_name, pkg_type, status, file_url, created_at)
JOIN organizations o ON o.name = ep.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- FINANCIAL LEDGER
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO financial_ledger (transaction_id, organization_id, tx_type, status, amount, currency, description, created_at)
SELECT fl.txn_id, o.id, fl.tx_type::ledger_tx_type, fl.status::ledger_tx_status, fl.amount, fl.currency, fl.description, fl.created_at::timestamp
FROM (VALUES
  ('TXN-PEN-2025-001', 'First Bank of Nigeria Plc', 'penalty', 'pending', 555800000.0, 'NGN', 'NDPC Fine — Data privacy violation (Article 47)', '2025-09-15'),
  ('TXN-PEN-2025-002', 'NNPC Ltd', 'penalty', 'pending', 250000000.0, 'NGN', 'NDPC Fine — Delayed breach notification', '2025-11-01'),
  ('TXN-FEE-2025-001', 'Zenith Bank Plc', 'fine', 'settled', 5000000.0, 'NGN', 'Annual DPCO Registration Renewal Fee', '2025-01-15'),
  ('TXN-AUD-2025-001', 'MTN Nigeria Communications Plc', 'fine', 'pending', 12900000.0, 'NGN', 'Post-Enforcement Remediation Audit Fee', '2025-10-15'),
  ('TXN-AUD-2025-002', 'Flutterwave Inc', 'fine', 'settled', 6987500.0, 'NGN', 'PCI-DSS + NDPA Integrated Audit Fee', '2025-08-28'),
  ('TXN-PEN-2025-003', 'Dangote Industries Ltd', 'penalty', 'processing', 50000000.0, 'NGN', 'Preliminary penalty — biometric data processing', '2025-12-20')
) AS fl(txn_id, org_name, tx_type, status, amount, currency, description, created_at)
JOIN organizations o ON o.name = fl.org_name
ON CONFLICT (transaction_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- IN-APP NOTIFICATIONS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO in_app_notifications (title, message, severity, category, organization_id, is_read, action_url, created_at)
SELECT n.title, n.message, n.severity, n.category, o.id, n.is_read, n.action_url, n.created_at::timestamp
FROM (VALUES
  ('Enforcement Case Opened', 'NDPC-ENF-2025-001: Investigation opened for unauthorized cross-border transfer', 'critical', 'enforcement', 'MTN Nigeria Communications Plc', false, '/enforcement', '2025-06-15'),
  ('Penalty Issued', 'N555.8M fine issued for data privacy violation', 'critical', 'penalty', 'First Bank of Nigeria Plc', false, '/penalties', '2025-09-15'),
  ('SLA Breach Warning', 'DSAR response deadline approaching — 3 requests due within 48 hours', 'high', 'compliance', 'Zenith Bank Plc', true, '/citizen-requests', '2025-10-08'),
  ('Audit Scheduled', 'Post-Enforcement Remediation Audit starts October 1', 'info', 'audit', 'MTN Nigeria Communications Plc', true, '/audits', '2025-09-15'),
  ('Security Alert', 'Ransomware indicators detected — incident response activated', 'critical', 'security', 'NNPC Ltd', false, '/security', '2025-10-05'),
  ('Compliance Score Update', 'Score improved from 76.2 to 82.5 following DPO appointment', 'info', 'compliance', 'Dangote Industries Ltd', true, '/compliance', '2025-11-20'),
  ('Certificate Expiring', 'DPCO licence expires in 30 days', 'high', 'system', 'MTN Nigeria Communications Plc', false, '/dpco/renewal', '2025-12-01'),
  ('New DSAR Received', 'Data erasure request — 30-day response deadline', 'medium', 'compliance', 'First Bank of Nigeria Plc', false, '/citizen-requests', '2025-09-10')
) AS n(title, message, severity, category, org_name, is_read, action_url, created_at)
JOIN organizations o ON o.name = n.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- MONITORING SNAPSHOTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO monitoring_snapshots (organization_id, snapshot_type, score, previous_score, delta, status, worker_source, details, compliance_score, issues_found, critical_issues, captured_at)
SELECT o.id, ms.snapshot_type, ms.score, ms.prev, ms.delta, ms.status, ms.worker, ms.details::jsonb, ms.comp_score, ms.issues, ms.critical, ms.captured_at::timestamp
FROM (VALUES
  ('Zenith Bank Plc', 'compliance', 88.5, 85.0, 3.5, 'improving', 'compliance-worker', '{"dpoAppointed":true,"dpiaComplete":true}', 88.5, 2, 0, '2025-10-01'),
  ('MTN Nigeria Communications Plc', 'security', 72.0, 78.5, -6.5, 'degraded', 'security-scanner', '{"crossBorderIssue":true,"encryptionGaps":2}', 72.0, 8, 2, '2025-10-01'),
  ('First Bank of Nigeria Plc', 'compliance', 65.0, 82.0, -17.0, 'critical', 'compliance-worker', '{"apiExposure":true,"consentIssues":true}', 65.0, 12, 3, '2025-10-01'),
  ('Flutterwave Inc', 'security', 92.0, 90.5, 1.5, 'stable', 'security-scanner', '{"wafActive":true,"ddosProtection":true}', 92.0, 1, 0, '2025-10-01'),
  ('NNPC Ltd', 'compliance', 45.0, 70.0, -25.0, 'critical', 'compliance-worker', '{"ransomwareIncident":true}', 45.0, 15, 5, '2025-10-15'),
  ('Access Bank Plc', 'compliance', 85.3, 83.0, 2.3, 'improving', 'compliance-worker', '{"dpoReviewComplete":true}', 85.3, 3, 0, '2025-10-01')
) AS ms(org_name, snapshot_type, score, prev, delta, status, worker, details, comp_score, issues, critical, captured_at)
JOIN organizations o ON o.name = ms.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- NOTIFICATION SETTINGS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO notification_settings (organization_id, dpo_email, technical_email, legal_email)
SELECT o.id, ns.dpo_email, ns.tech_email, ns.legal_email
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'dpo@mtn.ng', 'security@mtn.ng', 'legal@mtn.ng'),
  ('First Bank of Nigeria Plc', 'dpo@firstbanknigeria.com', 'it@firstbanknigeria.com', 'legal@firstbanknigeria.com'),
  ('Zenith Bank Plc', 'dpo@zenithbank.com', 'infosec@zenithbank.com', 'compliance@zenithbank.com'),
  ('Flutterwave Inc', 'dpo@flutterwave.com', 'security@flutterwave.com', 'legal@flutterwave.com'),
  ('NNPC Ltd', 'dpo@nnpc.com', 'itsecurity@nnpc.com', 'legal@nnpc.com')
) AS ns(org_name, dpo_email, tech_email, legal_email)
JOIN organizations o ON o.name = ns.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- PENALTY APPEALS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal, status)
SELECT fp.id, fp.organization_id, pa.submitted_by, pa.email, pa.grounds, pa.status::appeal_status
FROM (VALUES
  (1, 'First Bank Legal Team', 'legal@firstbanknigeria.com', 'Disproportionate fine — API misconfiguration was discovered internally and patched within 4 hours. Remediation measures were implemented promptly.', 'under_review'),
  (4, 'NNPC External Counsel', 'counsel@nnpc-legal.com', 'Ransomware attack was sophisticated state-sponsored threat. Notification delay was due to ongoing forensic investigation to determine scope.', 'submitted')
) AS pa(penalty_idx, submitted_by, email, grounds, status)
JOIN financial_penalties fp ON fp.id = pa.penalty_idx
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- PORTAL SUBMISSIONS (Org onboarding)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO portal_submissions (submission_token, organization_id, org_name, org_sector, org_country, regulatory_id, contact_name, contact_email, current_phase, asset_count, dataset_count, self_assessment_score, compliance_score, notes)
SELECT ps.token, o.id, ps.org_name, ps.sector, ps.country, ps.reg_id, ps.contact, ps.email, ps.phase::onboarding_phase, ps.assets, ps.datasets, ps.self_score, ps.comp_score, ps.notes
FROM (VALUES
  ('TOK-ZBP-2024-001', 'Zenith Bank Plc', 'Zenith Bank Plc', 'Banking & Finance', 'Nigeria', 'RC-ZBP-001', 'Adaeze Nwankwo', 'compliance@zenithbank.com', 'certified', 450, 120, 85.0, 88.5, 'Fully certified — annual renewal due Q1 2026'),
  ('TOK-MTN-2024-001', 'MTN Nigeria Communications Plc', 'MTN Nigeria Communications Plc', 'Telecommunications', 'Nigeria', 'RC-MTN-001', 'Tunde Bakare', 'dpo@mtn.ng', 'remediation', 800, 250, 70.0, 72.0, 'Under remediation following enforcement order'),
  ('TOK-FBN-2024-001', 'First Bank of Nigeria Plc', 'First Bank of Nigeria Plc', 'Banking & Finance', 'Nigeria', 'RC-FBN-001', 'Adeola Johnson', 'compliance@firstbanknigeria.com', 'remediation', 520, 180, 60.0, 65.0, 'Remediation after API exposure incident'),
  ('TOK-FLW-2024-001', 'Flutterwave Inc', 'Flutterwave Inc', 'Fintech', 'Nigeria', 'RC-FWI-003', 'Olu Adeyinka', 'security@flutterwave.com', 'certified', 180, 90, 90.0, 92.0, 'PCI-DSS and NDPA certified'),
  ('TOK-NPC-2024-001', 'NNPC Ltd', 'NNPC Ltd', 'Oil & Gas', 'Nigeria', 'RC-NPC-001', 'Ibrahim Musa', 'dpo@nnpc.com', 'initial_audit', 350, 150, 45.0, 45.0, 'Post-breach assessment in progress'),
  ('TOK-DNG-2024-001', 'Dangote Industries Ltd', 'Dangote Industries Ltd', 'Manufacturing', 'Nigeria', 'RC-DIL-002', 'External DPO', 'dpo@dangote.com', 'data_catalog', 320, 100, 65.0, 68.5, 'Complex manufacturing data flows')
) AS ps(token, org_name_lookup, org_name, sector, country, reg_id, contact, email, phase, assets, datasets, self_score, comp_score, notes)
JOIN organizations o ON o.name = ps.org_name_lookup
ON CONFLICT (submission_token) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- ONBOARDING PHASES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes)
SELECT ps.id, op.phase::onboarding_phase, op.status, op.started_at::timestamp, op.completed_at, op.notes
FROM (VALUES
  ('TOK-ZBP-2024-001', 'registration', 'completed', '2024-06-01', '2024-06-05'::timestamp, 'CAC verification completed'),
  ('TOK-ZBP-2024-001', 'asset_inventory', 'completed', '2024-06-05', '2024-07-30'::timestamp, '450 assets discovered and catalogued'),
  ('TOK-ZBP-2024-001', 'data_catalog', 'completed', '2024-07-30', '2024-08-30'::timestamp, 'Data catalog entries mapped'),
  ('TOK-ZBP-2024-001', 'self_assessment', 'completed', '2024-08-30', '2024-09-15'::timestamp, 'Self-assessment score: 85'),
  ('TOK-ZBP-2024-001', 'initial_audit', 'completed', '2024-09-15', '2024-10-15'::timestamp, 'Audit by Olaniwun Ajayi LP'),
  ('TOK-ZBP-2024-001', 'certified', 'completed', '2024-10-15', '2024-10-30'::timestamp, 'NDPA compliance certificate issued'),
  ('TOK-MTN-2024-001', 'registration', 'completed', '2024-07-01', '2024-07-10'::timestamp, 'Registered'),
  ('TOK-MTN-2024-001', 'asset_inventory', 'completed', '2024-07-10', '2024-09-01'::timestamp, '800 assets discovered'),
  ('TOK-MTN-2024-001', 'remediation', 'in_progress', '2025-07-01', NULL, 'Following NDPC enforcement order'),
  ('TOK-DNG-2024-001', 'registration', 'completed', '2024-09-01', '2024-09-10'::timestamp, 'Multi-site registration'),
  ('TOK-DNG-2024-001', 'asset_inventory', 'completed', '2024-09-10', '2024-11-01'::timestamp, '320 assets across multiple locations'),
  ('TOK-DNG-2024-001', 'data_catalog', 'in_progress', '2024-11-01', NULL, 'Complex manufacturing data flows')
) AS op(token, phase, status, started_at, completed_at, notes)
JOIN portal_submissions ps ON ps.submission_token = op.token
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- REMEDIATION WORKFLOWS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO remediation_workflows (org_id, action_type, priority, description, status, deadline, notes, created_at)
SELECT o.id, rw.action_type, rw.priority, rw.description, rw.status::remediation_workflow_status, rw.deadline::timestamp, rw.notes, rw.created_at::timestamp
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'cross_border_remediation', 'critical', 'Implement Cross-Border Transfer Adequacy Assessment for SA', 'in_progress', '2025-10-01', 'Per NDPC enforcement order', '2025-07-01'),
  ('First Bank of Nigeria Plc', 'security_patch', 'critical', 'API Security Remediation — patch endpoint, add auth, rate limiting', 'in_progress', '2025-10-15', 'Following API exposure incident', '2025-09-01'),
  ('NNPC Ltd', 'process_update', 'high', 'Breach Notification SOP Update — ensure 72-hour compliance', 'pending', '2025-12-31', 'Post-ransomware incident', '2025-10-15'),
  ('Dangote Industries Ltd', 'dpia_completion', 'high', 'Complete DPIA for employee biometric surveillance system', 'pending', '2026-02-15', 'Mandatory per NDPC audit order', '2025-12-15'),
  ('Zenith Bank Plc', 'documentation', 'medium', 'Document all cross-border transfers and complete TIAs', 'completed', '2025-09-30', 'All TIAs completed and approved', '2025-07-15'),
  ('Flutterwave Inc', 'consent_improvement', 'medium', 'Implement granular consent for third-party data sharing', 'completed', '2025-09-01', 'Consent flow updated and verified', '2025-07-01')
) AS rw(org_name, action_type, priority, description, status, deadline, notes, created_at)
JOIN organizations o ON o.name = rw.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- RESIDENCY CHECKS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO residency_checks (organization_id, check_type, status, destination_country, data_categories, legal_basis, risk_level, notes, checked_at)
SELECT o.id, rc.check_type, rc.status, rc.dest, rc.data_cats::jsonb, rc.legal_basis, rc.risk, rc.notes, rc.checked_at::timestamp
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'cross_border', 'failed', 'South Africa', '["subscriber data","call records"]', 'Legitimate interest (disputed)', 'critical', 'No adequacy assessment — NDPC enforcement order', '2025-06-20'),
  ('Flutterwave Inc', 'cross_border', 'passed', 'United States', '["transaction data","merchant data"]', 'Standard contractual clauses', 'medium', 'SCCs in place, TIA completed', '2025-07-01'),
  ('Flutterwave Inc', 'cross_border', 'passed', 'United Kingdom', '["payment data"]', 'Adequacy decision', 'low', 'UK has NDPC adequacy recognition', '2025-07-01'),
  ('Zenith Bank Plc', 'data_residency', 'passed', 'Nigeria', '["all customer data"]', 'Primary processing', 'low', 'All data in Lagos DC1 and Abuja DR', '2025-08-01'),
  ('NNPC Ltd', 'cross_border', 'pending', 'United Arab Emirates', '["contractor data","financials"]', 'Consent', 'high', 'TIA pending for UAE JV operations', '2025-10-20'),
  ('Access Bank Plc', 'cross_border', 'passed', 'Kenya', '["transaction data"]', 'SCCs', 'medium', 'East Africa expansion — DPA signed', '2025-09-15')
) AS rc(org_name, check_type, status, dest, data_cats, legal_basis, risk, notes, checked_at)
JOIN organizations o ON o.name = rc.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- SLA BREACHES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO sla_breaches (organization_id, sla_type, threshold, actual, severity, status, escalated_to, notes, detected_at)
SELECT o.id, sb.sla_type, sb.threshold, sb.actual, sb.severity::severity, sb.status, sb.escalated_to, sb.notes, sb.detected_at::timestamp
FROM (VALUES
  ('NNPC Ltd', 'breach_notification', 72, 720, 'critical', 'escalated', 'NDPC Commissioner', 'Notification 30 days late — 720h vs 72h requirement', '2025-10-15'),
  ('First Bank of Nigeria Plc', 'dsar_response', 720, 480, 'info', 'resolved', NULL, 'DSAR responded within SLA', '2025-09-05'),
  ('MTN Nigeria Communications Plc', 'dsar_response', 720, 900, 'high', 'open', 'DPO Office', 'DSAR response 7 days overdue', '2025-09-01'),
  ('Dangote Industries Ltd', 'dpia_completion', 2160, 4320, 'high', 'open', 'External DPO', 'DPIA 3 months overdue', '2025-12-01'),
  ('Zenith Bank Plc', 'audit_submission', 720, 700, 'low', 'resolved', NULL, 'Annual return submitted on time', '2025-03-14')
) AS sb(org_name, sla_type, threshold, actual, severity, status, escalated_to, notes, detected_at)
JOIN organizations o ON o.name = sb.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- STREAMING EVENTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO streaming_events (topic, source, event_type, payload, partition, "offset", created_at) VALUES
  ('ndsep.compliance', 'compliance-worker', 'score_change', '{"orgId":1,"oldScore":85.0,"newScore":88.5}', 0, 1001, '2025-10-01'),
  ('ndsep.enforcement', 'enforcement-svc', 'case_opened', '{"caseRef":"NDPC-ENF-2025-001","severity":"high"}', 1, 502, '2025-06-15'),
  ('ndsep.security', 'security-scanner', 'ransomware_detected', '{"orgId":5,"type":"ransomware","severity":"critical"}', 2, 203, '2025-10-05'),
  ('ndsep.dsar', 'citizen-portal', 'dsar_received', '{"type":"access","orgId":1,"deadline":"2025-09-01"}', 0, 1002, '2025-08-01'),
  ('ndsep.audit', 'dpco-platform', 'audit_started', '{"dpcoOrgId":1,"title":"Annual Audit 2025"}', 1, 503, '2025-09-01'),
  ('ndsep.financial', 'tigerbeetle-bridge', 'penalty_issued', '{"amount":555800000,"currency":"NGN"}', 2, 204, '2025-09-15'),
  ('ndsep.bgp', 'bgp-monitor', 'route_hijack', '{"prefix":"197.210.0.0/16","originAsn":29465}', 0, 1003, '2025-10-20'),
  ('ndsep.middleware', 'health-checker', 'service_degraded', '{"service":"redis","status":"unhealthy"}', 1, 504, '2025-11-01')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- TIA ASSESSMENTS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO tia_assessments (organization_id, data_categories, destination_country, legal_basis, risk_level, status, safeguards, created_at)
SELECT o.id, ta.data_cats::jsonb, ta.dest, ta.legal_basis, ta.risk::tia_risk_level, ta.status::tia_status, ta.safeguards, ta.created_at::timestamp
FROM (VALUES
  ('MTN Nigeria Communications Plc', '["subscriber profiles","call records","location data"]', 'South Africa', 'Group legitimate interest', 'high', 'draft', 'SCCs pending, encryption in transit', '2025-07-01'),
  ('Flutterwave Inc', '["transaction data","merchant data","KYC docs"]', 'United States', 'Standard contractual clauses', 'medium', 'approved', 'SCCs signed, data minimization, encryption', '2025-06-15'),
  ('Flutterwave Inc', '["payment data","fraud indicators"]', 'United Kingdom', 'Adequacy decision', 'low', 'approved', 'UK adequacy recognized, DPA signed', '2025-06-15'),
  ('NNPC Ltd', '["contractor PII","financial records"]', 'United Arab Emirates', 'Explicit consent', 'high', 'submitted', 'Consent forms, encryption, audit logging', '2025-10-20'),
  ('Access Bank Plc', '["transaction data","customer profiles"]', 'Kenya', 'Standard contractual clauses', 'medium', 'approved', 'SCCs and DPA in place, quarterly audit', '2025-09-01'),
  ('Zenith Bank Plc', '["correspondent banking data"]', 'United Kingdom', 'Adequacy + SCCs', 'low', 'approved', 'Dual protection — adequacy + contractual', '2025-08-01')
) AS ta(org_name, data_cats, dest, legal_basis, risk, status, safeguards, created_at)
JOIN organizations o ON o.name = ta.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- TRANSFER APPROVALS
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO transfer_approvals (organization_id, destination_country, transfer_type, status, data_categories, volume_estimate, legal_basis, reviewed_by, review_notes, requested_at, decided_at)
SELECT o.id, ta.dest, ta.transfer_type, ta.status, ta.data_cats::jsonb, ta.volume, ta.legal_basis, ta.reviewer, ta.notes, ta.requested_at::timestamp, ta.decided_at
FROM (VALUES
  ('MTN Nigeria Communications Plc', 'South Africa', 'subsidiary', 'rejected', '["subscriber data"]', '12M records', 'Legitimate interest', 'NDPC Panel', 'Rejected — no adequacy assessment', '2025-06-01', '2025-06-15'::timestamp),
  ('Flutterwave Inc', 'United States', 'processor', 'approved', '["transaction data"]', '50M txns/year', 'SCCs', 'NDPC Panel', 'Approved with annual audit condition', '2025-05-01', '2025-05-20'::timestamp),
  ('Access Bank Plc', 'Kenya', 'subsidiary', 'approved', '["customer data"]', '2M records', 'SCCs', 'NDPC Panel', 'Approved — East Africa expansion', '2025-08-01', '2025-08-20'::timestamp),
  ('NNPC Ltd', 'United Arab Emirates', 'joint_venture', 'pending', '["contractor data"]', '50K records', 'Consent', NULL, NULL, '2025-10-20', NULL),
  ('Zenith Bank Plc', 'United Kingdom', 'correspondent', 'approved', '["banking data"]', '1M txns/year', 'Adequacy + SCCs', 'NDPC Panel', 'Dual safeguards adequate', '2025-07-01', '2025-07-15'::timestamp)
) AS ta(org_name, dest, transfer_type, status, data_cats, volume, legal_basis, reviewer, notes, requested_at, decided_at)
JOIN organizations o ON o.name = ta.org_name
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- POLICY TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO policy_templates (name, description, category, content, version, is_active) VALUES
  ('Privacy Policy — Banking Sector', 'Standard privacy policy for CBN + NDPA requirements', 'privacy_policy', 'Template covering: data collection, processing purposes, legal basis, data subject rights, cross-border transfers, retention periods, complaint procedures.', '2.0', true),
  ('Data Breach Notification Template', 'NDPA Article 40 compliant breach notification', 'breach_notification', 'Template: incident description, data categories affected, estimated records, remedial measures, DPO contact. Must be submitted within 72 hours.', '1.5', true),
  ('DPIA Template — High Risk', 'Comprehensive DPIA for Article 36 assessments', 'dpia', 'Systematic assessment: processing description, necessity, risk identification, mitigation, DPO consultation, residual risk.', '1.2', true),
  ('Consent Collection Framework', 'NDPA Article 25 consent mechanism template', 'consent', 'Framework: granular options, purpose statements, withdrawal mechanism, child consent (Art 35), re-consent triggers.', '1.0', true),
  ('Data Retention Schedule', 'Sector-specific retention periods per NDPA Article 30', 'retention', 'Financial: 7 years. Health: 25 years. Telecom CDRs: 2 years. Marketing: consent-based. Employee: employment + 6 years.', '1.1', true),
  ('Cross-Border Transfer Agreement', 'Standard contractual clauses for NDPA Article 28', 'transfer', 'Model clauses: adequacy assessment, supplementary measures, data importer obligations, jurisdiction.', '1.0', true)
ON CONFLICT DO NOTHING;
