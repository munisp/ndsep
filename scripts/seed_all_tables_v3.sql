-- ============================================================
-- NDSEP Comprehensive Seed Script v3 — Exact Schema Match
-- Each INSERT is independent (no transaction wrapping) to avoid cascade failures
-- ============================================================

-- ─── NIP Transactions ────────────────────────────────────────────────────────
INSERT INTO nip_transactions (bank_id, session_id, transaction_ref, channel, transaction_type, originating_bank, originating_account, originating_name, beneficiary_bank, beneficiary_account, beneficiary_name, amount, currency, narration, status, response_code, response_message, value_date, created_at)
VALUES
(1,'NIP20260101001','TXN-NIP-001','mobile','credit_transfer','011','1234567890','Adebayo Okafor','057','9876543210','Ngozi Adeyemi',250000,'NGN','Transfer to Zenith','completed','00','Approved','2026-01-01',NOW()-INTERVAL '30 days'),
(2,'NIP20260101002','TXN-NIP-002','internet','credit_transfer','057','9876543210','Ngozi Adeyemi','044','1122334455','Emeka Nwosu',500000,'NGN','Business payment','completed','00','Approved','2026-01-01',NOW()-INTERVAL '30 days'),
(3,'NIP20260101003','TXN-NIP-003','pos','credit_transfer','058','2233445566','GTB Customer','033','3344556677','UBA Customer',1000000,'NGN','Rent payment','completed','00','Approved','2026-01-01',NOW()-INTERVAL '29 days'),
(4,'NIP20260102001','TXN-NIP-004','mobile','credit_transfer','044','3344556677','Access Customer','011','4455667788','FBN Customer',75000,'NGN','School fees','completed','00','Approved','2026-01-02',NOW()-INTERVAL '29 days'),
(5,'NIP20260102002','TXN-NIP-005','internet','credit_transfer','033','4455667788','UBA Customer','057','5566778899','Zenith Cust',2500000,'NGN','Supplier payment','completed','00','Approved','2026-01-02',NOW()-INTERVAL '28 days'),
(1,'NIP20260102003','TXN-NIP-006','mobile','credit_transfer','011','5566778899','FBN Customer','058','6677889900','GTB Customer',150000,'NGN','Personal transfer','failed','51','Insufficient funds','2026-01-02',NOW()-INTERVAL '28 days'),
(2,'NIP20260103001','TXN-NIP-007','internet','credit_transfer','057','6677889900','Zenith Customer','044','7788990011','Access Cust',5000000,'NGN','Property deposit','completed','00','Approved','2026-01-03',NOW()-INTERVAL '27 days'),
(3,'NIP20260103002','TXN-NIP-008','mobile','credit_transfer','058','7788990011','GTB Customer','033','8899001122','UBA Customer',350000,'NGN','Medical bills','completed','00','Approved','2026-01-03',NOW()-INTERVAL '27 days'),
(4,'NIP20260103003','TXN-NIP-009','internet','credit_transfer','044','8899001122','Access Customer','011','9900112233','FBN Customer',800000,'NGN','Equipment purchase','completed','00','Approved','2026-01-03',NOW()-INTERVAL '26 days'),
(5,'NIP20260104001','TXN-NIP-010','ussd','credit_transfer','033','9900112233','UBA Customer','057','0011223344','Zenith Cust',125000,'NGN','Utility payment','completed','00','Approved','2026-01-04',NOW()-INTERVAL '26 days'),
(1,'NIP20260104002','TXN-NIP-011','internet','credit_transfer','011','0011223344','FBN Customer','058','1122334456','GTB Customer',3500000,'NGN','Investment transfer','pending',NULL,NULL,'2026-01-04',NOW()-INTERVAL '25 days'),
(2,'NIP20260104003','TXN-NIP-012','mobile','credit_transfer','057','1122334456','Zenith Customer','044','2233445567','Access Cust',200000,'NGN','Airtime purchase','completed','00','Approved','2026-01-04',NOW()-INTERVAL '25 days'),
(3,'NIP20260105001','TXN-NIP-013','internet','credit_transfer','058','2233445567','GTB Customer','033','3344556678','UBA Customer',750000,'NGN','Salary advance','completed','00','Approved','2026-01-05',NOW()-INTERVAL '24 days'),
(4,'NIP20260105002','TXN-NIP-014','pos','credit_transfer','044','3344556678','Access Customer','011','4455667789','FBN Customer',50000,'NGN','Food purchase','completed','00','Approved','2026-01-05',NOW()-INTERVAL '24 days'),
(5,'NIP20260105003','TXN-NIP-015','internet','credit_transfer','033','4455667789','UBA Customer','057','5566778890','Zenith Cust',10000000,'NGN','Large transfer','completed','00','Approved','2026-01-05',NOW()-INTERVAL '23 days'),
(1,'NIP20260106001','TXN-NIP-016','mobile','credit_transfer','011','5566778890','FBN Customer','058','6677889901','GTB Customer',450000,'NGN','Loan repayment','completed','00','Approved','2026-01-06',NOW()-INTERVAL '23 days'),
(2,'NIP20260106002','TXN-NIP-017','internet','credit_transfer','057','6677889901','Zenith Customer','044','7788990012','Access Cust',1800000,'NGN','Car purchase deposit','completed','00','Approved','2026-01-06',NOW()-INTERVAL '22 days'),
(3,'NIP20260106003','TXN-NIP-018','pos','credit_transfer','058','7788990012','GTB Customer','033','8899001123','UBA Customer',25000,'NGN','Fuel purchase','failed','91','No such issuer','2026-01-06',NOW()-INTERVAL '22 days'),
(4,'NIP20260107001','TXN-NIP-019','internet','credit_transfer','044','8899001123','Access Customer','011','9900112234','FBN Customer',600000,'NGN','Insurance premium','completed','00','Approved','2026-01-07',NOW()-INTERVAL '21 days'),
(5,'NIP20260107002','TXN-NIP-020','internet','credit_transfer','033','9900112234','UBA Customer','057','0011223345','Zenith Cust',2200000,'NGN','Dividend payment','completed','00','Approved','2026-01-07',NOW()-INTERVAL '21 days')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Cases ────────────────────────────────────────────────────────
INSERT INTO enforcement_cases (penalty_id, organization_id, status, case_reference, overdue_days, nitda_reference_number, resolution_notes, opened_at, updated_at)
VALUES
(1,1,'open','NDPC-ENF-2026-001',0,'NITDA-2026-0001',NULL,NOW()-INTERVAL '25 days',NOW()-INTERVAL '1 day'),
(2,2,'open','NDPC-ENF-2026-002',15,'NITDA-2026-0002',NULL,NOW()-INTERVAL '30 days',NOW()-INTERVAL '2 hours'),
(3,3,'open','NDPC-ENF-2026-003',0,'NITDA-2026-0003',NULL,NOW()-INTERVAL '20 days',NOW()-INTERVAL '3 hours'),
(4,4,'closed','NDPC-ENF-2026-004',0,'NITDA-2026-0004','Organisation paid penalty and implemented remediation plan',NOW()-INTERVAL '60 days',NOW()-INTERVAL '10 days'),
(5,5,'open','NDPC-ENF-2026-005',5,'NITDA-2026-0005',NULL,NOW()-INTERVAL '15 days',NOW()-INTERVAL '4 hours')
ON CONFLICT DO NOTHING;

