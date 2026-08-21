-- ============================================================
-- NDSEP Comprehensive Seed Script v2 — Matches Actual Schema
-- ============================================================

-- Run each section independently to avoid transaction rollback cascade

-- ─── Banking Institutions ────────────────────────────────────────────────────
INSERT INTO banking_institutions (name, cbn_license_number, institution_type, bvn_integration, nin_integration, swift_bic, nip_member_code, rtgs_member_code, cbn_category, status, headquarters_state, total_assets_ngn, capital_adequacy_ratio, aml_risk_rating, correspondent_count, created_at)
VALUES
('First Bank of Nigeria Plc','RC 6290','commercial_bank',true,true,'FBNINGLA','011','011','tier1','active','Lagos',8200000000000,18.5,'low',45,NOW()-INTERVAL '10 years'),
('Zenith Bank Plc','RC 84818','commercial_bank',true,true,'ZEIBNGLA','057','057','tier1','active','Lagos',9800000000000,20.1,'low',38,NOW()-INTERVAL '9 years'),
('Guaranty Trust Bank Plc','RC 152321','commercial_bank',true,true,'GTBINGLA','058','058','tier1','active','Lagos',7500000000000,22.3,'low',42,NOW()-INTERVAL '8 years'),
('Access Bank Plc','RC 125384','commercial_bank',true,true,'ABNGNGLA','044','044','tier1','active','Lagos',12000000000000,17.8,'low',55,NOW()-INTERVAL '7 years'),
('United Bank for Africa Plc','RC 2457','commercial_bank',true,true,'UNAFNGLA','033','033','tier1','active','Lagos',8900000000000,19.2,'low',40,NOW()-INTERVAL '6 years'),
('Stanbic IBTC Bank Plc','RC 125097','commercial_bank',true,true,'SBICNGLA','221','221','tier2','active','Lagos',4200000000000,21.5,'low',22,NOW()-INTERVAL '5 years'),
('Fidelity Bank Plc','RC 103022','commercial_bank',true,true,'FIDTNGLA','070','070','tier2','active','Lagos',3100000000000,16.9,'low',18,NOW()-INTERVAL '5 years'),
('Union Bank of Nigeria Plc','RC 2337','commercial_bank',true,false,'UBNINGLA','032','032','tier2','active','Lagos',2800000000000,15.4,'medium',15,NOW()-INTERVAL '4 years'),
('Sterling Bank Plc','RC 485047','commercial_bank',true,false,'NAMENGLA','232','232','tier3','active','Lagos',1400000000000,14.8,'medium',8,NOW()-INTERVAL '4 years'),
('Wema Bank Plc','RC 5754','commercial_bank',true,false,'WEMANGLA','035','035','tier3','active','Lagos',1200000000000,14.2,'medium',6,NOW()-INTERVAL '3 years'),
('Keystone Bank Ltd','RC 1002','commercial_bank',false,false,'PLNINGLA','082','082','tier3','active','Lagos',900000000000,13.5,'medium',5,NOW()-INTERVAL '3 years'),
('Polaris Bank Ltd','RC 1000','commercial_bank',false,false,'POLBNGLA','076','076','tier3','active','Lagos',850000000000,13.1,'medium',4,NOW()-INTERVAL '2 years'),
('Providus Bank Ltd','RC 1650','commercial_bank',false,false,'PROVNGLA','101','101','tier3','active','Lagos',600000000000,12.8,'medium',3,NOW()-INTERVAL '2 years'),
('Jaiz Bank Plc','RC 892882','non_interest_bank',false,false,'JAIZNGLA','301','301','tier3','active','Abuja',350000000000,18.0,'low',2,NOW()-INTERVAL '2 years'),
('Opay Digital Services Ltd','RC 1604','microfinance_bank',true,true,'OPAYNGLA','999','999','tier3','active','Lagos',200000000000,25.0,'low',0,NOW()-INTERVAL '1 year'),
('Kuda Microfinance Bank','RC 1600','microfinance_bank',true,true,'KUDANGLA','998','998','tier3','active','Lagos',150000000000,28.0,'low',0,NOW()-INTERVAL '1 year'),
('Moniepoint Microfinance Bank','RC 1700','microfinance_bank',true,true,'MONPNGLA','997','997','tier3','active','Lagos',180000000000,26.5,'low',0,NOW()-INTERVAL '1 year'),
('PalmPay Ltd','RC 1800','microfinance_bank',true,true,'PALPNGLA','996','996','tier3','active','Lagos',120000000000,24.0,'low',0,NOW()-INTERVAL '6 months'),
('Carbon (One Finance Ltd)','RC 1900','microfinance_bank',true,false,'CARBNGLA','995','995','tier3','active','Lagos',90000000000,22.5,'low',0,NOW()-INTERVAL '6 months'),
('VFD Microfinance Bank','RC 2000','microfinance_bank',true,false,'VFDMNGLA','994','994','tier3','active','Lagos',70000000000,20.0,'low',0,NOW()-INTERVAL '3 months')
ON CONFLICT DO NOTHING;

