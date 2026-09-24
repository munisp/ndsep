-- ============================================================
-- NDSEP Remaining Tables Seed Script
-- Covers: kyc_records, fraud_alerts, dpia_assessments,
--         tia_assessments, transfer_approvals, watchlist_entries,
--         dpco_performance_metrics, dpco_audit_logs, dpco_car_narratives,
--         dpco_client_policies, i18n_translations
-- ============================================================

-- ─── KYC Records ─────────────────────────────────────────────────────────────
INSERT INTO kyc_records (bank_id, customer_ref, customer_type, full_name, bvn, nin, date_of_birth, nationality, address, state_of_residence, occupation, annual_income_band, source_of_funds, kyc_tier, kyc_status, risk_rating, pep_flag, sanctions_flag, adverse_media_flag, id_document_type, id_document_number, id_expiry_date, id_verified, liveness_check, address_verified, last_review_date, next_review_date, reviewed_by, created_at)
VALUES
(1,'CUST-FBN-001','individual','Adewale Adeyemi','22345678901','12345678901','1985-03-15','Nigerian','14 Broad Street, Lagos Island, Lagos','Lagos','Banking Professional','5M-10M','Salary',3,'verified','low',false,false,false,'national_id','A12345678','2028-03-15',true,true,true,'2026-01-15','2027-01-15','KYC Officer Tunde',NOW()-INTERVAL '365 days'),
(1,'CUST-FBN-002','individual','Chioma Eze','22345678902','12345678902','1990-07-22','Nigerian','5 Victoria Island, Lagos','Lagos','Entrepreneur','10M-50M','Business Income',3,'verified','medium',false,false,false,'international_passport','A98765432','2027-07-22',true,true,true,'2026-02-01','2027-02-01','KYC Officer Tunde',NOW()-INTERVAL '300 days'),
(1,'CUST-FBN-003','individual','Ibrahim Musa','22345678903','12345678903','1978-11-05','Nigerian','22 Wuse Zone 5, Abuja','FCT','Civil Servant','1M-5M','Salary',2,'verified','low',false,false,false,'drivers_license','DL-2345678','2026-11-05',true,false,true,'2025-11-05','2026-11-05','KYC Officer Amaka',NOW()-INTERVAL '400 days'),
(2,'CUST-MTN-001','individual','Fatima Suleiman','22345678904','12345678904','1992-04-18','Nigerian','8 Kaduna Road, Kaduna','Kaduna','Teacher','500K-1M','Salary',1,'verified','low',false,false,false,'national_id','B23456789','2029-04-18',true,false,false,'2026-01-10','2027-01-10','KYC Officer Bola',NOW()-INTERVAL '200 days'),
(2,'CUST-MTN-002','individual','Emeka Okonkwo','22345678905','12345678905','1975-09-30','Nigerian','3 GRA, Port Harcourt','Rivers','Oil & Gas Engineer','50M-100M','Salary',3,'verified','high',true,false,false,'international_passport','B98765433','2026-09-30',true,true,true,'2026-03-01','2026-09-01','KYC Officer Senior',NOW()-INTERVAL '150 days'),
(3,'CUST-GTB-001','individual','Ngozi Okafor','22345678906','12345678906','1988-12-12','Nigerian','17 Adeola Odeku, Victoria Island, Lagos','Lagos','Lawyer','10M-50M','Professional Fees',3,'verified','medium',false,false,false,'international_passport','C12345678','2028-12-12',true,true,true,'2026-02-15','2027-02-15','KYC Officer Chidi',NOW()-INTERVAL '250 days'),
(3,'CUST-GTB-002','individual','Tunde Balogun','22345678907','12345678907','1965-06-25','Nigerian','45 Ikoyi Crescent, Lagos','Lagos','Retired Director','100M+','Investment Income',3,'verified','high',true,false,false,'international_passport','C98765434','2027-06-25',true,true,true,'2026-03-10','2026-09-10','KYC Officer Senior',NOW()-INTERVAL '100 days'),
(4,'CUST-UBA-001','individual','Amaka Nwosu','22345678908','12345678908','1995-02-28','Nigerian','9 Awolowo Road, Ikoyi, Lagos','Lagos','Software Engineer','5M-10M','Salary',2,'pending','low',false,false,false,'national_id','D23456789','2029-02-28',true,false,false,'2026-04-01','2027-04-01','KYC Officer Bisi',NOW()-INTERVAL '14 days'),
(4,'CUST-UBA-002','individual','Sola Oladipo','22345678909','12345678909','1982-08-14','Nigerian','12 Lekki Phase 1, Lagos','Lagos','Business Owner','10M-50M','Business Income',3,'under_review','medium',false,false,true,'international_passport','D98765435','2027-08-14',true,true,false,'2026-03-20','2026-09-20','KYC Officer Senior',NOW()-INTERVAL '25 days'),
(5,'CUST-ZEN-001','individual','Bisi Okafor','22345678910','12345678910','1970-01-01','Nigerian','33 Broad Street, Lagos Island','Lagos','Politician','100M+','Multiple Sources',3,'flagged','high',true,true,false,'international_passport','E12345678','2026-01-01',true,true,false,'2026-04-01','2026-07-01','KYC Senior Officer',NOW()-INTERVAL '90 days'),
(5,'CUST-ZEN-002','individual','Kelechi Eze','22345678911','12345678911','1993-05-17','Nigerian','6 Maitama, Abuja','FCT','Accountant','5M-10M','Salary',2,'verified','low',false,false,false,'national_id','E98765436','2029-05-17',true,false,true,'2026-01-20','2027-01-20','KYC Officer Tunde',NOW()-INTERVAL '85 days'),
(6,'CUST-ACC-001','individual','Yemi Adesanya','22345678912','12345678912','1987-10-08','Nigerian','21 Allen Avenue, Ikeja, Lagos','Lagos','Medical Doctor','10M-50M','Professional Fees',3,'verified','low',false,false,false,'international_passport','F12345678','2028-10-08',true,true,true,'2026-02-10','2027-02-10','KYC Officer Amaka',NOW()-INTERVAL '65 days'),
(1,'CUST-FBN-004','corporate','First Choice Ventures Ltd','22345678913',NULL,NULL,'Nigerian','55 Marina, Lagos Island, Lagos','Lagos','Trading Company','100M+','Business Revenue',3,'verified','medium',false,false,false,'cac_certificate','CAC-1234567',NULL,true,false,true,'2026-01-05','2027-01-05','KYC Corporate Team',NOW()-INTERVAL '180 days'),
(2,'CUST-MTN-003','individual','Hauwa Ibrahim','22345678914','12345678914','1998-03-22','Nigerian','4 Tudun Wada, Kano','Kano','Student','Below 500K','Family Support',1,'pending','low',false,false,false,'national_id','G23456789','2029-03-22',false,false,false,'2026-04-10','2027-04-10','KYC Officer Bola',NOW()-INTERVAL '5 days'),
(3,'CUST-GTB-003','individual','Chukwuemeka Obi','22345678915','12345678915','1980-07-04','Nigerian','8 Trans-Amadi, Port Harcourt','Rivers','Oil Trader','50M-100M','Trading Income',3,'rejected','high',false,true,true,'international_passport','H12345678','2025-07-04',false,false,false,'2026-03-25','2026-06-25','KYC Senior Officer',NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── Fraud Alerts ─────────────────────────────────────────────────────────────
INSERT INTO fraud_alerts (bank_id, alert_reference, fraud_type, channel, customer_ref, account_number, transaction_ref, amount, currency, risk_score, risk_level, status, detection_method, ml_model_version, rule_triggered, device_fingerprint, ip_address, location, confirmed_fraud, false_positive, customer_notified, card_blocked, account_frozen, investigation_notes, created_at)
VALUES
(1,'FRD-FBN-2026-001','card_not_present','online','CUST-FBN-001','0123456789','TXN-FBN-001',450000,'NGN',87.5,'high','confirmed','ml_model','v2.1.3','velocity_check','FP-ABC123DEF456','105.112.45.67','Lagos, Nigeria',true,false,true,true,false,'Card used for 5 transactions in 10 minutes across different merchants. Customer confirmed fraud.',NOW()-INTERVAL '30 days'),
(1,'FRD-FBN-2026-002','account_takeover','mobile_banking','CUST-FBN-002','0234567890','TXN-FBN-002',2500000,'NGN',92.0,'critical','under_investigation','ml_model','v2.1.3','unusual_login_pattern','FP-XYZ789GHI012','197.210.52.33','Abuja, Nigeria',false,false,true,false,true,'Login from new device in Abuja while customer is in Lagos. Suspicious transfer initiated.',NOW()-INTERVAL '25 days'),
(2,'FRD-MTN-2026-001','sim_swap','mobile_banking','CUST-MTN-001','0345678901','TXN-MTN-001',180000,'NGN',78.0,'high','confirmed','rule_engine','v1.8.2','sim_swap_indicator','FP-LMN345OPQ678','102.89.23.45','Kano, Nigeria',true,false,true,false,false,'SIM swap detected 2 hours before suspicious transactions. Customer confirmed fraud.',NOW()-INTERVAL '20 days'),
(2,'FRD-MTN-2026-002','money_mule','pos','CUST-MTN-002','0456789012','TXN-MTN-002',5000000,'NGN',65.0,'medium','false_positive','ml_model','v2.1.3','large_cash_withdrawal','FP-RST901UVW234','41.58.67.89','Port Harcourt, Nigeria',false,true,false,false,false,'Large POS transaction flagged. Customer confirmed legitimate business payment.',NOW()-INTERVAL '15 days'),
(3,'FRD-GTB-2026-001','phishing','internet_banking','CUST-GTB-001','0567890123','TXN-GTB-001',750000,'NGN',95.0,'critical','confirmed','ml_model','v2.1.3','phishing_pattern','FP-ABC456DEF789','196.207.45.12','Lagos, Nigeria',true,false,true,true,true,'Customer fell victim to phishing. Credentials compromised. Full account freeze initiated.',NOW()-INTERVAL '10 days'),
(3,'FRD-GTB-2026-002','identity_theft','branch','CUST-GTB-002','0678901234','TXN-GTB-002',12000000,'NGN',88.0,'high','under_investigation','rule_engine','v1.8.2','identity_mismatch','FP-GHI012JKL345','102.89.23.46','Lagos, Nigeria',false,false,true,false,true,'Branch transaction with suspected forged ID. Investigation ongoing.',NOW()-INTERVAL '7 days'),
(4,'FRD-UBA-2026-001','card_present','atm','CUST-UBA-001','0789012345','TXN-UBA-001',200000,'NGN',72.0,'high','confirmed','rule_engine','v1.8.2','atm_skimming','FP-MNO678PQR901','41.58.67.90','Abuja, Nigeria',true,false,true,true,false,'ATM skimming device detected. Card cloned and used at multiple ATMs.',NOW()-INTERVAL '5 days'),
(5,'FRD-ZEN-2026-001','business_email_compromise','internet_banking','CUST-ZEN-001','0890123456','TXN-ZEN-001',35000000,'NGN',98.0,'critical','confirmed','ml_model','v2.1.3','bec_pattern','FP-STU234VWX567','197.210.52.34','Lagos, Nigeria',true,false,true,false,true,'BEC attack. Fraudulent invoice payment to overseas account. Funds recovery initiated.',NOW()-INTERVAL '3 days'),
(6,'FRD-ACC-2026-001','insider_fraud','internal','CUST-ACC-001','0901234567','TXN-ACC-001',8500000,'NGN',85.0,'high','under_investigation','rule_engine','v1.8.2','insider_activity','FP-YZA890BCD123','10.0.0.45','Lagos, Nigeria',false,false,false,false,true,'Suspicious internal transaction pattern. Staff member under investigation.',NOW()-INTERVAL '2 days'),
(1,'FRD-FBN-2026-003','card_not_present','online','CUST-FBN-003','0123456790','TXN-FBN-003',125000,'NGN',55.0,'medium','resolved','ml_model','v2.1.3','geo_anomaly','FP-EFG456HIJ789','185.220.101.45','London, UK',false,true,false,false,false,'Transaction from UK flagged. Customer confirmed travelling abroad.',NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── DPIA Assessments ─────────────────────────────────────────────────────────
INSERT INTO dpia_assessments (org_id, title, processing_purpose, data_categories, data_subjects, necessity_score, proportionality_score, risk_level, risk_factors, mitigations, dpo_reviewed_at, dpo_reviewer_id, status, completed_at, created_by, created_at)
VALUES
(1,'First Bank Customer Analytics Platform DPIA','Analyse customer transaction data to provide personalised banking products and detect fraud',
 ARRAY['financial_data','behavioural_data','transaction_history'],
 ARRAY['retail_customers','sme_customers'],
 85,80,'medium',
 '{"factors":["large_scale_processing","profiling","automated_decisions"],"count":3}'::jsonb,
 '{"measures":["pseudonymisation","data_minimisation","opt_out_mechanism","human_review_for_automated_decisions"]}'::jsonb,
 '2026-01-20',1,'approved','2026-01-25',1,NOW()-INTERVAL '90 days'),
(2,'MTN Nigeria Subscriber Profiling DPIA','Profile subscribers for targeted advertising and network optimisation',
 ARRAY['location_data','communication_metadata','behavioural_data'],
 ARRAY['mobile_subscribers'],
 75,70,'high',
 '{"factors":["large_scale_processing","location_tracking","sensitive_data","cross_border_transfer"],"count":4}'::jsonb,
 '{"measures":["explicit_consent","data_minimisation","transfer_safeguards","regular_review"]}'::jsonb,
 '2026-02-10',1,'approved','2026-02-15',1,NOW()-INTERVAL '60 days'),
(3,'LUTH Patient Health Records Digitisation DPIA','Digitise and centralise patient health records for improved care coordination',
 ARRAY['health_data','biometric_data','genetic_data'],
 ARRAY['patients','outpatients'],
 90,85,'critical',
 '{"factors":["special_category_data","health_data","large_scale","vulnerable_subjects"],"count":4}'::jsonb,
 '{"measures":["encryption_at_rest","access_controls","audit_logging","staff_training","breach_response_plan"]}'::jsonb,
 NULL,NULL,'submitted',NULL,1,NOW()-INTERVAL '30 days'),
(4,'FME Student Performance Analytics DPIA','Analyse student performance data to identify at-risk students and improve outcomes',
 ARRAY['educational_records','behavioural_data','minor_data'],
 ARRAY['students','minors'],
 80,75,'high',
 '{"factors":["minor_data","profiling","automated_decisions","educational_impact"],"count":4}'::jsonb,
 '{"measures":["parental_consent","data_minimisation","human_oversight","regular_review"]}'::jsonb,
 '2026-03-01',1,'approved','2026-03-05',1,NOW()-INTERVAL '40 days'),
(5,'NNPC Employee Monitoring System DPIA','Monitor employee communications and activities for security and compliance purposes',
 ARRAY['communication_data','location_data','behavioural_data'],
 ARRAY['employees','contractors'],
 70,65,'medium',
 '{"factors":["employee_monitoring","communication_interception","chilling_effect"],"count":3}'::jsonb,
 '{"measures":["clear_policy","proportionate_monitoring","employee_notification","data_minimisation"]}'::jsonb,
 '2026-03-15',1,'approved','2026-03-20',1,NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── Transfer Approvals ───────────────────────────────────────────────────────
INSERT INTO transfer_approvals (reference_id, organization_id, dataset_name, destination_country, destination_entity, volume_gb, data_classification, business_justification, transfer_method, encryption_method, status, risk_score, requested_at, created_at)
VALUES
('XFER-2026-001',2,'MTN Nigeria Subscriber Data Subset','ZA','MTN South Africa (Pty) Ltd',125.5,'tier1_pii','Shared network infrastructure and roaming agreement requires subscriber data sharing for billing and fraud prevention','sftp_encrypted','AES-256','pending',65.0,NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
('XFER-2026-002',3,'LUTH Patient Research Dataset','GB','University College London Hospital NHS Trust',2.3,'tier3_health','Joint medical research study on tropical diseases. Anonymised dataset for academic research purposes.','secure_api','TLS-1.3','under_review',72.0,NOW()-INTERVAL '15 days',NOW()-INTERVAL '15 days'),
('XFER-2026-003',5,'NNPC Operational Data Backup','US','Amazon Web Services (AWS) US-East-1',850.0,'tier4_government','Disaster recovery backup to AWS. Data sovereignty concerns raised. Alternative Nigerian cloud provider being evaluated.','cloud_sync','AES-256','pending',88.0,NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
('XFER-2026-004',1,'First Bank Transaction Analytics','IE','Accenture Ireland Analytics Centre',45.0,'tier2_financial','Analytics processing for fraud detection model training. Pseudonymised dataset.','sftp_encrypted','AES-256','approved',45.0,NOW()-INTERVAL '60 days',NOW()-INTERVAL '60 days'),
('XFER-2026-005',4,'FME Student Records for UNESCO Study','FR','UNESCO Paris Headquarters',0.5,'tier1_pii','UNESCO global education study. Aggregated and anonymised student performance data.','secure_api','TLS-1.3','approved',30.0,NOW()-INTERVAL '90 days',NOW()-INTERVAL '90 days'),
('XFER-2026-006',2,'MTN Nigeria Call Records','US','Subex Inc (Fraud Management Vendor)',15.0,'tier1_pii','Fraud management system vendor requires call record samples for model training.','sftp_encrypted','AES-256','denied',85.0,NOW()-INTERVAL '45 days',NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── TIA Assessments ──────────────────────────────────────────────────────────
INSERT INTO tia_assessments (transfer_approval_id, organization_id, data_categories, destination_country, legal_basis, risk_level, status, tia_document, safeguards, created_at)
SELECT ta.id, ta.organization_id,
 '{"categories":["subscriber_pii","billing_data","location_data"]}'::jsonb,
 'ZA','adequacy_decision_pending','high','submitted',
 'Transfer Impact Assessment for MTN Nigeria Subscriber Data to South Africa. South Africa has POPIA which provides adequate protection. Standard Contractual Clauses to be executed as additional safeguard.',
 'Standard Contractual Clauses (SCCs), Data Processing Agreement, Encryption in transit and at rest',
 NOW()-INTERVAL '5 days'
FROM transfer_approvals ta WHERE ta.reference_id='XFER-2026-001'
ON CONFLICT DO NOTHING;

INSERT INTO tia_assessments (transfer_approval_id, organization_id, data_categories, destination_country, legal_basis, risk_level, status, tia_document, safeguards, created_at)
SELECT ta.id, ta.organization_id,
 '{"categories":["health_data","research_data"]}'::jsonb,
 'GB','research_exception','medium','submitted',
 'Transfer Impact Assessment for LUTH Patient Research Dataset to UK. UK GDPR provides adequate protection post-Brexit. Research exception applies for anonymised data.',
 'Data anonymisation, Research ethics approval, Data Processing Agreement, UK GDPR adequacy',
 NOW()-INTERVAL '15 days'
FROM transfer_approvals ta WHERE ta.reference_id='XFER-2026-002'
ON CONFLICT DO NOTHING;

INSERT INTO tia_assessments (transfer_approval_id, organization_id, data_categories, destination_country, legal_basis, risk_level, status, tia_document, safeguards, created_at)
SELECT ta.id, ta.organization_id,
 '{"categories":["government_data","operational_data"]}'::jsonb,
 'US','contractual_necessity','critical','draft',
 'Transfer Impact Assessment for NNPC Operational Data to US (AWS). US does not have adequacy decision. CLOUD Act poses significant risk to Nigerian government data. Recommend migration to local cloud provider.',
 'Encryption at rest and in transit, Data residency controls, Legal review of CLOUD Act implications',
 NOW()-INTERVAL '3 days'
FROM transfer_approvals ta WHERE ta.reference_id='XFER-2026-003'
ON CONFLICT DO NOTHING;

-- ─── Watchlist Entries ────────────────────────────────────────────────────────
INSERT INTO watchlist_entries (list_source, list_type, entity_type, full_name, aliases, date_of_birth, nationality, id_numbers, addresses, reason, designation_date, status, ofac_sdn, un_consolidated, eu_consolidated, uk_hmt, nfiu_list, terrorism_link, pep_link, created_at)
VALUES
('OFAC','SDN','individual','Mustapha Al-Rashid',
 '["Mustapha Rashid","M. Al-Rashid","Abu Mustapha"]'::jsonb,
 '1972-05-15','Syrian',
 '{"passport":"SY1234567","national_id":"SY-9876543"}'::jsonb,
 '[{"country":"Syria","city":"Damascus"},{"country":"Turkey","city":"Istanbul"}]'::jsonb,
 'Designated for financing terrorism and providing material support to designated terrorist organisations',
 '2019-03-22','active',true,true,true,true,false,true,false,NOW()-INTERVAL '500 days'),
('OFAC','SDN','individual','Viktor Petrov',
 '["Victor Petrov","V. Petrov"]'::jsonb,
 '1968-11-30','Russian',
 '{"passport":"RU9876543"}'::jsonb,
 '[{"country":"Russia","city":"Moscow"},{"country":"Cyprus","city":"Limassol"}]'::jsonb,
 'Designated for involvement in malicious cyber activities and election interference',
 '2020-07-15','active',true,false,true,true,false,false,false,NOW()-INTERVAL '400 days'),
('UN','Consolidated','entity','Al-Nusra Front Trading LLC',
 '["ANF Trading","Al-Nusra Commercial"]'::jsonb,
 NULL,'Syrian',
 '{"company_reg":"SY-LLC-12345"}'::jsonb,
 '[{"country":"Syria","city":"Aleppo"}]'::jsonb,
 'Front company for designated terrorist organisation Al-Nusra Front',
 '2018-09-10','active',true,true,true,true,false,true,false,NOW()-INTERVAL '600 days'),
('NFIU','Nigerian_Watchlist','individual','Emeka Corrupt-Official',
 '["E.C. Official","Emeka C.O."]'::jsonb,
 '1960-04-01','Nigerian',
 '{"national_id":"NG-1234567","bvn":"22345678999"}'::jsonb,
 '[{"country":"Nigeria","city":"Abuja"},{"country":"UAE","city":"Dubai"}]'::jsonb,
 'Former government official under investigation for money laundering and corruption',
 '2022-01-15','active',false,false,false,false,true,false,true,NOW()-INTERVAL '300 days'),
('EU','Consolidated','individual','Aleksandr Novikov',
 '["A. Novikov","Alexander Novikov"]'::jsonb,
 '1975-08-22','Russian',
 '{"passport":"RU5678901"}'::jsonb,
 '[{"country":"Russia","city":"St. Petersburg"}]'::jsonb,
 'Designated for destabilising activities in Ukraine and violation of territorial integrity',
 '2022-03-01','active',false,false,true,true,false,false,false,NOW()-INTERVAL '250 days'),
('OFAC','SDN','entity','Crimson Shield Finance Ltd',
 '["CSF Ltd","Crimson Finance"]'::jsonb,
 NULL,'British Virgin Islands',
 '{"company_reg":"BVI-987654"}'::jsonb,
 '[{"country":"BVI","city":"Road Town"},{"country":"UAE","city":"Dubai"}]'::jsonb,
 'Shell company used for sanctions evasion and money laundering for designated individuals',
 '2021-06-30','active',true,false,true,true,false,false,false,NOW()-INTERVAL '350 days'),
('UK_HMT','UK_Sanctions','individual','Zhao Wei',
 '["Wei Zhao","Z. Wei"]'::jsonb,
 '1980-02-14','Chinese',
 '{"passport":"CN1234567"}'::jsonb,
 '[{"country":"China","city":"Beijing"},{"country":"Hong Kong","city":"Central"}]'::jsonb,
 'Designated for human rights violations and involvement in forced labour programmes',
 '2021-03-22','active',false,false,true,true,false,false,false,NOW()-INTERVAL '280 days'),
('NFIU','Nigerian_Watchlist','individual','Abubakar Lawal Musa',
 '["A.L. Musa","Alhaji Abubakar"]'::jsonb,
 '1955-12-25','Nigerian',
 '{"national_id":"NG-7654321","bvn":"22345679000"}'::jsonb,
 '[{"country":"Nigeria","city":"Kano"},{"country":"Saudi Arabia","city":"Jeddah"}]'::jsonb,
 'PEP - Senior government official with unexplained wealth. Enhanced due diligence required.',
 '2023-05-10','active',false,false,false,false,true,false,true,NOW()-INTERVAL '180 days'),
('OFAC','SDN','entity','Golden Star Resources Ltd',
 '["GSR Ltd","Golden Star Mining"]'::jsonb,
 NULL,'Liberian',
 '{"company_reg":"LR-234567"}'::jsonb,
 '[{"country":"Liberia","city":"Monrovia"},{"country":"Nigeria","city":"Lagos"}]'::jsonb,
 'Designated for conflict financing and illegal exploitation of natural resources',
 '2020-11-15','active',true,true,false,false,false,false,false,NOW()-INTERVAL '320 days'),
('UN','Consolidated','individual','Hassan Al-Zawahiri',
 '["H. Zawahiri","Abu Hassan"]'::jsonb,
 '1965-07-07','Egyptian',
 '{"passport":"EG9876543"}'::jsonb,
 '[{"country":"Egypt","city":"Cairo"},{"country":"Pakistan","city":"Karachi"}]'::jsonb,
 'Designated for leadership role in Al-Qaeda affiliated organisation',
 '2015-04-01','active',true,true,true,true,false,true,false,NOW()-INTERVAL '800 days'),
('NFIU','Nigerian_Watchlist','individual','Chukwuemeka Obi-Fraud',
 '["C.O. Fraud","Emeka Obi"]'::jsonb,
 '1985-09-15','Nigerian',
 '{"national_id":"NG-3456789","bvn":"22345679001"}'::jsonb,
 '[{"country":"Nigeria","city":"Port Harcourt"}]'::jsonb,
 'Convicted of advance fee fraud (419). Released on parole. Enhanced monitoring required.',
 '2024-01-20','active',false,false,false,false,true,false,false,NOW()-INTERVAL '85 days'),
('EU','Consolidated','entity','Novatek Gas & Power GmbH',
 '["Novatek GmbH","NGP GmbH"]'::jsonb,
 NULL,'German',
 '{"company_reg":"DE-HRB-123456"}'::jsonb,
 '[{"country":"Germany","city":"Hamburg"},{"country":"Russia","city":"Moscow"}]'::jsonb,
 'Subsidiary of sanctioned Russian energy company. Subject to EU sectoral sanctions.',
 '2022-04-15','active',false,false,true,true,false,false,false,NOW()-INTERVAL '240 days'),
('OFAC','SDN','individual','Carlos Medina Escobar',
 '["C. Medina","Carlos Escobar"]'::jsonb,
 '1978-03-18','Colombian',
 '{"passport":"CO1234567"}'::jsonb,
 '[{"country":"Colombia","city":"Medellin"},{"country":"Panama","city":"Panama City"}]'::jsonb,
 'Designated for narcotics trafficking and money laundering through Nigerian financial system',
 '2019-08-22','active',true,false,false,false,false,false,false,NOW()-INTERVAL '450 days'),
('NFIU','Nigerian_Watchlist','entity','Phantom Holdings Ltd',
 '["Phantom Ltd","PHL Nigeria"]'::jsonb,
 NULL,'Nigerian',
 '{"company_reg":"RC-9876543"}'::jsonb,
 '[{"country":"Nigeria","city":"Lagos"}]'::jsonb,
 'Shell company used for layering proceeds of cybercrime. Directors under EFCC investigation.',
 '2024-06-01','active',false,false,false,false,true,false,false,NOW()-INTERVAL '45 days'),
('UK_HMT','UK_Sanctions','individual','Sergei Volkov',
 '["S. Volkov","Sergey Volkov"]'::jsonb,
 '1970-12-05','Russian',
 '{"passport":"RU3456789"}'::jsonb,
 '[{"country":"Russia","city":"Moscow"},{"country":"UAE","city":"Abu Dhabi"}]'::jsonb,
 'Designated for providing financial services to sanctioned Russian entities',
 '2023-02-28','active',false,false,true,true,false,false,false,NOW()-INTERVAL '200 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Performance Metrics ─────────────────────────────────────────────────
INSERT INTO dpco_performance_metrics (dpco_org_id, metric_name, metric_value, period_start, period_end, recorded_at)
VALUES
-- DataGuard Nigeria (dpco_org_id=1)
(1,'total_clients',6,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'active_engagements',3,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'completed_engagements',2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'avg_compliance_score',78.5,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'verification_statements_issued',2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'training_sessions_conducted',3,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'total_participants_trained',115,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'revenue_ngn',18500000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'client_satisfaction_score',4.2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'sla_compliance_rate',95.0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
-- Q4 2025 metrics
(1,'total_clients',5,'2025-10-01','2025-12-31',NOW()-INTERVAL '105 days'),
(1,'active_engagements',4,'2025-10-01','2025-12-31',NOW()-INTERVAL '105 days'),
(1,'completed_engagements',3,'2025-10-01','2025-12-31',NOW()-INTERVAL '105 days'),
(1,'avg_compliance_score',75.0,'2025-10-01','2025-12-31',NOW()-INTERVAL '105 days'),
(1,'revenue_ngn',15000000,'2025-10-01','2025-12-31',NOW()-INTERVAL '105 days'),
-- Privacy Shield Consulting (dpco_org_id=2)
(2,'total_clients',2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'active_engagements',2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'completed_engagements',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'avg_compliance_score',80.0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'verification_statements_issued',0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'training_sessions_conducted',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'revenue_ngn',8000000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'client_satisfaction_score',3.8,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'sla_compliance_rate',88.0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
-- Compliance Nexus Africa (dpco_org_id=3)
(3,'total_clients',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'active_engagements',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'completed_engagements',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'avg_compliance_score',88.0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'verification_statements_issued',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'training_sessions_conducted',1,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'revenue_ngn',5500000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'client_satisfaction_score',4.5,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'sla_compliance_rate',100.0,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Logs ──────────────────────────────────────────────────────────
INSERT INTO dpco_audit_logs (dpco_org_id, action, actor_id, details, created_at)
VALUES
(1,'engagement_created',1,'{"engagement_id":1,"client":"First Bank","title":"First Bank NDPR Full Compliance Audit 2025"}'::jsonb,NOW()-INTERVAL '180 days'),
(1,'fieldwork_started',1,'{"engagement_id":1,"date":"2025-10-05"}'::jsonb,NOW()-INTERVAL '175 days'),
(1,'evidence_uploaded',1,'{"engagement_id":1,"evidence_count":3,"uploaded_by":"Adewale Adeyemi"}'::jsonb,NOW()-INTERVAL '160 days'),
(1,'report_generated',1,'{"engagement_id":1,"report_type":"final","findings":8}'::jsonb,NOW()-INTERVAL '153 days'),
(1,'verification_issued',1,'{"engagement_id":1,"statement_ref":"VS-2026-FBN-001"}'::jsonb,NOW()-INTERVAL '88 days'),
(1,'engagement_created',1,'{"engagement_id":2,"client":"AIICO Insurance","title":"AIICO Insurance NDPR Compliance Audit 2025"}'::jsonb,NOW()-INTERVAL '150 days'),
(1,'report_generated',1,'{"engagement_id":2,"report_type":"final","findings":4}'::jsonb,NOW()-INTERVAL '121 days'),
(1,'verification_issued',1,'{"engagement_id":2,"statement_ref":"VS-2026-AIICO-001"}'::jsonb,NOW()-INTERVAL '75 days'),
(1,'engagement_created',1,'{"engagement_id":3,"client":"Kuda Bank","title":"Kuda Bank Privacy Programme Review"}'::jsonb,NOW()-INTERVAL '68 days'),
(1,'client_onboarded',1,'{"client_id":1,"org_name":"First Bank of Nigeria Plc"}'::jsonb,NOW()-INTERVAL '300 days'),
(2,'engagement_created',1,'{"engagement_id":4,"client":"Jumia","title":"Jumia E-Commerce Privacy Audit"}'::jsonb,NOW()-INTERVAL '14 days'),
(2,'engagement_created',1,'{"engagement_id":5,"client":"Flutterwave","title":"Flutterwave Fintech Compliance Audit"}'::jsonb,NOW()-INTERVAL '90 days'),
(2,'report_generated',1,'{"engagement_id":5,"report_type":"draft","findings":5}'::jsonb,NOW()-INTERVAL '35 days'),
(3,'engagement_created',1,'{"engagement_id":6,"client":"Lagos State Government","title":"Lagos State Government NDPA Readiness Assessment"}'::jsonb,NOW()-INTERVAL '75 days'),
(3,'verification_issued',1,'{"engagement_id":6,"statement_ref":"VS-2026-LASGOV-001"}'::jsonb,NOW()-INTERVAL '67 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO CAR Narratives ──────────────────────────────────────────────────────
INSERT INTO dpco_car_narratives (engagement_id, finding_ref, description, root_cause, recommended_action, management_response, target_date, status, created_at)
VALUES
(1,'CAR-FBN-001','Analytics consent mechanism lacks granularity — users cannot selectively consent to analytics vs. marketing cookies','Privacy-by-design not implemented during platform development. Consent mechanism was a single opt-in.','Implement granular consent management platform (CMP) with separate toggles for each processing purpose','Management agrees to implement Cookiebot or equivalent CMP within 90 days','2026-04-30','open',NOW()-INTERVAL '153 days'),
(1,'CAR-FBN-002','Data processing register incomplete — digital banking channels not documented','Rapid digital transformation outpaced documentation processes','Update data processing register to include all digital channels. Assign data mapping owner.','Management agrees. DPO to lead data mapping exercise.','2026-03-31','in_progress',NOW()-INTERVAL '153 days'),
(1,'CAR-FBN-003','Data breach response plan not tested in last 12 months','Plan exists but no tabletop exercise conducted','Conduct annual tabletop breach simulation exercise. Document results.','Management agrees to schedule exercise in Q2 2026.','2026-06-30','open',NOW()-INTERVAL '153 days'),
(2,'CAR-AIICO-001','Legacy system retention not automated — manual deletion process prone to error','Legacy policy administration system predates NDPR. No API for automated deletion.','Implement automated data retention enforcement in legacy system or migrate to modern platform.','Management agrees. IT project initiated for legacy system migration.','2026-12-31','in_progress',NOW()-INTERVAL '121 days'),
(2,'CAR-AIICO-002','3 vendor DPAs require renewal — contracts expired','Annual contract renewal process did not flag DPA expiry','Update vendor management process to include DPA renewal tracking. Renew 3 outstanding DPAs.','Management agrees. Legal team to renew DPAs within 30 days.','2026-02-28','closed',NOW()-INTERVAL '121 days'),
(6,'CAR-LASGOV-001','Privacy notice for e-Government portal not accessible in local languages','Portal designed for English-speaking users only','Translate privacy notice into Yoruba, Hausa, and Igbo. Add language selector to portal.','Management agrees. Translation project to be initiated.','2026-06-30','open',NOW()-INTERVAL '75 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Client Policies ─────────────────────────────────────────────────────
INSERT INTO dpco_client_policies (dpco_org_id, client_org_id, policy_type, title, version, status, effective_date, review_date, file_url, created_at)
VALUES
(1,1,'privacy_policy','First Bank Privacy Policy','3.2','active','2025-07-01','2026-07-01','https://storage.ndsep.ng/policies/fbngla-privacy-policy-v3.2.pdf',NOW()-INTERVAL '280 days'),
(1,1,'data_retention_policy','First Bank Data Retention Policy','4.0','active','2026-01-20','2027-01-20','https://storage.ndsep.ng/policies/fbngla-retention-policy-v4.0.pdf',NOW()-INTERVAL '85 days'),
(1,2,'privacy_policy','AIICO Insurance Privacy Notice','2.1','active','2025-09-01','2026-09-01','https://storage.ndsep.ng/policies/aiico-privacy-notice-v2.1.pdf',NOW()-INTERVAL '225 days'),
(1,3,'privacy_policy','Kuda Bank Privacy Notice','2.1','draft',NULL,'2026-06-01','https://storage.ndsep.ng/policies/kuda-privacy-notice-v2.1-draft.pdf',NOW()-INTERVAL '45 days'),
(2,4,'cookie_policy','Jumia Cookie Policy','1.0','under_review',NULL,'2026-05-01','https://storage.ndsep.ng/policies/jumia-cookie-policy-v1.0.pdf',NOW()-INTERVAL '20 days'),
(3,6,'privacy_policy','Lagos State Government Privacy Policy','1.0','active','2026-02-01','2027-02-01','https://storage.ndsep.ng/policies/lasgov-privacy-policy-v1.0.pdf',NOW()-INTERVAL '73 days')
ON CONFLICT DO NOTHING;

-- ─── i18n Translations ────────────────────────────────────────────────────────
INSERT INTO i18n_translations (locale, namespace, key, value, created_at)
VALUES
('yo','common','app.title','Eto Imuse Ominira Data ti Orilede','2026-01-01'),
('yo','common','nav.dashboard','Pẹpẹ Iṣakoso','2026-01-01'),
('yo','common','nav.compliance','Ibamu','2026-01-01'),
('yo','common','nav.enforcement','Imuse','2026-01-01'),
('yo','common','nav.penalties','Ijiya','2026-01-01'),
('ha','common','app.title','Tsarin Aiwatar da Sirrin Bayanai na Kasa','2026-01-01'),
('ha','common','nav.dashboard','Allon Sarrafa','2026-01-01'),
('ha','common','nav.compliance','Bin Doka','2026-01-01'),
('ha','common','nav.enforcement','Aiwatarwa','2026-01-01'),
('ha','common','nav.penalties','Hukunci','2026-01-01'),
('ig','common','app.title','Usoro Mmejuputa Nzuzo Data Nke Obodo','2026-01-01'),
('ig','common','nav.dashboard','Ọnụ Ọgụgụ','2026-01-01'),
('ig','common','nav.compliance','Idobe Iwu','2026-01-01'),
('ig','common','nav.enforcement','Mmejuputa','2026-01-01'),
('ig','common','nav.penalties','Ntaramahụhụ','2026-01-01'),
('en','common','app.title','National Data Sovereignty Enforcement Platform','2026-01-01'),
('en','common','nav.dashboard','Dashboard','2026-01-01'),
('en','common','nav.compliance','Compliance','2026-01-01'),
('en','common','nav.enforcement','Enforcement','2026-01-01'),
('en','common','nav.penalties','Penalties','2026-01-01'),
('en','common','status.compliant','Compliant','2026-01-01'),
('en','common','status.non_compliant','Non-Compliant','2026-01-01'),
('en','common','status.under_review','Under Review','2026-01-01'),
('en','common','status.pending','Pending','2026-01-01'),
('en','common','status.approved','Approved','2026-01-01'),
('en','common','status.rejected','Rejected','2026-01-01')
ON CONFLICT DO NOTHING;

SELECT 'Remaining tables seed complete' AS status;