-- ─── Case Timeline ────────────────────────────────────────────────────────────
-- case_timeline has: id, case_id, description, performed_by, created_at
INSERT INTO case_timeline (case_id, description, performed_by, created_at)
VALUES
(1,'Enforcement case opened following compliance violation detection','NDPC Officer',NOW()-INTERVAL '25 days'),
(1,'Formal notice issued to First Bank of Nigeria Plc','NDPC Officer',NOW()-INTERVAL '24 days'),
(1,'Organisation submitted initial response','First Bank Compliance Team',NOW()-INTERVAL '20 days'),
(2,'Enforcement case opened for MTN Nigeria','NDPC Officer',NOW()-INTERVAL '30 days'),
(2,'Formal notice issued to MTN Nigeria','NDPC Officer',NOW()-INTERVAL '29 days'),
(2,'Case escalated due to non-response after 15 days','NDPC Officer',NOW()-INTERVAL '15 days'),
(3,'Enforcement case opened for LUTH','NDPC Officer',NOW()-INTERVAL '20 days'),
(3,'Formal notice issued to Lagos University Teaching Hospital','NDPC Officer',NOW()-INTERVAL '19 days'),
(3,'Organisation submitted evidence of remediation','LUTH Compliance',NOW()-INTERVAL '10 days'),
(4,'Enforcement case opened for Federal Ministry of Education','NDPC Officer',NOW()-INTERVAL '60 days'),
(4,'Formal notice issued','NDPC Officer',NOW()-INTERVAL '59 days'),
(4,'Penalty of N25M paid in full','FME Finance',NOW()-INTERVAL '20 days'),
(4,'Case closed following full compliance','NDPC Officer',NOW()-INTERVAL '10 days'),
(5,'Enforcement case opened for NNPC','NDPC Officer',NOW()-INTERVAL '15 days'),
(5,'Formal notice issued to NNPC','NDPC Officer',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Financial Ledger ─────────────────────────────────────────────────────────
INSERT INTO financial_ledger (transaction_id, organization_id, penalty_id, violation_id, tx_type, amount, currency, description, status, created_at)
VALUES
('TXN-LED-001',4,4,NULL,'penalty_payment',25000000,'NGN','Penalty payment - NDPC-ENF-2026-004','settled',NOW()-INTERVAL '20 days'),
('TXN-LED-002',1,1,NULL,'penalty_assessment',50000000,'NGN','Penalty assessed for data breach','pending',NOW()-INTERVAL '25 days'),
('TXN-LED-003',2,2,NULL,'penalty_assessment',100000000,'NGN','Penalty assessed for NDPR violations','pending',NOW()-INTERVAL '30 days'),
('TXN-LED-004',3,3,NULL,'penalty_assessment',35000000,'NGN','Penalty assessed for consent violations','pending',NOW()-INTERVAL '20 days'),
('TXN-LED-005',5,5,NULL,'penalty_assessment',15000000,'NGN','Penalty assessed for data transfer violations','pending',NOW()-INTERVAL '15 days'),
('TXN-LED-006',4,4,NULL,'interest_charge',500000,'NGN','Late payment interest charge','settled',NOW()-INTERVAL '15 days'),
('TXN-LED-007',1,NULL,1,'violation_fine',5000000,'NGN','Fine for compliance violation #1','pending',NOW()-INTERVAL '10 days'),
('TXN-LED-008',2,NULL,2,'violation_fine',8000000,'NGN','Fine for compliance violation #2','pending',NOW()-INTERVAL '8 days')
ON CONFLICT DO NOTHING;

-- ─── BGP Routes ───────────────────────────────────────────────────────────────
INSERT INTO bgp_routes (prefix, origin_asn, peer_asn, as_path, next_hop, rpki_status, is_hijacked, is_leaked, is_cross_border, organization_id, ixp_site, community_tags, metadata, detected_at, created_at)
VALUES
('196.46.0.0/16',37148,6453,ARRAY[37148,6453,3356],'196.46.1.1','valid',false,false,false,2,'IXPN Lagos',ARRAY['37148:1000'],'{"description":"MTN Nigeria prefix"}',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days'),
('105.112.0.0/14',29465,6453,ARRAY[29465,6453,3356],'105.112.1.1','valid',false,false,false,2,'IXPN Lagos',ARRAY['29465:1000'],'{"description":"MTN Nigeria prefix 2"}',NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days'),
('41.58.0.0/17',36873,3257,ARRAY[36873,3257,1299],'41.58.1.1','valid',false,false,false,1,'IXPN Lagos',ARRAY['36873:1000'],'{"description":"First Bank prefix"}',NOW()-INTERVAL '25 days',NOW()-INTERVAL '25 days'),
('197.210.0.0/15',37076,6461,ARRAY[37076,6461,3356],'197.210.1.1','valid',false,false,false,3,'IXPN Lagos',ARRAY['37076:1000'],'{"description":"LUTH prefix"}',NOW()-INTERVAL '20 days',NOW()-INTERVAL '20 days'),
('154.67.0.0/16',37282,6453,ARRAY[37282,6453,3356],'154.67.1.1','unknown',false,false,false,4,'IXPN Abuja',ARRAY['37282:1000'],'{"description":"FME prefix"}',NOW()-INTERVAL '15 days',NOW()-INTERVAL '15 days'),
('8.8.8.0/24',15169,3356,ARRAY[15169],'8.8.8.1','valid',false,false,true,NULL,'IXPN Lagos',ARRAY['15169:1000'],'{"description":"Google DNS - cross-border"}',NOW()-INTERVAL '10 days',NOW()-INTERVAL '10 days'),
('196.45.0.0/16',37122,6453,ARRAY[37122,6453,3356],'196.45.1.1','valid',false,false,false,5,'IXPN Lagos',ARRAY['37122:1000'],'{"description":"NNPC prefix"}',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
('203.45.0.0/16',4134,3356,ARRAY[4134,3356],'203.45.1.1','valid',false,false,true,NULL,'IXPN Lagos',ARRAY['4134:1000'],'{"description":"China Telecom - cross-border"}',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── Residency Checks ─────────────────────────────────────────────────────────
INSERT INTO residency_checks (organization_id, data_asset_name, data_classification, storage_location, storage_country, is_within_borders, residency_status, violation_reason, remediation_action, checked_at, created_at)
VALUES
(1,'First Bank Customer Database','tier2_financial','Lagos, Nigeria','Nigeria',true,'compliant',NULL,NULL,NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days'),
(2,'MTN Subscriber PII Database','tier1_pii','Dublin, Ireland','Ireland',false,'non_compliant','Customer PII stored outside Nigeria without NDPC approval','Migrate to Nigerian data centre within 90 days',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(3,'LUTH Patient Health Records','tier3_health','London, UK','United Kingdom',false,'non_compliant','Patient health records stored in UK without adequate safeguards','Implement data localisation or obtain NDPC transfer approval',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(4,'FME Student Records','tier1_pii','Lagos, Nigeria','Nigeria',true,'compliant',NULL,NULL,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(5,'NNPC Operational Data','tier5_public','Houston, USA','United States',false,'non_compliant','Operational data stored in US without proper transfer mechanism','Obtain standard contractual clauses or migrate to Nigeria',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Drift Alerts ─────────────────────────────────────────────────────────────
INSERT INTO drift_alerts (organization_id, drift_type, resource_name, previous_state, current_state, severity, status, detected_by, detected_at)
VALUES
(1,'compliance_score_drop','First Bank Compliance Score','{"score":87}','{"score":72}','high','open','compliance-engine',NOW()-INTERVAL '5 days'),
(2,'new_violation_spike','MTN Nigeria Violations','{"count":5}','{"count":20}','critical','open','compliance-engine',NOW()-INTERVAL '4 days'),
(3,'data_transfer_anomaly','LUTH Data Transfer Volume','{"volume_gb":100}','{"volume_gb":520}','medium','open','residency-enforcer',NOW()-INTERVAL '3 days'),
(4,'policy_change_detected','FME Privacy Policy','{"version":"2.1"}','{"version":"2.2"}','low','resolved','drift-detector',NOW()-INTERVAL '2 days'),
(5,'asset_exposure','NNPC Database Endpoint','{"exposed":false}','{"exposed":true}','high','open','bgp-validator',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Monitoring Snapshots ─────────────────────────────────────────────────────
INSERT INTO monitoring_snapshots (organization_id, compliance_score, previous_score, delta, status, worker_source, details, alert_triggered, captured_at)
VALUES
(1,72,87,-15,'degraded','compliance-engine','{"violation_count":8,"open_cases":2,"pending_actions":5}',true,NOW()-INTERVAL '7 days'),
(2,85,84,1,'healthy','compliance-engine','{"violation_count":3,"open_cases":1,"pending_actions":2}',false,NOW()-INTERVAL '7 days'),
(3,68,75,-7,'degraded','compliance-engine','{"violation_count":12,"open_cases":3,"pending_actions":8}',true,NOW()-INTERVAL '7 days'),
(4,91,88,3,'healthy','compliance-engine','{"violation_count":1,"open_cases":0,"pending_actions":1}',false,NOW()-INTERVAL '7 days'),
(5,78,80,-2,'healthy','compliance-engine','{"violation_count":5,"open_cases":2,"pending_actions":3}',false,NOW()-INTERVAL '7 days'),
(1,72,87,-15,'degraded','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":3,"transfer":2,"breach":3}}',true,NOW()-INTERVAL '14 days'),
(2,85,84,1,'healthy','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":1,"retention":2}}',false,NOW()-INTERVAL '14 days'),
(3,68,75,-7,'degraded','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":5,"breach":4,"transfer":3}}',true,NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Onboarding Phases ────────────────────────────────────────────────────────
-- onboarding_phases: id, submission_id, phase, status, started_at, completed_at, worker_results, notes, created_at
-- We need portal_submissions first — insert them without FK to onboarding_phases
INSERT INTO portal_submissions (submission_token, organization_id, org_name, org_sector, org_country, contact_name, contact_email, contact_phone, current_phase, self_assessment_score, compliance_score, notes, submitted_at, updated_at)
VALUES
('SUB-TOKEN-001',1,'First Bank of Nigeria Plc','Financial Services','Nigeria','Adewale Adeyemi','dpo@firstbank.com','+2348012345678','certified',85,72,'Annual compliance return',NOW()-INTERVAL '30 days',NOW()-INTERVAL '20 days'),
('SUB-TOKEN-002',2,'MTN Nigeria Communications','Telecommunications','Nigeria','Chukwuemeka Obi','dpo@mtn.com','+2348023456789','under_review',80,85,'Data breach notification',NOW()-INTERVAL '15 days',NOW()-INTERVAL '10 days'),
('SUB-TOKEN-003',3,'Lagos University Teaching Hospital','Healthcare','Nigeria','Dr. Amaka Nwosu','dpo@luth.gov.ng','+2348034567890','assessment',70,68,'DPIA submission',NOW()-INTERVAL '25 days',NOW()-INTERVAL '18 days'),
('SUB-TOKEN-004',4,'Federal Ministry of Education','Government','Nigeria','Ibrahim Suleiman','dpo@fme.gov.ng','+2348045678901','certified',90,91,'Privacy policy registration',NOW()-INTERVAL '20 days',NOW()-INTERVAL '15 days'),
('SUB-TOKEN-005',5,'Nigerian National Petroleum Corporation','Energy','Nigeria','Ngozi Okonkwo','dpo@nnpc.gov.ng','+2348056789012','initial',75,78,'Cross-border transfer approval',NOW()-INTERVAL '5 days',NOW()-INTERVAL '3 days'),
('SUB-TOKEN-006',6,'Jumia Technologies AG','E-Commerce','Nigeria','Bisi Okafor','legal@jumia.com','+2348067890123','assessment',65,NULL,'Response to consumer complaint',NOW()-INTERVAL '3 days',NOW()-INTERVAL '2 days')
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
VALUES
(1,'registration','completed',NOW()-INTERVAL '180 days',NOW()-INTERVAL '175 days','Organisation registered successfully',NOW()-INTERVAL '180 days'),
(1,'document_verification','completed',NOW()-INTERVAL '175 days',NOW()-INTERVAL '170 days','CAC certificate and board resolution verified',NOW()-INTERVAL '175 days'),
(1,'dpo_appointment','completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '165 days','DPO appointed and registered',NOW()-INTERVAL '170 days'),
(1,'compliance_assessment','completed',NOW()-INTERVAL '165 days',NOW()-INTERVAL '150 days','Initial compliance assessment completed - score 72',NOW()-INTERVAL '165 days'),
(1,'policy_review','in_progress',NOW()-INTERVAL '150 days',NULL,'Privacy policy under review',NOW()-INTERVAL '150 days'),
(2,'registration','completed',NOW()-INTERVAL '200 days',NOW()-INTERVAL '195 days','Organisation registered successfully',NOW()-INTERVAL '200 days'),
(2,'document_verification','completed',NOW()-INTERVAL '195 days',NOW()-INTERVAL '190 days','All documents verified',NOW()-INTERVAL '195 days'),
(2,'dpo_appointment','completed',NOW()-INTERVAL '190 days',NOW()-INTERVAL '185 days','DPO appointed',NOW()-INTERVAL '190 days'),
(2,'compliance_assessment','completed',NOW()-INTERVAL '185 days',NOW()-INTERVAL '170 days','Assessment completed - score 85',NOW()-INTERVAL '185 days'),
(2,'policy_review','completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '160 days','All policies approved',NOW()-INTERVAL '170 days')
ON CONFLICT DO NOTHING;

-- ─── Compliance Audit Returns ─────────────────────────────────────────────────
INSERT INTO compliance_audit_returns (org_id, reporting_year, title, status, compliance_score, open_violations, breaches_reported, dsars_resolved, submitted_at, created_at)
VALUES
(1,2025,'First Bank Annual Compliance Return 2025','approved',72,8,1,45,'2026-01-31',NOW()-INTERVAL '75 days'),
(2,2025,'MTN Nigeria Annual Compliance Return 2025','approved',85,3,0,120,'2026-01-31',NOW()-INTERVAL '70 days'),
(3,2025,'LUTH Annual Compliance Return 2025','under_review',68,12,2,30,'2026-02-15',NOW()-INTERVAL '55 days'),
(4,2025,'FME Annual Compliance Return 2025','approved',91,1,0,85,'2026-01-31',NOW()-INTERVAL '65 days'),
(5,2025,'NNPC Annual Compliance Return 2025','pending',78,5,1,200,'2026-02-28',NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── Penalty Appeals ──────────────────────────────────────────────────────────
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal, evidence_summary, evidence_urls, requested_outcome, status, created_at)
VALUES
(2,2,'Head of Legal, MTN Nigeria','legal@mtn.com','Disproportionate penalty amount given the nature of the violation and the organisation remediation efforts','Comprehensive remediation plan implemented within 30 days. All affected customers notified.',ARRAY['remediation_plan.pdf','compliance_certificate.pdf'],'Reduction of penalty by 50%','under_review',NOW()-INTERVAL '55 days'),
(3,3,'Director of Administration, LUTH','admin@luth.gov.ng','First-time offence with immediate remediation. Penalty amount exceeds NDPR guidelines for healthcare sector.','DPIA completed and approved. Staff training conducted. Data localisation in progress.',ARRAY['dpia_report.pdf','remediation_evidence.pdf'],'Waiver of penalty given public health mandate','submitted',NOW()-INTERVAL '50 days')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Actions ──────────────────────────────────────────────────────
INSERT INTO enforcement_actions (violation_id, organization_id, workflow_id, action_type, status, notice_issued_at, audit_scheduled_at, penalty_imposed_at, penalty_amount, notes, created_at, updated_at)
VALUES
(1,1,'WF-ENF-001','formal_notice','pending',NOW()-INTERVAL '24 days',NULL,NULL,NULL,'Formal notice issued for data breach',NOW()-INTERVAL '24 days',NOW()-INTERVAL '20 days'),
(2,2,'WF-ENF-002','formal_notice','pending',NOW()-INTERVAL '29 days',NULL,NULL,NULL,'Formal notice issued for NDPR violations',NOW()-INTERVAL '29 days',NOW()-INTERVAL '25 days'),
(3,3,'WF-ENF-003','formal_notice','pending',NOW()-INTERVAL '19 days',NULL,NULL,NULL,'Formal notice issued for consent violations',NOW()-INTERVAL '19 days',NOW()-INTERVAL '15 days'),
(4,4,'WF-ENF-004','penalty_imposed','pending',NULL,NULL,NOW()-INTERVAL '20 days',25000000,'Penalty of N25M imposed and paid',NOW()-INTERVAL '25 days',NOW()-INTERVAL '20 days'),
(5,5,'WF-ENF-005','formal_notice','pending',NOW()-INTERVAL '14 days',NULL,NULL,NULL,'Formal notice issued for data transfer violations',NOW()-INTERVAL '14 days',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Streaming Events ─────────────────────────────────────────────────────────
INSERT INTO streaming_events (topic, source, event_type, payload, processed_at, created_at)
VALUES
('compliance-events','compliance-engine','compliance_violation_detected','{"violation_type":"data_breach","severity":"critical","affected_records":50000,"org_id":1}',NOW()-INTERVAL '29 days 23 hours',NOW()-INTERVAL '30 days'),
('aml-events','aml-scorer','aml_alert_triggered','{"case_ref":"AML-2026-002","risk_score":92,"alert_type":"sanctions_hit"}',NOW()-INTERVAL '27 days 23 hours',NOW()-INTERVAL '28 days'),
('fraud-events','fraud-detection-engine','fraud_alert_raised','{"transaction_ref":"TXN-ZBP-FRAUD-001","risk_score":95,"alert_type":"account_takeover"}',NOW()-INTERVAL '3 days 23 hours',NOW()-INTERVAL '4 days'),
('kyc-events','kyc-analyzer','kyc_verification_completed','{"customer_ref":"CUST-FBN-001","tier":3,"status":"verified"}',NOW()-INTERVAL '5 days 23 hours',NOW()-INTERVAL '6 months'),
('bgp-events','bgp-validator','bgp_route_anomaly','{"prefix":"105.112.0.0/14","anomaly_type":"route_hijack_suspected","asn":29465,"org_id":2}',NOW()-INTERVAL '9 days 23 hours',NOW()-INTERVAL '10 days'),
('residency-events','residency-enforcer','data_residency_violation','{"org_id":2,"violation_type":"cross_border_without_approval","storage_region":"eu-west-1"}',NULL,NOW()-INTERVAL '5 days'),
('enforcement-events','compliance-engine','enforcement_case_escalated','{"case_ref":"NDPC-ENF-2026-002","escalation_reason":"non_response","overdue_days":15,"org_id":2}',NOW()-INTERVAL '14 days 23 hours',NOW()-INTERVAL '15 days'),
('swift-events','swift-gateway','swift_message_held','{"message_ref":"TXN-SWIFT-006","reason":"sanctions_match","bic":"HSBCGB2L"}',NULL,NOW()-INTERVAL '15 days'),
('drift-events','drift-detector','drift_alert_generated','{"alert_type":"compliance_score_drop","from":87,"to":72,"percentage":17.2,"org_id":1}',NOW()-INTERVAL '4 days 23 hours',NOW()-INTERVAL '5 days'),
('worker-events','worker-manager','worker_health_degraded','{"worker_id":"ml-prediction","status":"degraded","port":8085}',NOW()-INTERVAL '1 day 23 hours',NOW()-INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ─── Webhook Subscriptions ────────────────────────────────────────────────────
INSERT INTO webhook_subscriptions (org_id, url, secret, events, is_active, created_at)
VALUES
(1,'https://compliance.firstbank.com/webhooks/ndsep','secret-fbngla-001',ARRAY['compliance_violation','enforcement_action','breach_notification'],true,NOW()-INTERVAL '60 days'),
(2,'https://api.mtn.com/ndsep/events','secret-mtnngla-001',ARRAY['compliance_violation','data_residency_alert','bgp_anomaly'],true,NOW()-INTERVAL '45 days'),
(3,'https://it.luth.gov.ng/ndsep/webhook','secret-luth-001',ARRAY['dpia_status_change','transfer_approval','enforcement_action'],true,NOW()-INTERVAL '30 days'),
(4,'https://systems.fme.gov.ng/ndsep/hook','secret-fme-001',ARRAY['compliance_violation','audit_return_status'],true,NOW()-INTERVAL '20 days'),
(5,'https://digital.nnpc.gov.ng/ndsep/events','secret-nnpc-001',ARRAY['compliance_violation','transfer_approval','enforcement_action'],true,NOW()-INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- ─── Webhook Deliveries ───────────────────────────────────────────────────────
INSERT INTO webhook_deliveries (subscription_id, event_type, payload, status, http_status, response_body, attempt_count, delivered_at, created_at)
VALUES
(1,'compliance_violation','{"event":"compliance_violation","org_id":1,"severity":"critical"}','delivered',200,'{"status":"received"}',1,NOW()-INTERVAL '29 days',NOW()-INTERVAL '30 days'),
(2,'bgp_anomaly','{"event":"bgp_anomaly","prefix":"105.112.0.0/14","asn":29465}','delivered',200,'{"status":"ok"}',1,NOW()-INTERVAL '9 days',NOW()-INTERVAL '10 days'),
(1,'enforcement_action','{"event":"enforcement_action","case_ref":"NDPC-ENF-2026-001"}','failed',500,'{"error":"Internal Server Error"}',3,NULL,NOW()-INTERVAL '24 days'),
(3,'dpia_status_change','{"event":"dpia_status_change","status":"under_review"}','delivered',200,'{"status":"received"}',1,NOW()-INTERVAL '4 days',NOW()-INTERVAL '5 days'),
(5,'transfer_approval','{"event":"transfer_approval","status":"approved"}','delivered',200,'{"status":"ok"}',1,NOW()-INTERVAL '4 days',NOW()-INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Engagements ───────────────────────────────────────────────────
-- Get actual columns: id, dpco_org_id, client_org_id, status, engagement_type, scope, started_at, completed_at, report_url, created_at
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_audit_engagements' AND table_schema='public' ORDER BY ordinal_position;
INSERT INTO dpco_audit_engagements (dpco_org_id, client_org_id, status, engagement_type, scope, started_at, completed_at, report_url, created_at)
SELECT 1, 6, 'completed', 'full_audit', 'Full NDPR compliance audit including data mapping, consent management, and breach response', '2026-01-10', '2026-02-10', 'https://storage.ndsep.ng/reports/ENG-DG-2026-001.pdf', NOW()-INTERVAL '90 days'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id=6)
ON CONFLICT DO NOTHING;

-- ─── DPCO Training Sessions ───────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_training_sessions' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Evidence Items ──────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_evidence_items' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Verification Statements ────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_verification_statements' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_policy_drafts' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Accreditation Applications ─────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_accreditation_applications' AND table_schema='public' ORDER BY ordinal_position;

-- ─── AI Governance Scores ─────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='ai_governance_scores' AND table_schema='public' ORDER BY ordinal_position;

-- ─── In-App Notifications ─────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='in_app_notifications' AND table_schema='public' ORDER BY ordinal_position;

-- ─── Notification Settings ────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='notification_settings' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Audit Control Ratings ───────────────────────────────────────────────
SELECT column_name FROM information_schema.columns WHERE table_name='dpco_audit_control_ratings' AND table_schema='public' ORDER BY ordinal_position;

-- ─── DPCO Audit Logs ──────────────────────────────────────────────────────────
INSERT INTO dpco_audit_logs (dpco_org_id, action, actor_id, details, created_at)
VALUES
(1,'engagement_created',1,'Created audit engagement for First Bank',NOW()-INTERVAL '90 days'),
(1,'report_generated',1,'Generated final audit report for First Bank',NOW()-INTERVAL '63 days'),
(1,'verification_issued',1,'Issued verification statement for First Bank',NOW()-INTERVAL '58 days'),
(2,'engagement_created',1,'Created audit engagement for AIICO Insurance',NOW()-INTERVAL '84 days'),
(2,'report_generated',1,'Generated final audit report for AIICO Insurance',NOW()-INTERVAL '55 days'),
(3,'engagement_created',1,'Created audit engagement for Kuda',NOW()-INTERVAL '35 days'),
(3,'training_scheduled',1,'Scheduled e-commerce privacy training for Jumia',NOW()-INTERVAL '5 days'),
(1,'client_onboarded',1,'Jumia Technologies AG onboarded as DPCO client',NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Risk Predictions ────────────────────────────────────────────────────
INSERT INTO dpco_risk_predictions (organisation_id, risk_score, risk_level, primary_risk_factors, audit_priority, recommended_audit_frequency, mitigation_actions, predicted_at)
VALUES
(1,35,'low',ARRAY['Strong governance framework','Regular staff training','Updated privacy policies'],'low','annual',ARRAY['Continue quarterly reviews','Maintain DPO engagement'],NOW()-INTERVAL '13 days'),
(2,55,'medium',ARRAY['Legacy system retention gaps','Incomplete staff training','Pending policy updates'],'medium','semi_annual',ARRAY['Prioritise legacy system remediation','Complete staff training programme'],NOW()-INTERVAL '13 days'),
(3,65,'medium',ARRAY['DPIA in progress','Cross-border transfer pending approval','New data processing activities'],'medium','quarterly',ARRAY['Complete DPIA','Obtain transfer approval','Update privacy notice'],NOW()-INTERVAL '13 days'),
(4,20,'low',ARRAY['Excellent compliance posture','Strong DPO engagement','Regular audits'],'low','annual',ARRAY['Maintain current practices','Consider advanced certification'],NOW()-INTERVAL '13 days'),
(5,75,'high',ARRAY['Multiple audit findings','Slow remediation pace','Government sector complexity'],'high','quarterly',ARRAY['Accelerate remediation','Engage NDPC proactively','Implement quick wins'],NOW()-INTERVAL '13 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO AI Gap Analyses ─────────────────────────────────────────────────────
-- dpco_ai_gap_analyses: id, engagement_id, overall_score, executive_summary, ratings_json, created_at, updated_at
INSERT INTO dpco_ai_gap_analyses (engagement_id, overall_score, executive_summary, ratings_json, created_at)
VALUES
(1,72,'First Bank demonstrates substantial NDPR compliance with 3 gaps identified requiring remediation.','{"gaps":[{"id":"GAP-001","domain":"consent","description":"Analytics consent not granular","severity":"high"},{"id":"GAP-002","domain":"retention","description":"Retention schedule incomplete for digital channels","severity":"medium"},{"id":"GAP-003","domain":"training","description":"Only 60% of staff completed NDPR training","severity":"medium"}]}',NOW()-INTERVAL '84 days'),
(3,88,'AIICO Insurance demonstrates high compliance with 2 gaps identified.','{"gaps":[{"id":"GAP-001","domain":"retention","description":"Legacy system retention not automated","severity":"high"},{"id":"GAP-002","domain":"vendor_management","description":"Vendor DPA not updated for 3 processors","severity":"medium"}]}',NOW()-INTERVAL '69 days')
ON CONFLICT DO NOTHING;

-- ─── API Keys ─────────────────────────────────────────────────────────────────
-- api_keys: id, user_id, key_hash, key_prefix, is_active, last_used_at, created_at, updated_at
INSERT INTO api_keys (user_id, key_hash, key_prefix, is_active, last_used_at, created_at)
VALUES
(1,'sha256:fbngla-prod-hash-001','fbk_prod_',true,NOW()-INTERVAL '1 hour',NOW()-INTERVAL '90 days'),
(1,'sha256:mtnngla-prod-hash-001','mtn_prod_',true,NOW()-INTERVAL '30 minutes',NOW()-INTERVAL '60 days'),
(1,'sha256:luth-prod-hash-001','lth_prod_',true,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '45 days'),
(1,'sha256:fme-prod-hash-001','fme_prod_',true,NOW()-INTERVAL '6 hours',NOW()-INTERVAL '30 days'),
(1,'sha256:nnpc-prod-hash-001','nnp_prod_',true,NOW()-INTERVAL '3 hours',NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

SELECT 'Seed v3 complete' AS status;