-- ─── KYC Records ─────────────────────────────────────────────────────────────
INSERT INTO kyc_records (bank_id, customer_ref, customer_type, full_name, bvn, nin, date_of_birth, nationality, address, state_of_residence, occupation, annual_income_band, source_of_funds, kyc_tier, kyc_status, risk_rating, pep_flag, sanctions_flag, adverse_media_flag, id_document_type, id_document_number, id_expiry_date, id_verified, liveness_check, address_verified, last_review_date, next_review_date, created_at)
VALUES
(1,'CUST-FBN-001','individual','Adebayo Okafor','22234567890','12345678901','1985-03-15','Nigerian','15 Broad Street, Lagos Island','Lagos','Business Executive','10m_plus','business_income','tier3','verified','low',false,false,false,'national_id','A12345678','2028-03-15',true,true,true,NOW()-INTERVAL '6 months',NOW()+INTERVAL '6 months',NOW()-INTERVAL '6 months'),
(1,'CUST-FBN-002','individual','Ngozi Adeyemi','22345678901','23456789012','1990-07-22','Nigerian','42 Victoria Island, Lagos','Lagos','Lawyer','5m_10m','salary','tier3','verified','low',false,false,false,'drivers_license','DL987654321','2027-07-22',true,true,true,NOW()-INTERVAL '5 months',NOW()+INTERVAL '7 months',NOW()-INTERVAL '5 months'),
(2,'CUST-ZBP-001','individual','Emeka Nwosu','22456789012','34567890123','1978-11-08','Nigerian','8 Adeola Odeku Street, VI','Lagos','Oil Executive','10m_plus','business_income','tier3','verified','low',false,false,false,'passport','A00123456','2029-11-08',true,true,true,NOW()-INTERVAL '4 months',NOW()+INTERVAL '8 months',NOW()-INTERVAL '4 months'),
(3,'CUST-GTB-001','individual','Fatima Al-Hassan','22567890123','45678901234','1995-02-14','Nigerian','12 Ahmadu Bello Way, Abuja','FCT','Civil Servant','2m_5m','salary','tier2','verified','medium',true,false,false,'national_id','B23456789','2027-02-14',true,true,false,NOW()-INTERVAL '3 months',NOW()+INTERVAL '9 months',NOW()-INTERVAL '3 months'),
(4,'CUST-ACC-001','individual','Chukwuemeka Eze','22678901234','56789012345','1982-09-30','Nigerian','5 Rumuola Road, Port Harcourt','Rivers','Contractor','5m_10m','business_income','tier2','pending','medium',false,false,false,'drivers_license','DL123456789','2026-09-30',true,false,false,NOW()-INTERVAL '2 months',NOW()+INTERVAL '10 months',NOW()-INTERVAL '2 months'),
(5,'CUST-UBA-001','individual','Aisha Mohammed','22789012345','67890123456','1993-05-18','Nigerian','22 Ahmadu Bello Way, Kaduna','Kaduna','Teacher','1m_2m','salary','tier3','verified','low',false,false,false,'national_id','C34567890','2028-05-18',true,true,true,NOW()-INTERVAL '2 months',NOW()+INTERVAL '10 months',NOW()-INTERVAL '2 months'),
(1,'CUST-FBN-003','individual','Oluwaseun Adebisi','22890123456','78901234567','1988-12-25','Nigerian','33 Opebi Road, Ikeja','Lagos','Entrepreneur','5m_10m','business_income','tier3','verified','low',false,false,false,'passport','A11234567','2030-12-25',true,true,true,NOW()-INTERVAL '1 month',NOW()+INTERVAL '11 months',NOW()-INTERVAL '1 month'),
(2,'CUST-ZBP-002','individual','Babatunde Fashola','22901234567','89012345678','1975-04-03','Nigerian','7 Adeola Hopewell Street, VI','Lagos','Former Minister','10m_plus','investments','tier3','verified','high',true,false,true,NOW()-INTERVAL '3 weeks',NOW()+INTERVAL '9 months',NOW()-INTERVAL '3 weeks'),
(3,'CUST-GTB-002','individual','Chiamaka Obi','23012345678','90123456789','1997-08-11','Nigerian','18 GRA, Enugu','Enugu','Student','below_500k','family_support','tier2','verified','low',false,false,false,'national_id','E56789012','2028-08-11',true,true,false,NOW()-INTERVAL '2 weeks',NOW()+INTERVAL '10 months',NOW()-INTERVAL '2 weeks'),
(4,'CUST-ACC-002','individual','Ibrahim Musa','23123456789','01234567890','1980-01-20','Nigerian','4 Kano Road, Kano','Kano','Trader','500k_1m','business_income','tier1','restricted','high',false,false,true,'drivers_license','DL234567890','2026-01-20',true,false,false,NOW()-INTERVAL '1 week',NOW()+INTERVAL '11 months',NOW()-INTERVAL '1 week'),
(5,'CUST-UBA-002','individual','Yetunde Bakare','23234567890','12345098765','1991-06-07','Nigerian','9 Allen Avenue, Ikeja','Lagos','Pharmacist','2m_5m','salary','tier3','verified','low',false,false,false,'passport','A22345678','2029-06-07',true,true,true,NOW()-INTERVAL '5 days',NOW()+INTERVAL '12 months',NOW()-INTERVAL '5 days'),
(6,'CUST-SIB-001','individual','Tunde Okonkwo','23345678901','23456098765','1986-10-14','Nigerian','15 Marina, Lagos Island','Lagos','Banker','5m_10m','salary','tier2','verified','medium',false,false,false,'national_id','F67890123','2027-10-14',true,true,false,NOW()-INTERVAL '4 days',NOW()+INTERVAL '12 months',NOW()-INTERVAL '4 days'),
(7,'CUST-FID-001','individual','Blessing Nwofor','23456789012','34567098765','1994-03-28','Nigerian','27 Trans-Amadi, Port Harcourt','Rivers','Nurse','1m_2m','salary','tier3','verified','low',false,false,false,'national_id','G78901234','2028-03-28',true,true,true,NOW()-INTERVAL '3 days',NOW()+INTERVAL '12 months',NOW()-INTERVAL '3 days'),
(8,'CUST-UBN-001','individual','Musa Abdullahi','23567890123','45678098765','1983-07-19','Nigerian','12 Ahmadu Bello Way, Zaria','Kaduna','Farmer','below_500k','agriculture','tier1','pending','high',false,false,false,'national_id','H89012345','2027-07-19',false,false,false,NOW()-INTERVAL '2 days',NOW()+INTERVAL '12 months',NOW()-INTERVAL '2 days'),
(9,'CUST-STB-001','individual','Adaeze Okafor','23678901234','56789098765','1999-11-02','Nigerian','3 Aba Road, Port Harcourt','Rivers','Graduate','500k_1m','salary','tier2','verified','low',false,false,false,'national_id','I90123456','2028-11-02',true,true,false,NOW()-INTERVAL '1 day',NOW()+INTERVAL '12 months',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── AML Cases ───────────────────────────────────────────────────────────────
INSERT INTO aml_cases (bank_id, case_reference, case_type, subject_name, subject_account, subject_bvn, alert_source, alert_score, risk_level, status, assigned_to, transaction_amount, transaction_currency, transaction_date, str_filed, str_reference, str_filed_date, nfiu_reported, nfiu_reference, escalated, escalation_reason, investigation_notes, created_at)
VALUES
(2,'AML-2026-001','pep_screening','Babatunde Fashola','9876543210','22901234567','pep_screening',85,'high','under_review','Analyst-A01',45000000,'NGN','2026-01-01',false,NULL,NULL,false,NULL,false,NULL,'PEP match confirmed. Enhanced due diligence in progress.',NOW()-INTERVAL '30 days'),
(4,'AML-2026-002','sanctions_screening','Ibrahim Musa','3344556677','23123456789','sanctions_screening',92,'critical','escalated','Analyst-A02',12000000,'NGN','2026-01-05',true,'STR-2026-0045','2026-01-10',true,'NFIU-2026-0045',true,'Sanctions hit confirmed — OFAC SDN list','Sanctions match confirmed. STR filed. NFIU notified.',NOW()-INTERVAL '28 days'),
(1,'AML-2026-003','suspicious_activity','Bright Future Holdings Ltd','1000000001',NULL,'transaction_monitoring',78,'high','str_filed','Analyst-A03',250000000,'NGN','2026-01-10',true,'STR-2026-0067','2026-01-15',false,NULL,false,NULL,'Large cash deposit pattern. STR filed.',NOW()-INTERVAL '25 days'),
(3,'AML-2026-004','transaction_monitoring','Chukwuemeka Eze','2233445566','22678901234','rule_engine',65,'medium','closed','Analyst-A01',8500000,'NGN','2026-01-12',false,NULL,NULL,false,NULL,false,NULL,'False positive. Customer is legitimate contractor.',NOW()-INTERVAL '22 days'),
(2,'AML-2026-005','sanctions_screening','Global Trade Partners Ltd','2000000002',NULL,'sanctions_screening',88,'critical','escalated','Analyst-A04',180000000,'USD','2026-01-15',true,'STR-2026-0089','2026-01-20',true,'NFIU-2026-0067',true,'Sanctions hit — Iran-related','Sanctions confirmed. STR filed. NFIU notified.',NOW()-INTERVAL '20 days'),
(5,'AML-2026-006','transaction_monitoring','Aisha Mohammed','4455667788','22789012345','rule_engine',45,'low','closed','Analyst-A02',3200000,'NGN','2026-01-18',false,NULL,NULL,false,NULL,false,NULL,'False positive. Regular salary and business income.',NOW()-INTERVAL '18 days'),
(1,'AML-2026-007','pep_screening','Nexus Investment Corp','1000000003',NULL,'pep_screening',95,'critical','escalated','Analyst-A05',500000000,'NGN','2026-01-20',true,'STR-2026-0112','2026-01-25',true,'NFIU-2026-0089',true,'PEP and sanctions match. Immediate escalation.','Multiple red flags. STR filed. NFIU notified.',NOW()-INTERVAL '15 days'),
(4,'AML-2026-008','transaction_monitoring','Musa Abdullahi','3344556678','23567890123','ml_model',72,'high','under_review','Analyst-A03',6800000,'NGN','2026-01-22',false,NULL,NULL,false,NULL,false,NULL,'Unusual transaction pattern. Investigation ongoing.',NOW()-INTERVAL '12 days'),
(3,'AML-2026-009','adverse_media','Pinnacle Resources Ltd','2233445569',NULL,'adverse_media',81,'high','under_review','Analyst-A01',95000000,'NGN','2026-01-25',false,NULL,NULL,false,NULL,false,NULL,'Adverse media — money laundering allegations.',NOW()-INTERVAL '10 days'),
(2,'AML-2026-010','suspicious_activity','Emeka Nwosu','9876543211','22456789012','transaction_monitoring',58,'medium','closed','Analyst-A02',4500000,'NGN','2026-01-28',true,'STR-2026-0134','2026-02-01',false,NULL,false,NULL,'Cash intensive business. STR filed. Customer exited.',NOW()-INTERVAL '8 days')
ON CONFLICT DO NOTHING;

-- ─── Watchlist Entries ────────────────────────────────────────────────────────
INSERT INTO watchlist_entries (list_source, list_type, entity_type, full_name, aliases, date_of_birth, nationality, id_numbers, addresses, reason, designation_date, status, ofac_sdn, un_consolidated, eu_consolidated, uk_hmt, nfiu_list, terrorism_link, pep_link, last_updated, created_at)
VALUES
('UN_CONSOLIDATED','sanctions','individual','Abubakar Shekau',ARRAY['Abu Shekau','Abubakar Mohammed Shekau'],'1969-01-01','Nigerian',ARRAY['NIN-XX-001'],ARRAY['Borno State, Nigeria'],'Boko Haram leader — terrorist financing','2014-05-22','active',true,true,false,false,false,true,false,NOW()-INTERVAL '1 year',NOW()-INTERVAL '5 years'),
('INTERPOL','red_notice','individual','Hezekiah Dimka',ARRAY['H. Dimka'],'1945-03-10','Nigerian',ARRAY[],ARRAY['Lagos, Nigeria'],'Money laundering — international fugitive','2020-01-15','active',false,false,false,false,false,false,false,NOW()-INTERVAL '6 months',NOW()-INTERVAL '4 years'),
('OFAC_SDN','sanctions','entity','Global Syndicate Holdings',ARRAY['GSH Ltd','Global Syndicate'],NULL,'Nigerian',ARRAY['RC-999001'],ARRAY['Lagos, Nigeria'],'Sanctions evasion — shell company network','2021-06-01','active',true,false,true,true,false,false,false,NOW()-INTERVAL '3 months',NOW()-INTERVAL '3 years'),
('EU_CONSOLIDATED','sanctions','individual','Viktor Petrov',ARRAY['V. Petrov','Viktor P.'],'1972-11-30','Russian',ARRAY[],ARRAY['Moscow, Russia'],'Ukraine-related sanctions','2022-03-15','active',false,false,true,true,false,false,false,NOW()-INTERVAL '2 months',NOW()-INTERVAL '2 years'),
('NFIU_WATCHLIST','aml','entity','Bright Future Holdings Ltd',ARRAY['BFH','Bright Future'],NULL,'Nigerian',ARRAY['RC-887654'],ARRAY['Lagos, Nigeria'],'Suspicious transaction patterns — money laundering investigation','2023-08-10','active',false,false,false,false,true,false,false,NOW()-INTERVAL '1 month',NOW()-INTERVAL '1 year'),
('UN_CONSOLIDATED','sanctions','individual','Mohammed Al-Rashid',ARRAY['M. Al-Rashid','Abu Rashid'],'1980-05-20','Libyan',ARRAY[],ARRAY['Tripoli, Libya'],'Terrorist financing','2019-11-01','active',true,true,false,false,false,true,false,NOW()-INTERVAL '6 months',NOW()-INTERVAL '4 years'),
('NFIU_WATCHLIST','pep','entity','Nexus Investment Corp',ARRAY['Nexus Corp','NIC Ltd'],NULL,'Nigerian',ARRAY['RC-776543'],ARRAY['Abuja, Nigeria'],'PEP-linked entity under investigation','2024-01-20','active',false,false,false,false,true,false,true,NOW()-INTERVAL '2 weeks',NOW()-INTERVAL '6 months'),
('CBN_WATCHLIST','fraud','individual','Oluwafemi Adegoke',ARRAY['Femi Adegoke'],'1968-09-15','Nigerian',ARRAY['BVN-99887766'],ARRAY['Lagos, Nigeria'],'Bank fraud conviction','2023-05-05','active',false,false,false,false,false,false,false,NOW()-INTERVAL '1 month',NOW()-INTERVAL '1 year'),
('EFCC_WATCHLIST','corruption','entity','Sahara Desert Trading',ARRAY['SDT','Sahara Trading'],NULL,'Nigerian',ARRAY['RC-654321'],ARRAY['Abuja, Nigeria'],'EFCC investigation for corruption','2022-12-01','active',false,false,false,false,false,false,false,NOW()-INTERVAL '2 months',NOW()-INTERVAL '1 year 6 months'),
('EFCC_WATCHLIST','fraud','individual','Chidi Okeke',ARRAY['C. Okeke','Chidi O.'],'1975-07-04','Nigerian',ARRAY['BVN-88776655'],ARRAY['Anambra, Nigeria'],'Advance fee fraud — 419','2021-09-20','active',false,false,false,false,false,false,false,NOW()-INTERVAL '3 months',NOW()-INTERVAL '2 years 6 months'),
('OFAC_SDN','sanctions','entity','Global Trade Partners Ltd',ARRAY['GTP','Global Trade'],NULL,'Nigerian',ARRAY['RC-543210'],ARRAY['Lagos, Nigeria'],'Sanctions violation — Iran trade','2023-02-14','active',true,false,true,true,false,false,false,NOW()-INTERVAL '1 month',NOW()-INTERVAL '1 year 2 months'),
('CBN_WATCHLIST','pep','individual','Aminu Kano',ARRAY['A. Kano'],'1960-04-12','Nigerian',ARRAY[],ARRAY['Kano, Nigeria'],'Former minister under investigation','2020-07-01','active',false,false,false,false,false,false,true,NOW()-INTERVAL '6 months',NOW()-INTERVAL '3 years'),
('NFIU_WATCHLIST','aml','entity','Pinnacle Resources Ltd',ARRAY['Pinnacle Res','PRL'],NULL,'Nigerian',ARRAY['RC-432109'],ARRAY['Lagos, Nigeria'],'Adverse media — money laundering allegations','2024-03-01','active',false,false,false,false,true,false,false,NOW()-INTERVAL '1 week',NOW()-INTERVAL '3 months'),
('UN_CONSOLIDATED','sanctions','individual','Yusuf Al-Baraka',ARRAY['Y. Al-Baraka'],'1978-02-28','Sudanese',ARRAY[],ARRAY['Khartoum, Sudan'],'Terrorist financing','2018-06-15','active',true,true,false,false,false,true,false,NOW()-INTERVAL '1 year',NOW()-INTERVAL '5 years'),
('EFCC_WATCHLIST','cybercrime','individual','Ekene Eze',ARRAY['E. Eze'],'1990-12-01','Nigerian',ARRAY['BVN-77665544'],ARRAY['Lagos, Nigeria'],'Cybercrime conviction — BEC fraud','2025-01-10','active',false,false,false,false,false,false,false,NOW()-INTERVAL '2 weeks',NOW()-INTERVAL '3 months')
ON CONFLICT DO NOTHING;

-- ─── NIP Transactions ────────────────────────────────────────────────────────
INSERT INTO nip_transactions (bank_id, session_id, sender_bank_code, sender_account, sender_name, receiver_bank_code, receiver_account, receiver_name, amount, currency, narration, channel, status, nibss_reference, response_code, response_message, value_date, created_at)
VALUES
(1,'NIP20260101001','011','1234567890','Adebayo Okafor','057','9876543210','Ngozi Adeyemi',250000,'NGN','Transfer to Zenith','mobile','completed','NIBSS-2026-0000001','00','Approved','2026-01-01',NOW()-INTERVAL '30 days'),
(2,'NIP20260101002','057','9876543210','Ngozi Adeyemi','044','1122334455','Emeka Nwosu',500000,'NGN','Business payment','internet','completed','NIBSS-2026-0000002','00','Approved','2026-01-01',NOW()-INTERVAL '30 days'),
(3,'NIP20260101003','058','2233445566','GTB Customer','033','3344556677','UBA Customer',1000000,'NGN','Rent payment','pos','completed','NIBSS-2026-0000003','00','Approved','2026-01-01',NOW()-INTERVAL '29 days'),
(4,'NIP20260102001','044','3344556677','Access Customer','011','4455667788','FBN Customer',75000,'NGN','School fees','mobile','completed','NIBSS-2026-0000004','00','Approved','2026-01-02',NOW()-INTERVAL '29 days'),
(5,'NIP20260102002','033','4455667788','UBA Customer','057','5566778899','Zenith Cust',2500000,'NGN','Supplier payment','internet','completed','NIBSS-2026-0000005','00','Approved','2026-01-02',NOW()-INTERVAL '28 days'),
(1,'NIP20260102003','011','5566778899','FBN Customer','058','6677889900','GTB Customer',150000,'NGN','Personal transfer','mobile','failed',NULL,'51','Insufficient funds','2026-01-02',NOW()-INTERVAL '28 days'),
(2,'NIP20260103001','057','6677889900','Zenith Customer','044','7788990011','Access Cust',5000000,'NGN','Property deposit','internet','completed','NIBSS-2026-0000006','00','Approved','2026-01-03',NOW()-INTERVAL '27 days'),
(3,'NIP20260103002','058','7788990011','GTB Customer','033','8899001122','UBA Customer',350000,'NGN','Medical bills','mobile','completed','NIBSS-2026-0000007','00','Approved','2026-01-03',NOW()-INTERVAL '27 days'),
(4,'NIP20260103003','044','8899001122','Access Customer','011','9900112233','FBN Customer',800000,'NGN','Equipment purchase','internet','completed','NIBSS-2026-0000008','00','Approved','2026-01-03',NOW()-INTERVAL '26 days'),
(5,'NIP20260104001','033','9900112233','UBA Customer','057','0011223344','Zenith Cust',125000,'NGN','Utility payment','ussd','completed','NIBSS-2026-0000009','00','Approved','2026-01-04',NOW()-INTERVAL '26 days'),
(1,'NIP20260104002','011','0011223344','FBN Customer','058','1122334456','GTB Customer',3500000,'NGN','Investment transfer','internet','pending',NULL,NULL,NULL,'2026-01-04',NOW()-INTERVAL '25 days'),
(2,'NIP20260104003','057','1122334456','Zenith Customer','044','2233445567','Access Cust',200000,'NGN','Airtime purchase','mobile','completed','NIBSS-2026-0000010','00','Approved','2026-01-04',NOW()-INTERVAL '25 days'),
(3,'NIP20260105001','058','2233445567','GTB Customer','033','3344556678','UBA Customer',750000,'NGN','Salary advance','internet','completed','NIBSS-2026-0000011','00','Approved','2026-01-05',NOW()-INTERVAL '24 days'),
(4,'NIP20260105002','044','3344556678','Access Customer','011','4455667789','FBN Customer',50000,'NGN','Food purchase','pos','completed','NIBSS-2026-0000012','00','Approved','2026-01-05',NOW()-INTERVAL '24 days'),
(5,'NIP20260105003','033','4455667789','UBA Customer','057','5566778890','Zenith Cust',10000000,'NGN','Large transfer','internet','completed','NIBSS-2026-0000013','00','Approved','2026-01-05',NOW()-INTERVAL '23 days'),
(1,'NIP20260106001','011','5566778890','FBN Customer','058','6677889901','GTB Customer',450000,'NGN','Loan repayment','mobile','completed','NIBSS-2026-0000014','00','Approved','2026-01-06',NOW()-INTERVAL '23 days'),
(2,'NIP20260106002','057','6677889901','Zenith Customer','044','7788990012','Access Cust',1800000,'NGN','Car purchase deposit','internet','completed','NIBSS-2026-0000015','00','Approved','2026-01-06',NOW()-INTERVAL '22 days'),
(3,'NIP20260106003','058','7788990012','GTB Customer','033','8899001123','UBA Customer',25000,'NGN','Fuel purchase','pos','failed',NULL,'91','No such issuer','2026-01-06',NOW()-INTERVAL '22 days'),
(4,'NIP20260107001','044','8899001123','Access Customer','011','9900112234','FBN Customer',600000,'NGN','Insurance premium','internet','completed','NIBSS-2026-0000016','00','Approved','2026-01-07',NOW()-INTERVAL '21 days'),
(5,'NIP20260107002','033','9900112234','UBA Customer','057','0011223345','Zenith Cust',2200000,'NGN','Dividend payment','internet','completed','NIBSS-2026-0000017','00','Approved','2026-01-07',NOW()-INTERVAL '21 days')
ON CONFLICT DO NOTHING;

-- ─── RTGS Transactions ────────────────────────────────────────────────────────
INSERT INTO rtgs_transactions (bank_id, rtgs_reference, transaction_type, sending_bank, sending_account, sending_name, receiving_bank, receiving_account, receiving_name, amount, currency, narration, priority, status, settlement_time, value_date, created_at)
VALUES
(1,'RTGS-2026-001','interbank_transfer','First Bank of Nigeria','1000000001','First Bank Treasury','Zenith Bank Plc','2000000001','Zenith Bank Treasury',5000000000,'NGN','Interbank settlement','high','settled','2026-01-02 09:15:00','2026-01-02',NOW()-INTERVAL '30 days'),
(2,'RTGS-2026-002','interbank_transfer','Zenith Bank Plc','2000000001','Zenith Bank Treasury','Access Bank Plc','3000000001','Access Bank Treasury',8500000000,'NGN','Interbank liquidity','high','settled','2026-01-02 10:30:00','2026-01-02',NOW()-INTERVAL '30 days'),
(3,'RTGS-2026-003','customer_credit','Guaranty Trust Bank','4000000001','GTB Treasury','United Bank for Africa','5000000001','UBA Treasury',3200000000,'NGN','Daily settlement','normal','settled','2026-01-03 11:00:00','2026-01-03',NOW()-INTERVAL '29 days'),
(4,'RTGS-2026-004','government_payment','Access Bank Plc','3000000001','Access Bank Treasury','First Bank of Nigeria','1000000001','First Bank Treasury',12000000000,'NGN','Large value transfer','high','settled','2026-01-05 09:00:00','2026-01-05',NOW()-INTERVAL '27 days'),
(5,'RTGS-2026-005','interbank_transfer','United Bank for Africa','5000000001','UBA Treasury','Guaranty Trust Bank','4000000001','GTB Treasury',6700000000,'NGN','Interbank settlement','normal','settled','2026-01-07 14:00:00','2026-01-07',NOW()-INTERVAL '25 days'),
(1,'RTGS-2026-006','government_payment','First Bank of Nigeria','1000000001','First Bank Treasury','Access Bank Plc','3000000001','Access Bank Treasury',9800000000,'NGN','Government bond payment','high','settled','2026-01-10 10:00:00','2026-01-10',NOW()-INTERVAL '22 days'),
(2,'RTGS-2026-007','interbank_transfer','Zenith Bank Plc','2000000001','Zenith Bank Treasury','Guaranty Trust Bank','4000000001','GTB Treasury',4500000000,'NGN','Treasury bill settlement','normal','settled','2026-01-12 11:30:00','2026-01-12',NOW()-INTERVAL '20 days'),
(4,'RTGS-2026-008','government_payment','Access Bank Plc','3000000001','Access Bank Treasury','United Bank for Africa','5000000001','UBA Treasury',7200000000,'NGN','FGN bond coupon','high','settled','2026-01-15 09:45:00','2026-01-15',NOW()-INTERVAL '17 days'),
(3,'RTGS-2026-009','interbank_transfer','Guaranty Trust Bank','4000000001','GTB Treasury','First Bank of Nigeria','1000000001','First Bank Treasury',2100000000,'NGN','Interbank repo','normal','settled','2026-01-18 13:00:00','2026-01-18',NOW()-INTERVAL '14 days'),
(5,'RTGS-2026-010','syndicated_loan','United Bank for Africa','5000000001','UBA Treasury','Zenith Bank Plc','2000000001','Zenith Bank Treasury',15000000000,'NGN','Syndicated loan disbursement','high','settled','2026-01-20 10:15:00','2026-01-20',NOW()-INTERVAL '12 days'),
(1,'RTGS-2026-011','interbank_transfer','First Bank of Nigeria','1000000001','First Bank Treasury','Guaranty Trust Bank','4000000001','GTB Treasury',3800000000,'NGN','Interbank settlement','normal','settled','2026-01-22 11:00:00','2026-01-22',NOW()-INTERVAL '10 days'),
(2,'RTGS-2026-012','treasury_management','Zenith Bank Plc','2000000001','Zenith Bank Treasury','United Bank for Africa','5000000001','UBA Treasury',6100000000,'NGN','Treasury management','high','settled','2026-01-25 09:30:00','2026-01-25',NOW()-INTERVAL '7 days'),
(4,'RTGS-2026-013','pension_transfer','Access Bank Plc','3000000001','Access Bank Treasury','First Bank of Nigeria','1000000001','First Bank Treasury',11500000000,'NGN','Pension fund transfer','high','settled','2026-01-28 10:00:00','2026-01-28',NOW()-INTERVAL '4 days'),
(3,'RTGS-2026-014','interbank_transfer','Guaranty Trust Bank','4000000001','GTB Treasury','Zenith Bank Plc','2000000001','Zenith Bank Treasury',4900000000,'NGN','Interbank settlement','normal','pending',NULL,'2026-01-31',NOW()-INTERVAL '1 day'),
(5,'RTGS-2026-015','fx_settlement','United Bank for Africa','5000000001','UBA Treasury','Access Bank Plc','3000000001','Access Bank Treasury',8300000000,'NGN','FX settlement','high','processing',NULL,'2026-02-01',NOW()-INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- ─── SWIFT Messages ───────────────────────────────────────────────────────────
INSERT INTO swift_messages (bank_id, message_reference, message_type, direction, sender_bic, receiver_bic, amount, currency, value_date, ordering_customer, beneficiary_customer, beneficiary_account, details_of_charges, remittance_info, status, ack_received, ack_timestamp, sanctions_screened, sanctions_hit, created_at)
VALUES
(3,'TXN-SWIFT-001','MT103','outbound','GTBINGLA','CHASUS33',50000,'USD','2026-01-05','Guaranty Trust Bank Plc','JP Morgan Chase Bank','001-234567-89','SHA','Invoice payment - INV-2026-001','settled',true,'2026-01-05 10:30:00',true,false,NOW()-INTERVAL '28 days'),
(1,'TXN-SWIFT-002','MT103','outbound','FBNINGLA','BARCGB22',25000,'GBP','2026-01-08','First Bank of Nigeria','Barclays Bank UK','004-567890-12','SHA','Tuition fees - Oxford University','settled',true,'2026-01-08 14:15:00',true,false,NOW()-INTERVAL '25 days'),
(2,'TXN-SWIFT-003','MT103','outbound','ZEIBNGLA','DEUTDEFF',75000,'EUR','2026-01-10','Zenith Bank Plc','Deutsche Bank AG','003-456789-01','OUR','Trade finance - machinery import','settled',true,'2026-01-10 09:00:00',true,false,NOW()-INTERVAL '23 days'),
(4,'TXN-SWIFT-004','MT103','outbound','ABNGNGLA','CITIUS33',120000,'USD','2026-01-12','Access Bank Plc','Citibank N.A.','002-345678-90','SHA','Oil & gas equipment','settled',true,'2026-01-12 11:45:00',true,false,NOW()-INTERVAL '21 days'),
(5,'TXN-SWIFT-005','MT103','outbound','UNAFNGLA','BNPAFRPP',35000,'EUR','2026-01-15','UBA Plc','BNP Paribas','005-678901-23','SHA','Pharmaceutical imports','settled',true,'2026-01-15 08:30:00',true,false,NOW()-INTERVAL '18 days'),
(3,'TXN-SWIFT-006','MT103','outbound','GTBINGLA','HSBCGB2L',200000,'GBP','2026-01-18','GTB Plc','HSBC Bank plc','006-789012-34','OUR','Real estate acquisition','on_hold',false,NULL,true,true,NOW()-INTERVAL '15 days'),
(1,'TXN-SWIFT-007','MT202','outbound','FBNINGLA','CHASUS33',5000000,'USD','2026-01-20','First Bank of Nigeria','JP Morgan Chase Bank','001-234567-89','OUR','Interbank cover payment','settled',true,'2026-01-20 10:00:00',true,false,NOW()-INTERVAL '13 days'),
(2,'TXN-SWIFT-008','MT103','outbound','ZEIBNGLA','SBICGB2L',18000,'USD','2026-01-22','Zenith Bank Plc','Standard Bank UK','010-123456-78','SHA','Education fees','settled',true,'2026-01-22 13:20:00',true,false,NOW()-INTERVAL '11 days'),
(4,'TXN-SWIFT-009','MT103','outbound','ABNGNGLA','SCBLGB2L',85000,'USD','2026-01-25','Access Bank Plc','Standard Chartered Bank','007-890123-45','SHA','Agricultural equipment','settled',true,'2026-01-25 09:15:00',true,false,NOW()-INTERVAL '8 days'),
(3,'TXN-SWIFT-010','MT700','outbound','GTBINGLA','CHASUS33',2500000,'USD','2026-01-28','GTB Plc','JP Morgan Chase Bank','001-234567-89','OUR','Letter of Credit - crude oil export','processing',false,NULL,true,false,NOW()-INTERVAL '5 days'),
(1,'TXN-SWIFT-011','MT103','outbound','FBNINGLA','ABOCJPJT',8000000,'JPY','2026-02-01','First Bank of Nigeria','Aozora Bank Japan','009-012345-67','SHA','Technology import','settled',true,'2026-02-01 07:00:00',true,false,NOW()-INTERVAL '3 days'),
(5,'TXN-SWIFT-012','MT103','outbound','UNAFNGLA','NEDSZAJJ',500000,'ZAR','2026-02-03','UBA Plc','Nedbank South Africa','008-901234-56','SHA','Pan-African trade settlement','settled',true,'2026-02-03 11:00:00',true,false,NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Fraud Alerts ─────────────────────────────────────────────────────────────
INSERT INTO fraud_alerts (bank_id, alert_reference, fraud_type, channel, customer_ref, account_number, transaction_ref, amount, currency, risk_score, risk_level, status, detection_method, ml_model_version, rule_triggered, device_fingerprint, ip_address, location, confirmed_fraud, false_positive, customer_notified, card_blocked, account_frozen, investigation_notes, created_at)
VALUES
(1,'FRAUD-FBN-2026-001','velocity_breach','mobile','CUST-FBN-001','1234567890','TXN-FBN-FRAUD-001',450000,'NGN',88,'high','under_review','ml_model','xgboost_v3.1.2','high_velocity_unusual_hour','DEV-ABC123','196.45.12.34','Lagos, NG',false,false,true,false,false,'8 transactions in 1 hour. Unusual hour (2am). New device.',NOW()-INTERVAL '5 days'),
(2,'FRAUD-ZBP-2026-001','account_takeover','internet','CUST-ZBP-002','9876543210','TXN-ZBP-FRAUD-001',1200000,'NGN',95,'critical','escalated','ml_model','isolation_forest_v2.3.0','new_device_location_anomaly','DEV-XYZ789','41.58.234.12','Abuja, NG',true,false,true,false,true,'Account takeover confirmed. Account frozen. Police report filed.',NOW()-INTERVAL '4 days'),
(3,'FRAUD-GTB-2026-001','card_not_present','pos','CUST-GTB-001','2233445566','TXN-GTB-FRAUD-001',85000,'NGN',72,'medium','closed','rule_engine','xgboost_v3.1.2','international_merchant_high_amount','DEV-POS001','203.45.67.89','London, UK',false,true,false,false,false,'False positive. Customer confirmed legitimate international purchase.',NOW()-INTERVAL '3 days'),
(4,'FRAUD-ACC-2026-001','structuring','branch','CUST-ACC-001','3344556677','TXN-ACC-FRAUD-001',4950000,'NGN',81,'high','str_filed','rule_engine','gradient_boost_v2.1.5','structuring_pattern_cash_intensive',NULL,NULL,'Port Harcourt, NG',true,false,true,false,false,'Structuring pattern confirmed. STR filed with NFIU.',NOW()-INTERVAL '3 days'),
(5,'FRAUD-UBA-2026-001','sim_swap','mobile','CUST-UBA-001','4455667788','TXN-UBA-FRAUD-001',2500000,'NGN',91,'critical','escalated','ml_model','random_forest_v3.2.0','sim_swap_detected_new_device','DEV-NEW001','197.210.45.67','Kano, NG',true,false,true,true,true,'SIM swap confirmed. Card blocked. Account frozen. Customer notified.',NOW()-INTERVAL '2 days'),
(1,'FRAUD-FBN-2026-002','phishing','internet','CUST-FBN-002','5566778899','TXN-FBN-FRAUD-002',150000,'NGN',68,'medium','closed','rule_engine','xgboost_v3.1.2','phishing_url_click','DEV-DEF456','105.112.45.23','Lagos, NG',false,false,true,false,false,'Customer confirmed phishing. Credentials reset. Account secured.',NOW()-INTERVAL '2 days'),
(2,'FRAUD-ZBP-2026-002','money_mule','internet','CUST-ZBP-001','6677889900','TXN-ZBP-FRAUD-002',8900000,'NGN',85,'high','under_review','ml_model','neural_net_v4.0.1','mule_account_rapid_pass_through','DEV-GHI789','154.67.23.45','Lagos, NG',false,false,false,false,false,'Mule account pattern. Multiple senders. Investigation ongoing.',NOW()-INTERVAL '1 day'),
(3,'FRAUD-GTB-2026-002','false_positive','mobile','CUST-GTB-002','7788990011','TXN-GTB-FRAUD-002',500000,'NGN',35,'low','closed','rule_engine','xgboost_v3.1.2','unusual_amount',NULL,'197.210.12.34','Abuja, NG',false,true,false,false,false,'False positive. Regular customer behaviour confirmed.',NOW()-INTERVAL '1 day'),
(4,'FRAUD-ACC-2026-002','card_cloning','pos','CUST-ACC-002','8899001122','TXN-ACC-FRAUD-002',3200000,'NGN',93,'critical','escalated','ml_model','isolation_forest_v2.3.0','card_cloning_multiple_locations','DEV-POS002',NULL,'Multiple locations',true,false,true,true,true,'Card cloning confirmed. 15 transactions in 3 cities. Card blocked.',NOW()-INTERVAL '12 hours'),
(5,'FRAUD-UBA-2026-002','social_engineering','mobile','CUST-UBA-002','9900112233','TXN-UBA-FRAUD-002',750000,'NGN',77,'high','under_review','rule_engine','gradient_boost_v2.1.5','social_engineering_unusual_beneficiary','DEV-MNO345','196.45.78.90','Lagos, NG',false,false,false,false,false,'Possible social engineering. Unusual beneficiary. Under investigation.',NOW()-INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

-- ─── CBN Reports ─────────────────────────────────────────────────────────────
INSERT INTO cbn_reports (bank_id, report_reference, report_type, reporting_period, period_start, period_end, due_date, submission_date, status, total_transactions, total_value_ngn, str_count, ctr_count, aml_cases_count, submitted_by, cbn_acknowledgment, cbn_feedback, created_at)
VALUES
(1,'CBN-STR-FBN-2026Q1','STR','2026-Q1','2026-01-01','2026-03-31','2026-04-30','2026-04-05','submitted',45230,125000000000,12,0,12,'Chief Compliance Officer','CBN-ACK-2026-001','Received and under review',NOW()-INTERVAL '9 days'),
(2,'CBN-CTR-ZBP-2026Q1','CTR','2026-Q1','2026-01-01','2026-03-31','2026-04-30','2026-04-06','submitted',38120,98000000000,0,45,3,'Head of Compliance','CBN-ACK-2026-002','Acknowledged',NOW()-INTERVAL '8 days'),
(3,'CBN-STR-GTB-2026Q1','STR','2026-Q1','2026-01-01','2026-03-31','2026-04-30','2026-04-07','submitted',52340,145000000000,8,0,8,'MLRO','CBN-ACK-2026-003','Received',NOW()-INTERVAL '7 days'),
(4,'CBN-CTR-ACC-2026Q1','CTR','2026-Q1','2026-01-01','2026-03-31','2026-04-30','2026-04-08','submitted',61250,210000000000,0,67,5,'Compliance Manager','CBN-ACK-2026-004','Acknowledged',NOW()-INTERVAL '6 days'),
(5,'CBN-STR-UBA-2026Q1','STR','2026-Q1','2026-01-01','2026-03-31','2026-04-30','2026-04-09','submitted',29870,87000000000,5,0,7,'Chief Risk Officer','CBN-ACK-2026-005','Under review',NOW()-INTERVAL '5 days'),
(1,'CBN-SCUML-FBN-2026Q1','SCUML','2026-Q1','2026-01-01','2026-03-31','2026-04-30',NULL,'draft',45230,125000000000,0,0,0,'AML Officer',NULL,NULL,NOW()-INTERVAL '4 days'),
(2,'CBN-STR-ZBP-2026Q1-2','STR','2026-Q1','2026-01-01','2026-03-31','2026-04-30',NULL,'pending',38120,98000000000,3,0,3,'MLRO',NULL,NULL,NOW()-INTERVAL '3 days'),
(3,'CBN-SCUML-GTB-2026Q1','SCUML','2026-Q1','2026-01-01','2026-03-31','2026-04-30',NULL,'draft',52340,145000000000,0,0,0,'Compliance Officer',NULL,NULL,NOW()-INTERVAL '2 days'),
(4,'CBN-STR-ACC-2026Q1-2','STR','2026-Q1','2026-01-01','2026-03-31','2026-04-30',NULL,'pending',61250,210000000000,7,0,7,'Chief Compliance Officer',NULL,NULL,NOW()-INTERVAL '1 day'),
(5,'CBN-CTR-UBA-2026Q1','CTR','2026-Q1','2026-01-01','2026-03-31','2026-04-30',NULL,'draft',29870,87000000000,0,32,0,'MLRO',NULL,NULL,NOW())
ON CONFLICT DO NOTHING;

-- ─── Correspondent Banks ──────────────────────────────────────────────────────
INSERT INTO correspondent_banks (bank_id, correspondent_name, correspondent_bic, country, currency, relationship_type, nostro_account, vostro_account, status, daily_limit, monthly_limit, kyc_completed, aml_risk_rating, fatf_compliant, ofac_cleared, last_review_date, next_review_date, contact_name, contact_email, agreement_date, agreement_expiry, created_at)
VALUES
(1,'JP Morgan Chase Bank N.A.','CHASUS33','United States','USD','nostro','001-234567-89',NULL,'active',50000000,500000000,true,'low',true,true,'2025-01-15','2026-01-15','Michael Johnson','mjohnson@jpmorgan.com','2020-03-01','2027-03-01',NOW()-INTERVAL '5 years'),
(4,'Citibank N.A.','CITIUS33','United States','USD','nostro','002-345678-90',NULL,'active',30000000,300000000,true,'low',true,true,'2025-02-20','2026-02-20','Sarah Williams','swilliams@citi.com','2019-06-01','2026-06-01',NOW()-INTERVAL '4 years'),
(2,'Deutsche Bank AG','DEUTDEFF','Germany','EUR','nostro','003-456789-01',NULL,'active',20000000,200000000,true,'low',true,true,'2025-03-10','2026-03-10','Hans Mueller','hmueller@db.com','2021-01-15','2028-01-15',NOW()-INTERVAL '3 years'),
(1,'Barclays Bank PLC','BARCGB22','United Kingdom','GBP','nostro','004-567890-12',NULL,'active',15000000,150000000,true,'low',true,true,'2025-04-05','2026-04-05','James Smith','jsmith@barclays.com','2020-09-01','2027-09-01',NOW()-INTERVAL '3 years'),
(5,'BNP Paribas','BNPAFRPP','France','EUR','nostro','005-678901-23',NULL,'active',12000000,120000000,true,'low',true,true,'2025-05-12','2026-05-12','Pierre Dubois','pdubois@bnp.com','2022-03-01','2029-03-01',NOW()-INTERVAL '2 years'),
(3,'HSBC Bank PLC','HSBCGB2L','United Kingdom','GBP','nostro','006-789012-34',NULL,'under_review',10000000,100000000,false,'medium',true,true,'2024-06-20','2025-06-20','Robert Brown','rbrown@hsbc.com','2021-06-15','2025-06-15',NOW()-INTERVAL '2 years'),
(4,'Standard Chartered Bank','SCBLGB2L','United Kingdom','USD','nostro','007-890123-45',NULL,'active',8000000,80000000,true,'low',true,true,'2025-07-08','2026-07-08','Emma Wilson','ewilson@sc.com','2023-01-01','2030-01-01',NOW()-INTERVAL '1 year'),
(5,'Nedbank Limited','NEDSZAJJ','South Africa','ZAR','nostro','008-901234-56',NULL,'active',3000000,30000000,true,'low',true,true,'2025-08-15','2026-08-15','Thabo Nkosi','tnkosi@nedbank.co.za','2022-07-01','2029-07-01',NOW()-INTERVAL '1 year'),
(1,'Aozora Bank Ltd','ABOCJPJT','Japan','JPY','nostro','009-012345-67',NULL,'active',4000000,40000000,true,'low',true,true,'2025-09-01','2026-09-01','Kenji Tanaka','ktanaka@aozora.co.jp','2023-04-01','2030-04-01',NOW()-INTERVAL '9 months'),
(2,'Standard Bank South Africa','SBICGB2L','South Africa','USD','nostro','010-123456-78',NULL,'active',5000000,50000000,true,'low',true,true,'2025-10-10','2026-10-10','Sipho Dlamini','sdlamini@standardbank.co.za','2023-08-01','2030-08-01',NOW()-INTERVAL '6 months')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Cases ────────────────────────────────────────────────────────
INSERT INTO enforcement_cases (penalty_id, organization_id, status, case_reference, overdue_days, nitda_reference_number, resolution_notes, opened_at, updated_at)
VALUES
(1,1,'open','NDPC-ENF-2026-001',0,'NITDA-2026-0001',NULL,NOW()-INTERVAL '25 days',NOW()-INTERVAL '1 day'),
(2,2,'escalated','NDPC-ENF-2026-002',15,'NITDA-2026-0002',NULL,NOW()-INTERVAL '30 days',NOW()-INTERVAL '2 hours'),
(3,3,'under_review','NDPC-ENF-2026-003',0,'NITDA-2026-0003',NULL,NOW()-INTERVAL '20 days',NOW()-INTERVAL '3 hours'),
(4,4,'closed','NDPC-ENF-2026-004',0,'NITDA-2026-0004','Organisation paid penalty and implemented remediation plan',NOW()-INTERVAL '60 days',NOW()-INTERVAL '10 days'),
(5,5,'open','NDPC-ENF-2026-005',5,'NITDA-2026-0005',NULL,NOW()-INTERVAL '15 days',NOW()-INTERVAL '4 hours')
ON CONFLICT DO NOTHING;

-- ─── Case Timeline ────────────────────────────────────────────────────────────
INSERT INTO case_timeline (case_id, event_type, description, performed_by, created_at)
VALUES
(1,'case_opened','Enforcement case opened following compliance violation detection','NDPC Officer',NOW()-INTERVAL '25 days'),
(1,'notice_issued','Formal notice issued to First Bank of Nigeria Plc','NDPC Officer',NOW()-INTERVAL '24 days'),
(1,'response_received','Organisation submitted initial response','First Bank Compliance Team',NOW()-INTERVAL '20 days'),
(2,'case_opened','Enforcement case opened for MTN Nigeria','NDPC Officer',NOW()-INTERVAL '30 days'),
(2,'notice_issued','Formal notice issued to MTN Nigeria','NDPC Officer',NOW()-INTERVAL '29 days'),
(2,'escalated','Case escalated due to non-response after 15 days','NDPC Officer',NOW()-INTERVAL '15 days'),
(3,'case_opened','Enforcement case opened for LUTH','NDPC Officer',NOW()-INTERVAL '20 days'),
(3,'notice_issued','Formal notice issued to Lagos University Teaching Hospital','NDPC Officer',NOW()-INTERVAL '19 days'),
(3,'evidence_submitted','Organisation submitted evidence of remediation','LUTH Compliance',NOW()-INTERVAL '10 days'),
(4,'case_opened','Enforcement case opened for Federal Ministry of Education','NDPC Officer',NOW()-INTERVAL '60 days'),
(4,'notice_issued','Formal notice issued','NDPC Officer',NOW()-INTERVAL '59 days'),
(4,'penalty_paid','Penalty of N25M paid in full','FME Finance',NOW()-INTERVAL '20 days'),
(4,'case_closed','Case closed following full compliance','NDPC Officer',NOW()-INTERVAL '10 days'),
(5,'case_opened','Enforcement case opened for NNPC','NDPC Officer',NOW()-INTERVAL '15 days'),
(5,'notice_issued','Formal notice issued to NNPC','NDPC Officer',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Financial Ledger ─────────────────────────────────────────────────────────
INSERT INTO financial_ledger (transaction_id, organization_id, penalty_id, violation_id, tx_type, amount, currency, description, reference, status, created_at)
VALUES
('TXN-LED-001',4,4,NULL,'penalty_payment',25000000,'NGN','Penalty payment - NDPC-ENF-2026-004','NDPC-PAY-2026-001','settled',NOW()-INTERVAL '20 days'),
('TXN-LED-002',1,1,NULL,'penalty_assessment',50000000,'NGN','Penalty assessed for data breach','NDPC-ASSESS-2026-001','pending',NOW()-INTERVAL '25 days'),
('TXN-LED-003',2,2,NULL,'penalty_assessment',100000000,'NGN','Penalty assessed for NDPR violations','NDPC-ASSESS-2026-002','pending',NOW()-INTERVAL '30 days'),
('TXN-LED-004',3,3,NULL,'penalty_assessment',35000000,'NGN','Penalty assessed for consent violations','NDPC-ASSESS-2026-003','pending',NOW()-INTERVAL '20 days'),
('TXN-LED-005',5,5,NULL,'penalty_assessment',15000000,'NGN','Penalty assessed for data transfer violations','NDPC-ASSESS-2026-005','pending',NOW()-INTERVAL '15 days'),
('TXN-LED-006',4,4,NULL,'interest_charge',500000,'NGN','Late payment interest charge','NDPC-INT-2026-001','settled',NOW()-INTERVAL '15 days'),
('TXN-LED-007',1,NULL,1,'violation_fine',5000000,'NGN','Fine for compliance violation #1','NDPC-FINE-2026-001','pending',NOW()-INTERVAL '10 days'),
('TXN-LED-008',2,NULL,2,'violation_fine',8000000,'NGN','Fine for compliance violation #2','NDPC-FINE-2026-002','pending',NOW()-INTERVAL '8 days')
ON CONFLICT DO NOTHING;

-- ─── BGP Routes ───────────────────────────────────────────────────────────────
INSERT INTO bgp_routes (prefix, origin_asn, as_path, next_hop, local_pref, med, communities, origin_type, is_valid, is_selected, rpki_status, irr_status, data_residency_compliant, organization_id, detected_at, last_seen_at)
VALUES
('196.46.0.0/16',37148,ARRAY[37148,6453,3356],'196.46.1.1',100,0,ARRAY['37148:1000'],'igp',true,true,'valid','found',true,2,NOW()-INTERVAL '30 days',NOW()-INTERVAL '1 hour'),
('105.112.0.0/14',29465,ARRAY[29465,6453,3356],'105.112.1.1',100,0,ARRAY['29465:1000'],'igp',true,true,'valid','found',true,2,NOW()-INTERVAL '30 days',NOW()-INTERVAL '2 hours'),
('41.58.0.0/17',36873,ARRAY[36873,3257,1299],'41.58.1.1',100,0,ARRAY['36873:1000'],'igp',true,true,'valid','found',true,1,NOW()-INTERVAL '25 days',NOW()-INTERVAL '3 hours'),
('197.210.0.0/15',37076,ARRAY[37076,6461,3356],'197.210.1.1',100,0,ARRAY['37076:1000'],'igp',true,true,'valid','found',true,3,NOW()-INTERVAL '20 days',NOW()-INTERVAL '4 hours'),
('154.67.0.0/16',37282,ARRAY[37282,6453,3356],'154.67.1.1',100,0,ARRAY['37282:1000'],'igp',true,true,'unknown','found',true,4,NOW()-INTERVAL '15 days',NOW()-INTERVAL '5 hours'),
('8.8.8.0/24',15169,ARRAY[15169],'8.8.8.1',100,0,ARRAY['15169:1000'],'igp',true,false,'valid','found',false,NULL,NOW()-INTERVAL '10 days',NOW()-INTERVAL '6 hours'),
('196.45.0.0/16',37122,ARRAY[37122,6453,3356],'196.45.1.1',100,0,ARRAY['37122:1000'],'igp',true,true,'valid','found',true,5,NOW()-INTERVAL '5 days',NOW()-INTERVAL '1 hour'),
('203.45.0.0/16',4134,ARRAY[4134,3356],'203.45.1.1',100,0,ARRAY['4134:1000'],'igp',true,false,'valid','found',false,NULL,NOW()-INTERVAL '3 days',NOW()-INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- ─── Residency Checks ─────────────────────────────────────────────────────────
INSERT INTO residency_checks (organization_id, asset_id, check_type, data_classification, storage_location, storage_provider, storage_region, is_compliant, violation_type, violation_details, remediation_required, remediation_deadline, remediation_status, checked_at, created_at)
VALUES
(1,1,'automated','tier2_financial','Lagos, Nigeria','AWS','af-south-1',true,NULL,NULL,false,NULL,'not_required',NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days'),
(2,2,'automated','tier1_pii','Dublin, Ireland','AWS','eu-west-1',false,'cross_border_without_approval','Customer PII stored outside Nigeria without NDPC approval',true,NOW()+INTERVAL '30 days','pending',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(3,3,'manual','tier3_health','London, UK','Azure','uksouth',false,'cross_border_without_approval','Patient health records stored in UK without adequate safeguards',true,NOW()+INTERVAL '14 days','in_progress',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(4,4,'automated','tier1_pii','Lagos, Nigeria','GCP','africa-south1',true,NULL,NULL,false,NULL,'not_required',NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(5,5,'automated','tier5_public','Houston, USA','Azure','eastus',false,'cross_border_without_approval','Operational data stored in US without proper transfer mechanism',true,NOW()+INTERVAL '45 days','pending',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Drift Alerts ─────────────────────────────────────────────────────────────
INSERT INTO drift_alerts (organization_id, alert_type, severity, title, description, baseline_value, current_value, drift_percentage, auto_remediated, remediation_action, status, acknowledged_by, acknowledged_at, resolved_at, created_at)
VALUES
(1,'compliance_score_drop','high','Compliance Score Dropped 15%','First Bank compliance score dropped from 87 to 72 over 30 days',87,72,17.2,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '5 days'),
(2,'new_violation_spike','critical','Violation Count Spike Detected','MTN Nigeria violations increased 300% in 7 days',5,20,300,false,NULL,'acknowledged',1,NOW()-INTERVAL '3 days',NULL,NOW()-INTERVAL '4 days'),
(3,'data_transfer_anomaly','medium','Unusual Data Transfer Volume','LUTH data transfer volume 5x normal baseline',100,520,420,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '3 days'),
(4,'policy_change_detected','low','Privacy Policy Updated Without Notification','FME updated privacy policy without notifying NDPC',NULL,NULL,NULL,false,NULL,'resolved',1,NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day',NOW()-INTERVAL '2 days'),
(5,'asset_exposure','high','New Internet-Exposed Asset Detected','NNPC has new publicly accessible database endpoint',0,1,NULL,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Monitoring Snapshots ─────────────────────────────────────────────────────
INSERT INTO monitoring_snapshots (organization_id, snapshot_type, compliance_score, violation_count, open_cases, pending_actions, risk_level, data_assets_count, last_audit_date, next_audit_date, metadata, created_at)
VALUES
(1,'weekly',72,8,2,5,'high',45,'2025-10-15','2026-04-15','{"trend":"declining","previous_score":87}',NOW()-INTERVAL '7 days'),
(2,'weekly',85,3,1,2,'medium',120,'2025-11-20','2026-05-20','{"trend":"stable","previous_score":84}',NOW()-INTERVAL '7 days'),
(3,'weekly',68,12,3,8,'high',30,'2025-09-10','2026-03-10','{"trend":"declining","previous_score":75}',NOW()-INTERVAL '7 days'),
(4,'weekly',91,1,0,1,'low',85,'2025-12-01','2026-06-01','{"trend":"improving","previous_score":88}',NOW()-INTERVAL '7 days'),
(5,'weekly',78,5,2,3,'medium',200,'2025-10-30','2026-04-30','{"trend":"stable","previous_score":80}',NOW()-INTERVAL '7 days'),
(1,'monthly',72,8,2,5,'high',45,'2025-10-15','2026-04-15','{"month":"2026-04","violations_by_type":{"consent":3,"transfer":2,"breach":3}}',NOW()-INTERVAL '14 days'),
(2,'monthly',85,3,1,2,'medium',120,'2025-11-20','2026-05-20','{"month":"2026-04","violations_by_type":{"consent":1,"retention":2}}',NOW()-INTERVAL '14 days'),
(3,'monthly',68,12,3,8,'high',30,'2025-09-10','2026-03-10','{"month":"2026-04","violations_by_type":{"consent":5,"breach":4,"transfer":3}}',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Onboarding Phases ────────────────────────────────────────────────────────
INSERT INTO onboarding_phases (organization_id, phase_name, phase_order, status, started_at, completed_at, notes, created_at)
VALUES
(1,'Initial Registration',1,'completed',NOW()-INTERVAL '180 days',NOW()-INTERVAL '175 days','Organisation registered successfully',NOW()-INTERVAL '180 days'),
(1,'Document Verification',2,'completed',NOW()-INTERVAL '175 days',NOW()-INTERVAL '170 days','CAC certificate and board resolution verified',NOW()-INTERVAL '175 days'),
(1,'DPO Appointment',3,'completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '165 days','DPO appointed and registered',NOW()-INTERVAL '170 days'),
(1,'Compliance Assessment',4,'completed',NOW()-INTERVAL '165 days',NOW()-INTERVAL '150 days','Initial compliance assessment completed - score 72',NOW()-INTERVAL '165 days'),
(1,'Policy Review',5,'in_progress',NOW()-INTERVAL '150 days',NULL,'Privacy policy under review',NOW()-INTERVAL '150 days'),
(2,'Initial Registration',1,'completed',NOW()-INTERVAL '200 days',NOW()-INTERVAL '195 days','Organisation registered successfully',NOW()-INTERVAL '200 days'),
(2,'Document Verification',2,'completed',NOW()-INTERVAL '195 days',NOW()-INTERVAL '190 days','All documents verified',NOW()-INTERVAL '195 days'),
(2,'DPO Appointment',3,'completed',NOW()-INTERVAL '190 days',NOW()-INTERVAL '185 days','DPO appointed',NOW()-INTERVAL '190 days'),
(2,'Compliance Assessment',4,'completed',NOW()-INTERVAL '185 days',NOW()-INTERVAL '170 days','Assessment completed - score 85',NOW()-INTERVAL '185 days'),
(2,'Policy Review',5,'completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '160 days','All policies approved',NOW()-INTERVAL '170 days')
ON CONFLICT DO NOTHING;

-- ─── Portal Submissions ───────────────────────────────────────────────────────
INSERT INTO portal_submissions (organization_id, submission_type, sector, phase, title, description, submitted_by, status, reviewer_id, review_notes, submitted_at, reviewed_at, created_at)
VALUES
(1,'compliance_return','Financial Services','annual','Annual Compliance Return 2025','Annual NDPR compliance return for FY2025','compliance@firstbank.com','approved',1,'All requirements met. Organisation is compliant.',NOW()-INTERVAL '30 days',NOW()-INTERVAL '20 days',NOW()-INTERVAL '30 days'),
(2,'breach_notification','Telecommunications','immediate','Data Breach Notification - January 2026','Notification of data breach affecting 50,000 subscribers','security@mtn.com','under_review',1,NULL,NOW()-INTERVAL '15 days',NULL,NOW()-INTERVAL '15 days'),
(3,'dpia_submission','Healthcare','quarterly','DPIA Submission - EHR System','DPIA for new Electronic Health Records system','dpo@luth.gov.ng','approved',1,'DPIA approved with conditions.',NOW()-INTERVAL '25 days',NOW()-INTERVAL '18 days',NOW()-INTERVAL '25 days'),
(4,'policy_registration','Government','initial','Privacy Policy Registration','Registration of updated privacy policy','compliance@fme.gov.ng','approved',1,'Policy meets NDPR requirements.',NOW()-INTERVAL '20 days',NOW()-INTERVAL '15 days',NOW()-INTERVAL '20 days'),
(5,'transfer_approval','Energy','ad_hoc','Cross-Border Transfer Approval Request','Request for approval of data transfer to US-based service provider','dpo@nnpc.gov.ng','pending',NULL,NULL,NOW()-INTERVAL '5 days',NULL,NOW()-INTERVAL '5 days'),
(6,'complaint_response','E-Commerce','immediate','Response to Consumer Complaint','Response to NDPC complaint reference NDPC-COMP-2026-001','legal@jumia.com','submitted',NULL,NULL,NOW()-INTERVAL '3 days',NULL,NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── Compliance Audit Returns ─────────────────────────────────────────────────
INSERT INTO compliance_audit_returns (organization_id, return_period, return_type, compliance_score, total_controls, controls_implemented, controls_partial, controls_missing, critical_findings, high_findings, medium_findings, low_findings, dpo_name, dpo_email, submitted_by, submission_date, status, reviewer_id, review_notes, created_at)
VALUES
(1,'2025','annual',72,50,36,8,6,2,3,5,4,'Adewale Adeyemi','dpo@firstbank.com','Chief Compliance Officer','2026-01-31','approved',1,'Annual return reviewed and accepted. Improvement plan required for critical findings.',NOW()-INTERVAL '75 days'),
(2,'2025','annual',85,50,43,5,2,0,2,3,2,'Chukwuemeka Obi','dpo@mtn.com','Head of Compliance','2026-01-31','approved',1,'Return accepted. Good compliance posture.',NOW()-INTERVAL '70 days'),
(3,'2025','annual',68,50,34,9,7,3,4,6,5,'Dr. Amaka Nwosu','dpo@luth.gov.ng','Director of Administration','2026-02-15','under_review',NULL,NULL,NOW()-INTERVAL '55 days'),
(4,'2025','annual',91,50,46,3,1,0,0,2,1,'Ibrahim Suleiman','dpo@fme.gov.ng','Director of Legal Services','2026-01-31','approved',1,'Excellent compliance. Minimal findings.',NOW()-INTERVAL '65 days'),
(5,'2025','annual',78,50,39,7,4,1,2,4,3,'Ngozi Okonkwo','dpo@nnpc.gov.ng','Chief Compliance Officer','2026-02-28','pending',NULL,NULL,NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── Penalty Appeals ──────────────────────────────────────────────────────────
INSERT INTO penalty_appeals (penalty_id, organization_id, appeal_grounds, supporting_documents, legal_representative, appeal_date, hearing_date, status, decision, decision_notes, decided_by, decided_at, created_at)
VALUES
(2,2,'Disproportionate penalty amount given the nature of the violation and the organisation remediation efforts',ARRAY['remediation_plan.pdf','compliance_certificate.pdf'],'Adewale & Associates Legal','2026-02-15','2026-03-20','under_review',NULL,NULL,NULL,NULL,NOW()-INTERVAL '55 days'),
(3,3,'First-time offence with immediate remediation. Penalty amount exceeds NDPR guidelines for healthcare sector.',ARRAY['dpia_report.pdf','remediation_evidence.pdf'],'Healthcare Legal Partners','2026-02-20',NULL,'submitted',NULL,NULL,NULL,NULL,NOW()-INTERVAL '50 days')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Actions ──────────────────────────────────────────────────────
INSERT INTO enforcement_actions (violation_id, organization_id, workflow_id, action_type, status, notice_issued_at, audit_scheduled_at, penalty_imposed_at, penalty_amount, notes, created_at, updated_at)
VALUES
(1,1,'WF-ENF-001','formal_notice','completed',NOW()-INTERVAL '24 days',NULL,NULL,NULL,'Formal notice issued for data breach',NOW()-INTERVAL '24 days',NOW()-INTERVAL '20 days'),
(2,2,'WF-ENF-002','formal_notice','completed',NOW()-INTERVAL '29 days',NULL,NULL,NULL,'Formal notice issued for NDPR violations',NOW()-INTERVAL '29 days',NOW()-INTERVAL '25 days'),
(2,2,'WF-ENF-002','audit_scheduled','completed',NULL,NOW()-INTERVAL '20 days',NULL,NULL,'Compliance audit scheduled',NOW()-INTERVAL '25 days',NOW()-INTERVAL '20 days'),
(3,3,'WF-ENF-003','formal_notice','completed',NOW()-INTERVAL '19 days',NULL,NULL,NULL,'Formal notice issued for consent violations',NOW()-INTERVAL '19 days',NOW()-INTERVAL '15 days'),
(4,4,'WF-ENF-004','penalty_imposed','completed',NULL,NULL,NOW()-INTERVAL '20 days',25000000,'Penalty of N25M imposed and paid',NOW()-INTERVAL '25 days',NOW()-INTERVAL '20 days'),
(5,5,'WF-ENF-005','formal_notice','pending',NOW()-INTERVAL '14 days',NULL,NULL,NULL,'Formal notice issued for data transfer violations',NOW()-INTERVAL '14 days',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Streaming Events ─────────────────────────────────────────────────────────
INSERT INTO streaming_events (event_type, source_service, organization_id, payload, severity, processed, processed_at, created_at)
VALUES
('compliance_violation_detected','compliance-engine',1,'{"violation_type":"data_breach","severity":"critical","affected_records":50000}','critical',true,NOW()-INTERVAL '29 days 23 hours',NOW()-INTERVAL '30 days'),
('aml_alert_triggered','aml-scorer',NULL,'{"case_ref":"AML-2026-002","risk_score":92,"alert_type":"sanctions_hit"}','high',true,NOW()-INTERVAL '27 days 23 hours',NOW()-INTERVAL '28 days'),
('fraud_alert_raised','fraud-detection-engine',NULL,'{"transaction_ref":"TXN-ZBP-FRAUD-001","risk_score":95,"alert_type":"account_takeover"}','critical',true,NOW()-INTERVAL '3 days 23 hours',NOW()-INTERVAL '4 days'),
('kyc_verification_completed','kyc-analyzer',NULL,'{"customer_ref":"CUST-FBN-001","tier":3,"status":"verified"}','low',true,NOW()-INTERVAL '5 days 23 hours',NOW()-INTERVAL '6 months'),
('bgp_route_anomaly','bgp-validator',2,'{"prefix":"105.112.0.0/14","anomaly_type":"route_hijack_suspected","asn":29465}','high',true,NOW()-INTERVAL '9 days 23 hours',NOW()-INTERVAL '10 days'),
('data_residency_violation','residency-enforcer',2,'{"asset_id":2,"violation_type":"cross_border_without_approval","storage_region":"eu-west-1"}','high',false,NULL,NOW()-INTERVAL '5 days'),
('enforcement_case_escalated','compliance-engine',2,'{"case_ref":"NDPC-ENF-2026-002","escalation_reason":"non_response","overdue_days":15}','high',true,NOW()-INTERVAL '14 days 23 hours',NOW()-INTERVAL '15 days'),
('swift_message_held','swift-gateway',NULL,'{"message_ref":"TXN-SWIFT-006","reason":"sanctions_match","bic":"HSBCGB2L"}','critical',false,NULL,NOW()-INTERVAL '15 days'),
('drift_alert_generated','drift-detector',1,'{"alert_type":"compliance_score_drop","from":87,"to":72,"percentage":17.2}','high',true,NOW()-INTERVAL '4 days 23 hours',NOW()-INTERVAL '5 days'),
('worker_health_degraded','worker-manager',NULL,'{"worker_id":"ml-prediction","status":"degraded","port":8085}','medium',true,NOW()-INTERVAL '1 day 23 hours',NOW()-INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ─── Webhook Subscriptions ────────────────────────────────────────────────────
INSERT INTO webhook_subscriptions (organization_id, url, secret, event_types, is_active, description, created_at)
VALUES
(1,'https://compliance.firstbank.com/webhooks/ndsep','secret-fbngla-001',ARRAY['compliance_violation','enforcement_action','breach_notification'],true,'First Bank NDSEP webhook endpoint',NOW()-INTERVAL '60 days'),
(2,'https://api.mtn.com/ndsep/events','secret-mtnngla-001',ARRAY['compliance_violation','data_residency_alert','bgp_anomaly'],true,'MTN Nigeria NDSEP integration',NOW()-INTERVAL '45 days'),
(3,'https://it.luth.gov.ng/ndsep/webhook','secret-luth-001',ARRAY['dpia_status_change','transfer_approval','enforcement_action'],true,'LUTH NDSEP webhook',NOW()-INTERVAL '30 days'),
(4,'https://systems.fme.gov.ng/ndsep/hook','secret-fme-001',ARRAY['compliance_violation','audit_return_status'],true,'FME NDSEP integration',NOW()-INTERVAL '20 days'),
(5,'https://digital.nnpc.gov.ng/ndsep/events','secret-nnpc-001',ARRAY['compliance_violation','transfer_approval','enforcement_action'],true,'NNPC NDSEP webhook',NOW()-INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- ─── Webhook Deliveries ───────────────────────────────────────────────────────
INSERT INTO webhook_deliveries (subscription_id, event_type, payload, response_status, response_body, attempt_count, delivered_at, next_retry_at, created_at)
VALUES
(1,'compliance_violation','{"event":"compliance_violation","org_id":1,"severity":"critical"}',200,'{"status":"received"}',1,NOW()-INTERVAL '29 days',NULL,NOW()-INTERVAL '30 days'),
(2,'bgp_anomaly','{"event":"bgp_anomaly","prefix":"105.112.0.0/14","asn":29465}',200,'{"status":"ok"}',1,NOW()-INTERVAL '9 days',NULL,NOW()-INTERVAL '10 days'),
(1,'enforcement_action','{"event":"enforcement_action","case_ref":"NDPC-ENF-2026-001"}',500,'{"error":"Internal Server Error"}',3,NULL,NOW()+INTERVAL '1 hour',NOW()-INTERVAL '24 days'),
(3,'dpia_status_change','{"event":"dpia_status_change","dpia_id":3,"status":"under_review"}',200,'{"status":"received"}',1,NOW()-INTERVAL '4 days',NULL,NOW()-INTERVAL '5 days'),
(5,'transfer_approval','{"event":"transfer_approval","transfer_id":5,"status":"approved"}',200,'{"status":"ok"}',1,NOW()-INTERVAL '4 days',NULL,NOW()-INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Clients ─────────────────────────────────────────────────────────────
INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, contact_phone, status, risk_level, compliance_score, onboarded_at, metadata, created_at)
VALUES
(1,'Stanbic IBTC Bank Plc','Financial Services','Lagos, Nigeria','Amaka Obi','amaka.obi@stanbicibtc.com','+2348012345678','active','low',82,NOW()-INTERVAL '180 days','{"client_type":"enterprise","contract_value":15000000}',NOW()-INTERVAL '180 days'),
(1,'Fidelity Bank Plc','Financial Services','Lagos, Nigeria','Tunde Adeyemi','tunde.adeyemi@fidelitybank.ng','+2348023456789','active','medium',75,NOW()-INTERVAL '120 days','{"client_type":"enterprise","contract_value":12000000}',NOW()-INTERVAL '120 days'),
(1,'Jumia Technologies AG','E-Commerce','Lagos, Nigeria','Ngozi Williams','ngozi.williams@jumia.com','+2348034567890','active','medium',68,NOW()-INTERVAL '90 days','{"client_type":"sme","contract_value":8000000}',NOW()-INTERVAL '90 days'),
(2,'AIICO Insurance Plc','Insurance','Lagos, Nigeria','Chidi Eze','chidi.eze@aiico.com.ng','+2348045678901','active','low',88,NOW()-INTERVAL '150 days','{"client_type":"enterprise","contract_value":10000000}',NOW()-INTERVAL '150 days'),
(2,'Nigerian Ports Authority','Transportation','Lagos, Nigeria','Fatima Bello','fatima.bello@nigerianports.gov.ng','+2348056789012','active','high',55,NOW()-INTERVAL '60 days','{"client_type":"government","contract_value":20000000}',NOW()-INTERVAL '60 days'),
(3,'Kuda Microfinance Bank','Financial Services','Lagos, Nigeria','Seun Okonkwo','seun.okonkwo@kuda.com','+2348067890123','active','low',91,NOW()-INTERVAL '45 days','{"client_type":"fintech","contract_value":5000000}',NOW()-INTERVAL '45 days'),
(3,'PalmPay Ltd','Financial Services','Lagos, Nigeria','Yemi Adebayo','yemi.adebayo@palmpay.com','+2348078901234','active','low',85,NOW()-INTERVAL '30 days','{"client_type":"fintech","contract_value":6000000}',NOW()-INTERVAL '30 days'),
(1,'Carbon (One Finance Ltd)','Financial Services','Lagos, Nigeria','Bisi Okafor','bisi.okafor@carbon.ng','+2348089012345','inactive','medium',62,NOW()-INTERVAL '200 days','{"client_type":"fintech","contract_value":4000000}',NOW()-INTERVAL '200 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Engagements ───────────────────────────────────────────────────
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, engagement_ref, engagement_type, scope, start_date, end_date, status, lead_auditor, team_members, total_controls, controls_reviewed, findings_critical, findings_high, findings_medium, findings_low, compliance_score, report_url, created_at)
VALUES
(1,1,'ENG-DG-2026-001','full_audit','Full NDPR compliance audit including data mapping, consent management, and breach response','2026-01-10','2026-02-10','completed','Senior Auditor A',ARRAY['Auditor B','Auditor C'],50,50,1,2,4,3,82,'https://storage.ndsep.ng/reports/ENG-DG-2026-001.pdf',NOW()-INTERVAL '90 days'),
(1,2,'ENG-DG-2026-002','gap_assessment','NDPR gap assessment for Fidelity Bank','2026-02-01','2026-02-28','completed','Senior Auditor A',ARRAY['Auditor D'],30,30,2,3,5,4,75,'https://storage.ndsep.ng/reports/ENG-DG-2026-002.pdf',NOW()-INTERVAL '60 days'),
(2,4,'ENG-PS-2026-001','full_audit','Comprehensive NDPR audit for AIICO Insurance','2026-01-20','2026-02-20','completed','Lead Auditor X',ARRAY['Auditor Y'],50,50,0,1,3,2,88,'https://storage.ndsep.ng/reports/ENG-PS-2026-001.pdf',NOW()-INTERVAL '55 days'),
(3,6,'ENG-CF-2026-001','policy_review','Privacy policy and consent management review for Kuda','2026-03-01','2026-03-15','completed','Auditor P',ARRAY[]::text[],20,20,0,0,2,1,91,'https://storage.ndsep.ng/reports/ENG-CF-2026-001.pdf',NOW()-INTERVAL '30 days'),
(1,3,'ENG-DG-2026-003','dpia_support','DPIA support for Jumia e-commerce platform','2026-03-10',NULL,'in_progress','Senior Auditor A',ARRAY['Auditor E'],25,15,0,1,2,3,NULL,NULL,NOW()-INTERVAL '35 days'),
(2,5,'ENG-PS-2026-002','full_audit','Full NDPR audit for Nigerian Ports Authority','2026-04-01',NULL,'in_progress','Lead Auditor X',ARRAY['Auditor Z','Auditor W'],50,10,1,2,3,2,NULL,NULL,NOW()-INTERVAL '13 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Training Sessions ───────────────────────────────────────────────────
INSERT INTO dpco_training_sessions (dpco_org_id, client_id, session_title, session_type, delivery_mode, scheduled_at, duration_hours, attendees_count, facilitator, topics_covered, materials_url, status, feedback_score, created_at)
VALUES
(1,1,'NDPR Fundamentals for Banking Staff','awareness','virtual','2026-01-15 09:00:00',3,45,'Senior Auditor A',ARRAY['NDPR overview','Data subject rights','Breach notification'],'https://storage.ndsep.ng/training/NDPR-Banking-101.pdf','completed',4.5,NOW()-INTERVAL '89 days'),
(1,2,'Data Protection Officer Training','dpo_training','in_person','2026-02-10 09:00:00',8,5,'Senior Auditor A',ARRAY['DPO responsibilities','DPIA methodology','Regulatory engagement'],'https://storage.ndsep.ng/training/DPO-Training.pdf','completed',4.8,NOW()-INTERVAL '63 days'),
(2,4,'Insurance Sector NDPR Compliance','sector_specific','virtual','2026-01-25 10:00:00',4,30,'Lead Auditor X',ARRAY['Insurance data processing','Customer consent','Retention policies'],'https://storage.ndsep.ng/training/Insurance-NDPR.pdf','completed',4.2,NOW()-INTERVAL '79 days'),
(3,6,'Fintech Data Privacy Best Practices','awareness','virtual','2026-03-20 14:00:00',2,25,'Auditor P',ARRAY['Fintech data flows','BVN/NIN handling','Customer consent'],'https://storage.ndsep.ng/training/Fintech-Privacy.pdf','completed',4.7,NOW()-INTERVAL '25 days'),
(1,3,'E-Commerce Privacy Compliance','sector_specific','virtual','2026-04-15 10:00:00',3,20,'Senior Auditor A',ARRAY['E-commerce data collection','Cookie consent','Cross-border transfers'],NULL,'scheduled',NULL,NOW()-INTERVAL '5 days'),
(2,5,'Government Sector Data Protection','sector_specific','in_person','2026-04-20 09:00:00',6,40,'Lead Auditor X',ARRAY['Government data handling','FOIA compliance','Citizen data rights'],NULL,'scheduled',NULL,NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Evidence Items ──────────────────────────────────────────────────────
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, evidence_type, title, description, file_url, file_hash, collected_by, collection_date, expiry_date, status, tags, created_at)
VALUES
(1,1,'policy_document','First Bank Privacy Policy v3.2','Updated privacy policy meeting NDPR requirements','https://storage.ndsep.ng/evidence/FBN-Privacy-Policy-v3.2.pdf','sha256:abc123def456','Senior Auditor A','2026-01-15','2027-01-15','verified',ARRAY['policy','privacy','banking'],NOW()-INTERVAL '89 days'),
(1,1,'audit_report','First Bank NDPR Audit Report 2026','Full audit report for First Bank NDPR compliance','https://storage.ndsep.ng/evidence/FBN-Audit-2026.pdf','sha256:def456ghi789','Senior Auditor A','2026-02-10','2028-02-10','verified',ARRAY['audit','banking','ndpr'],NOW()-INTERVAL '63 days'),
(2,3,'dpo_appointment','AIICO DPO Appointment Letter','Formal appointment of Data Protection Officer','https://storage.ndsep.ng/evidence/AIICO-DPO-Appointment.pdf','sha256:ghi789jkl012','Lead Auditor X','2026-01-20','2028-01-20','verified',ARRAY['dpo','insurance'],NOW()-INTERVAL '84 days'),
(3,4,'training_certificate','Kuda Staff Training Completion Certificates','Training completion certificates for 25 staff','https://storage.ndsep.ng/evidence/Kuda-Training-Certs.pdf','sha256:jkl012mno345','Auditor P','2026-03-20','2027-03-20','verified',ARRAY['training','fintech'],NOW()-INTERVAL '25 days'),
(1,5,'dpia_report','Jumia DPIA Draft Report','Draft DPIA report for Jumia e-commerce platform','https://storage.ndsep.ng/evidence/Jumia-DPIA-Draft.pdf','sha256:mno345pqr678','Senior Auditor A','2026-03-25',NULL,'pending_review',ARRAY['dpia','ecommerce'],NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Verification Statements ────────────────────────────────────────────
INSERT INTO dpco_verification_statements (dpco_org_id, client_id, engagement_id, statement_ref, statement_type, compliance_level, summary, findings_summary, recommendations, valid_from, valid_until, issued_by, signed_at, status, created_at)
VALUES
(1,1,1,'VS-DG-2026-001','full_compliance_certificate','substantial','First Bank of Nigeria Plc demonstrates substantial compliance with the Nigeria Data Protection Regulation (NDPR) 2019 and Nigeria Data Protection Act (NDPA) 2023.','1 critical finding (customer data analytics profiling without explicit consent) and 5 medium findings identified. All high-priority findings remediated.','Implement explicit consent mechanism for analytics profiling; complete staff training programme; update retention schedules.','2026-02-15','2027-02-15','DataGuard Nigeria Ltd','2026-02-15','active',NOW()-INTERVAL '58 days'),
(2,4,3,'VS-PS-2026-001','full_compliance_certificate','high','AIICO Insurance Plc demonstrates high compliance with NDPR and NDPA requirements.','No critical findings. 1 high finding (retention policy gaps) remediated during audit. 3 medium findings remain.','Update retention policies for legacy systems; implement automated retention enforcement; conduct annual DPIA.','2026-02-25','2027-02-25','PrivacyShield Associates','2026-02-25','active',NOW()-INTERVAL '48 days'),
(3,6,4,'VS-CF-2026-001','policy_compliance_certificate','high','Kuda Microfinance Bank demonstrates high compliance with NDPR requirements for fintech operations.','No critical or high findings. 2 medium findings related to cookie consent implementation.','Implement granular cookie consent; update privacy notice for BVN/NIN processing.','2026-03-20','2027-03-20','ComplianceFirst Ltd','2026-03-20','active',NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
INSERT INTO dpco_policy_drafts (dpco_org_id, client_id, engagement_id, policy_type, title, version, content, status, reviewed_by, review_notes, approved_at, created_at)
VALUES
(1,1,1,'privacy_policy','First Bank Privacy Policy','3.2','Privacy Policy: First Bank of Nigeria Plc is committed to protecting your personal data under NDPR 2019 and NDPA 2023.','approved','Senior Auditor A','Policy meets all NDPR requirements. Approved for publication.',NOW()-INTERVAL '60 days',NOW()-INTERVAL '89 days'),
(1,2,2,'data_retention_policy','Fidelity Bank Data Retention Policy','1.1','Data Retention Policy: This policy governs the retention and disposal of personal data at Fidelity Bank.','under_review','Senior Auditor A',NULL,NULL,NOW()-INTERVAL '50 days'),
(2,4,3,'dpo_charter','AIICO DPO Charter','2.0','DPO Charter: This charter defines the role, responsibilities and authority of the Data Protection Officer at AIICO Insurance.','approved','Lead Auditor X','DPO charter meets NDPR Article 30 requirements.',NOW()-INTERVAL '55 days',NOW()-INTERVAL '84 days'),
(3,6,4,'consent_framework','Kuda Consent Management Framework','1.0','Consent Management Framework: This framework governs how Kuda collects, records and manages customer consent for data processing.','approved','Auditor P','Consent framework meets NDPR requirements for fintech.',NOW()-INTERVAL '25 days',NOW()-INTERVAL '35 days'),
(1,3,5,'dpia_template','Jumia DPIA Template','1.0','DPIA Template: This template guides the DPIA process for Jumia e-commerce platform data processing activities.','draft',NULL,NULL,NULL,NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Engagement Requests ─────────────────────────────────────────────────
INSERT INTO dpco_engagement_requests (org_name, org_sector, org_country, org_registration_number, contact_name, contact_email, contact_phone, dpco_org_id, audit_scope, preferred_start_date, estimated_data_subjects, processing_activities, status, dpco_response_note, responded_at, engagement_id, reference_token, created_at)
VALUES
('Moniepoint Microfinance Bank','Financial Services','Nigeria','RC-1700','Tosin Eniolorunda','tosin@moniepoint.com','+2348012345679',1,'Full NDPR compliance audit for fintech operations','2026-05-01','5000000',ARRAY['payment_processing','kyc_verification','customer_analytics'],'accepted','We are pleased to accept this engagement. Our team will contact you shortly.',NOW()-INTERVAL '5 days',NULL,'REQ-DG-2026-001',NOW()-INTERVAL '10 days'),
('VFD Microfinance Bank','Financial Services','Nigeria','RC-2000','Gbenga Omolokun','gbenga@vfd.ng','+2348023456780',2,'NDPR gap assessment and policy review','2026-05-15','2000000',ARRAY['deposit_taking','loan_processing','customer_onboarding'],'pending',NULL,NULL,NULL,'REQ-PS-2026-001',NOW()-INTERVAL '7 days'),
('Opay Digital Services Ltd','Financial Services','Nigeria','RC-1604','Yahui Zhou','yahui@opay.com','+2348034567891',3,'Privacy policy review and staff training','2026-06-01','10000000',ARRAY['payment_processing','agent_banking','customer_data'],'pending',NULL,NULL,NULL,'REQ-CF-2026-001',NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Accreditation Applications ─────────────────────────────────────────
INSERT INTO dpco_accreditation_applications (org_name, cac_number, rc_number, tax_id, dpo_name, dpo_email, dpo_phone, dpo_qualification, organisation_type, tier_applied, state, address, services, sectors, website, status, submitted_at, reviewed_by, review_notes, approved_at, licence_issued_at, licence_expiry, created_at)
VALUES
('DataGuard Nigeria Ltd','CAC-DG-001','RC-100001','TIN-DG-001','Adebayo Okafor','adebayo@dataguard.ng','+2348012345678','CIPP/E, CIPM','limited_liability','professional','Lagos','15 Broad Street, Lagos Island',ARRAY['full_audit','gap_assessment','dpo_as_service'],ARRAY['banking','fintech','insurance'],'https://dataguard.ng','approved','2025-06-01',1,'All requirements met. Excellent application.',NOW()-INTERVAL '300 days',NOW()-INTERVAL '295 days',NOW()+INTERVAL '1 year 65 days',NOW()-INTERVAL '310 days'),
('PrivacyShield Associates','CAC-PS-001','RC-100002','TIN-PS-001','Ngozi Adeyemi','ngozi@privacyshield.ng','+2348023456789','CIPP/E, LLM','limited_liability','professional','Lagos','42 Victoria Island, Lagos',ARRAY['full_audit','policy_review','training'],ARRAY['insurance','healthcare','government'],'https://privacyshield.ng','approved','2025-07-15',1,'Strong application. Approved.',NOW()-INTERVAL '270 days',NOW()-INTERVAL '265 days',NOW()+INTERVAL '1 year 95 days',NOW()-INTERVAL '280 days'),
('ComplianceFirst Ltd','CAC-CF-001','RC-100003','TIN-CF-001','Emeka Nwosu','emeka@compliancefirst.ng','+2348034567890','CIPP/E, CIPM','limited_liability','professional','Abuja','8 Adeola Odeku Street, Abuja',ARRAY['gap_assessment','dpo_as_service','training'],ARRAY['fintech','ecommerce','telecom'],'https://compliancefirst.ng','approved','2025-08-01',1,'Approved with conditions. Must complete advanced training.',NOW()-INTERVAL '255 days',NOW()-INTERVAL '250 days',NOW()+INTERVAL '1 year 110 days',NOW()-INTERVAL '265 days'),
('TechPrivacy Solutions','CAC-TP-001','RC-100004','TIN-TP-001','Aisha Mohammed','aisha@techprivacy.ng','+2348045678901','CIPP/E','limited_liability','associate','Kano','22 Ahmadu Bello Way, Kano',ARRAY['policy_review','training'],ARRAY['healthcare','education'],'https://techprivacy.ng','under_review','2026-01-10',NULL,NULL,NULL,NULL,NULL,NOW()-INTERVAL '94 days'),
('NigeriaDataPro Ltd','CAC-NDP-001','RC-100005','TIN-NDP-001','Babatunde Fashola','babatunde@nigeriadatapro.ng','+2348056789012','CIPP/E, MBA','limited_liability','professional','Lagos','7 Adeola Hopewell Street, VI',ARRAY['full_audit','dpia_support','gap_assessment'],ARRAY['banking','government','energy'],'https://nigeriadatapro.ng','pending','2026-03-20',NULL,NULL,NULL,NULL,NULL,NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Performance Metrics (key-value format matching actual schema) ────────
INSERT INTO dpco_performance_metrics (dpco_org_id, metric_name, metric_value, period_start, period_end, recorded_at)
VALUES
(1,'cases_handled',24,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'avg_resolution_days',42,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'client_satisfaction_score',4.5,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'compliance_rate',0.87,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'revenue_ngn',45000000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(1,'active_clients',8,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'cases_handled',18,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'avg_resolution_days',38,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'client_satisfaction_score',4.2,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'compliance_rate',0.91,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'revenue_ngn',32000000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(2,'active_clients',5,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'cases_handled',12,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'avg_resolution_days',35,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'client_satisfaction_score',4.7,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'compliance_rate',0.94,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'revenue_ngn',22000000,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days'),
(3,'active_clients',4,'2026-01-01','2026-03-31',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── AI Governance Scores ─────────────────────────────────────────────────────
INSERT INTO ai_governance_scores (organization_id, ai_system_id, assessment_date, transparency_score, fairness_score, accountability_score, robustness_score, privacy_score, overall_score, risk_level, assessor_id, notes, created_at)
VALUES
(1,1,'2026-01-15',75,68,80,72,85,76,'medium',1,'Customer credit scoring model shows some fairness concerns in demographic groups',NOW()-INTERVAL '89 days'),
(2,2,'2026-01-20',82,78,85,80,88,83,'low',1,'Network anomaly detection system meets AI governance requirements',NOW()-INTERVAL '84 days'),
(3,3,'2026-02-01',65,55,70,68,72,66,'high',1,'Diagnostic AI system requires bias audit and explainability improvements',NOW()-INTERVAL '73 days'),
(4,4,'2026-02-10',88,85,90,87,92,88,'low',1,'Student performance prediction system demonstrates good governance',NOW()-INTERVAL '64 days'),
(5,5,'2026-02-20',71,65,75,70,78,72,'medium',1,'Predictive maintenance AI requires additional documentation',NOW()-INTERVAL '54 days')
ON CONFLICT DO NOTHING;

-- ─── In-App Notifications ─────────────────────────────────────────────────────
INSERT INTO in_app_notifications (user_id, title, body, notification_type, severity, is_read, action_url, metadata, created_at)
VALUES
(1,'Critical: Compliance Score Drop','First Bank compliance score dropped from 87 to 72. Immediate action required.','alert','critical',false,'/organizations/1','{"org_id":1,"score_change":-15}',NOW()-INTERVAL '5 days'),
(1,'AML Case Escalated','AML case AML-2026-002 has been escalated to NFIU.','alert','high',false,'/banking/aml','{"case_ref":"AML-2026-002"}',NOW()-INTERVAL '28 days'),
(1,'SWIFT Message On Hold','SWIFT message TXN-SWIFT-006 held due to sanctions match.','alert','critical',false,'/banking/swift','{"msg_ref":"TXN-SWIFT-006"}',NOW()-INTERVAL '15 days'),
(1,'New Enforcement Case','Enforcement case NDPC-ENF-2026-005 opened for NNPC.','info','medium',true,'/enforcement-cases','{"case_ref":"NDPC-ENF-2026-005"}',NOW()-INTERVAL '15 days'),
(1,'DPIA Submitted','LUTH submitted DPIA for EHR system. Review required.','info','low',true,'/dpia','{"dpia_id":3}',NOW()-INTERVAL '30 days'),
(1,'Data Residency Violation','MTN Nigeria storing customer PII in EU-West-1 without approval.','alert','high',false,'/monitoring','{"org_id":2,"region":"eu-west-1"}',NOW()-INTERVAL '5 days'),
(1,'Fraud Alert: Account Takeover','High-risk fraud alert for Zenith Bank account 9876543210.','alert','critical',false,'/banking/fraud','{"alert_type":"account_takeover","bank":"ZBP"}',NOW()-INTERVAL '4 days'),
(1,'BGP Route Anomaly','Potential route hijack detected for prefix 105.112.0.0/14 (MTN Nigeria).','alert','high',false,'/bgp','{"prefix":"105.112.0.0/14","asn":29465}',NOW()-INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── Notification Settings ────────────────────────────────────────────────────
INSERT INTO notification_settings (user_id, email_enabled, sms_enabled, push_enabled, alert_types, created_at)
VALUES
(1,true,true,true,ARRAY['critical','high','medium','low'],NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Control Ratings ───────────────────────────────────────────────
INSERT INTO dpco_audit_control_ratings (engagement_id, control_domain, control_id, control_name, rating, finding_severity, finding_description, recommendation, evidence_ref, created_at)
VALUES
(1,'data_governance','DG-001','Data Inventory and Classification','substantial','medium','Data inventory exists but lacks automated discovery for shadow IT assets','Implement automated data discovery tools','ENG-DG-2026-001-DG001',NOW()-INTERVAL '63 days'),
(1,'consent_management','CM-001','Consent Collection Mechanism','limited','high','Analytics consent bundled with service consent — not granular','Implement separate consent for each processing purpose','ENG-DG-2026-001-CM001',NOW()-INTERVAL '63 days'),
(1,'breach_response','BR-001','Breach Detection and Response','substantial','low','Breach response procedure exists and was tested','No action required','ENG-DG-2026-001-BR001',NOW()-INTERVAL '63 days'),
(3,'data_governance','DG-001','Data Inventory and Classification','high','low','Comprehensive data inventory maintained','Continue current practice','ENG-PS-2026-001-DG001',NOW()-INTERVAL '55 days'),
(3,'retention_policy','RP-001','Data Retention Schedule','substantial','high','Retention schedules exist but not enforced for legacy systems','Implement automated retention enforcement for legacy systems','ENG-PS-2026-001-RP001',NOW()-INTERVAL '55 days'),
(4,'consent_management','CM-001','Cookie Consent Implementation','substantial','medium','Cookie consent banner present but lacks granular controls','Implement category-based cookie consent','ENG-CF-2026-001-CM001',NOW()-INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Logs ──────────────────────────────────────────────────────────
INSERT INTO dpco_audit_logs (dpco_org_id, user_id, action, resource_type, resource_id, details, ip_address, created_at)
VALUES
(1,1,'engagement_created','engagement',1,'Created audit engagement ENG-DG-2026-001 for First Bank','196.45.12.34',NOW()-INTERVAL '90 days'),
(1,1,'report_generated','engagement',1,'Generated final audit report for ENG-DG-2026-001','196.45.12.34',NOW()-INTERVAL '63 days'),
(1,1,'verification_issued','verification_statement',1,'Issued verification statement VS-DG-2026-001','196.45.12.34',NOW()-INTERVAL '58 days'),
(2,1,'engagement_created','engagement',3,'Created audit engagement ENG-PS-2026-001 for AIICO Insurance','196.45.12.34',NOW()-INTERVAL '84 days'),
(2,1,'report_generated','engagement',3,'Generated final audit report for ENG-PS-2026-001','196.45.12.34',NOW()-INTERVAL '55 days'),
(3,1,'engagement_created','engagement',4,'Created audit engagement ENG-CF-2026-001 for Kuda','196.45.12.34',NOW()-INTERVAL '35 days'),
(3,1,'training_scheduled','training',5,'Scheduled e-commerce privacy training for Jumia','196.45.12.34',NOW()-INTERVAL '5 days'),
(1,1,'client_onboarded','client',3,'Jumia Technologies AG onboarded as DPCO client','196.45.12.34',NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Risk Predictions ────────────────────────────────────────────────────
INSERT INTO dpco_risk_predictions (dpco_org_id, client_id, prediction_date, risk_score, risk_level, key_risk_factors, recommended_actions, model_version, confidence_score, created_at)
VALUES
(1,1,'2026-04-01',35,'low',ARRAY['Strong governance framework','Regular staff training','Updated privacy policies'],ARRAY['Continue quarterly reviews','Maintain DPO engagement'],'v2.1',0.92,NOW()-INTERVAL '13 days'),
(1,2,'2026-04-01',55,'medium',ARRAY['Legacy system retention gaps','Incomplete staff training','Pending policy updates'],ARRAY['Prioritise legacy system remediation','Complete staff training programme'],'v2.1',0.87,NOW()-INTERVAL '13 days'),
(1,3,'2026-04-01',65,'medium',ARRAY['DPIA in progress','Cross-border transfer pending approval','New data processing activities'],ARRAY['Complete DPIA','Obtain transfer approval','Update privacy notice'],'v2.1',0.85,NOW()-INTERVAL '13 days'),
(2,4,'2026-04-01',20,'low',ARRAY['Excellent compliance posture','Strong DPO engagement','Regular audits'],ARRAY['Maintain current practices','Consider advanced certification'],'v2.1',0.95,NOW()-INTERVAL '13 days'),
(2,5,'2026-04-01',75,'high',ARRAY['Multiple audit findings','Slow remediation pace','Government sector complexity'],ARRAY['Accelerate remediation','Engage NDPC proactively','Implement quick wins'],'v2.1',0.83,NOW()-INTERVAL '13 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO AI Gap Analyses ─────────────────────────────────────────────────────
INSERT INTO dpco_ai_gap_analyses (dpco_org_id, client_id, engagement_id, analysis_date, gaps_identified, gap_details, priority_actions, estimated_remediation_days, model_version, created_at)
VALUES
(1,1,1,'2026-01-20',3,'{"gaps":[{"id":"GAP-001","domain":"consent","description":"Analytics consent not granular","severity":"high"},{"id":"GAP-002","domain":"retention","description":"Retention schedule incomplete for digital channels","severity":"medium"},{"id":"GAP-003","domain":"training","description":"Only 60% of staff completed NDPR training","severity":"medium"}]}',ARRAY['Implement granular consent mechanism','Update retention schedule','Complete staff training rollout'],45,'v1.3',NOW()-INTERVAL '84 days'),
(2,4,3,'2026-02-05',2,'{"gaps":[{"id":"GAP-001","domain":"retention","description":"Legacy system retention not automated","severity":"high"},{"id":"GAP-002","domain":"vendor_management","description":"Vendor DPA not updated for 3 processors","severity":"medium"}]}',ARRAY['Implement automated retention for legacy systems','Update vendor DPAs'],30,'v1.3',NOW()-INTERVAL '69 days'),
(3,6,4,'2026-03-10',2,'{"gaps":[{"id":"GAP-001","domain":"consent","description":"Cookie consent lacks granular categories","severity":"medium"},{"id":"GAP-002","domain":"privacy_notice","description":"BVN/NIN processing not clearly disclosed","severity":"medium"}]}',ARRAY['Implement category-based cookie consent','Update privacy notice for BVN/NIN'],21,'v1.3',NOW()-INTERVAL '35 days')
ON CONFLICT DO NOTHING;

-- ─── API Keys ─────────────────────────────────────────────────────────────────
INSERT INTO api_keys (organization_id, key_name, key_hash, key_prefix, scopes, rate_limit_per_hour, is_active, last_used_at, expires_at, created_by, created_at)
VALUES
(1,'First Bank Production API Key','sha256:fbngla-prod-hash-001','fbk_prod_',ARRAY['compliance:read','violations:read','reports:read'],1000,true,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '90 days'),
(2,'MTN Nigeria API Integration','sha256:mtnngla-prod-hash-001','mtn_prod_',ARRAY['compliance:read','bgp:read','residency:read'],2000,true,NOW()-INTERVAL '30 minutes',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '60 days'),
(3,'LUTH Data Portal Key','sha256:luth-prod-hash-001','lth_prod_',ARRAY['compliance:read','dpia:read','transfers:read'],500,true,NOW()-INTERVAL '2 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '45 days'),
(4,'FME Integration Key','sha256:fme-prod-hash-001','fme_prod_',ARRAY['compliance:read','reports:read'],500,true,NOW()-INTERVAL '6 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '30 days'),
(5,'NNPC API Key','sha256:nnpc-prod-hash-001','nnp_prod_',ARRAY['compliance:read','residency:read','transfers:read'],1000,true,NOW()-INTERVAL '3 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

SELECT 'Seed complete' AS status;
