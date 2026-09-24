-- ============================================================
-- NDSEP Comprehensive Seed Script — All Empty Tables
-- Run: PGPASSWORD=ndsep_secure_2026 psql -U ndsep_user -d ndsep_db -h localhost -f seed_all_tables.sql
-- ============================================================

BEGIN;

-- ─── Banking Institutions ────────────────────────────────────────────────────
INSERT INTO banking_institutions (name, cbn_license_number, bank_type, swift_code, sort_code, headquarters, ceo_name, total_assets_ngn, tier, status, bvn_integration_enabled, nin_integration_enabled, nibss_member, created_at) VALUES
('First Bank of Nigeria Plc',      'RC 6290',   'commercial',    'FBNINGLA', '011',  'Lagos',  'Olusegun Alebiosu',    8200000000000, 1, 'active', true,  true,  true, NOW() - INTERVAL '10 years'),
('Zenith Bank Plc',                'RC 84818',  'commercial',    'ZEIBNGLA', '057',  'Lagos',  'Adaora Umeoji',        9800000000000, 1, 'active', true,  true,  true, NOW() - INTERVAL '9 years'),
('Guaranty Trust Bank Plc',        'RC 152321', 'commercial',    'GTBINGLA', '058',  'Lagos',  'Segun Agbaje',         7500000000000, 1, 'active', true,  true,  true, NOW() - INTERVAL '8 years'),
('Access Bank Plc',                'RC 125384', 'commercial',    'ABNGNGLA', '044',  'Lagos',  'Roosevelt Ogbonna',    12000000000000,1, 'active', true,  true,  true, NOW() - INTERVAL '7 years'),
('United Bank for Africa Plc',     'RC 2457',   'commercial',    'UNAFNGLA', '033',  'Lagos',  'Oliver Alawuba',       8900000000000, 1, 'active', true,  true,  true, NOW() - INTERVAL '6 years'),
('Stanbic IBTC Bank Plc',          'RC 125097', 'commercial',    'SBICNGLA', '221',  'Lagos',  'Wole Adeniyi',         4200000000000, 2, 'active', true,  true,  true, NOW() - INTERVAL '5 years'),
('Fidelity Bank Plc',              'RC 103022', 'commercial',    'FIDTNGLA', '070',  'Lagos',  'Nneka Onyeali-Ikpe',   3100000000000, 2, 'active', true,  true,  true, NOW() - INTERVAL '5 years'),
('Union Bank of Nigeria Plc',      'RC 2337',   'commercial',    'UBNINGLA', '032',  'Lagos',  'Mudassir Amray',       2800000000000, 2, 'active', true,  false, true, NOW() - INTERVAL '4 years'),
('Sterling Bank Plc',              'RC 485047', 'commercial',    'NAMENGLA', '232',  'Lagos',  'Abubakar Suleiman',    1400000000000, 3, 'active', true,  false, true, NOW() - INTERVAL '4 years'),
('Wema Bank Plc',                  'RC 5754',   'commercial',    'WEMANGLA', '035',  'Lagos',  'Moruf Oseni',          1200000000000, 3, 'active', true,  false, true, NOW() - INTERVAL '3 years'),
('Keystone Bank Ltd',              'RC 1002',   'commercial',    'PLNINGLA', '082',  'Lagos',  'Hassan Imam',           900000000000, 3, 'active', false, false, true, NOW() - INTERVAL '3 years'),
('Polaris Bank Ltd',               'RC 1000',   'commercial',    'POLBNGLA', '076',  'Lagos',  'Kayode Lawal',          850000000000, 3, 'active', false, false, true, NOW() - INTERVAL '2 years'),
('Providus Bank Ltd',              'RC 1650',   'commercial',    'PROVNGLA', '101',  'Lagos',  'Walter Akpani',         600000000000, 3, 'active', false, false, false,NOW() - INTERVAL '2 years'),
('Jaiz Bank Plc',                  'RC 892882', 'non_interest',  'JAIZNGLA', '301',  'Abuja',  'Hassan Usman',          350000000000, 3, 'active', false, false, true, NOW() - INTERVAL '2 years'),
('Opay Digital Services Ltd',      'RC 1604',   'microfinance',  'OPAYNGLA', '999',  'Lagos',  'Yahui Zhou',            200000000000, 3, 'active', true,  true,  false,NOW() - INTERVAL '1 year'),
('Kuda Microfinance Bank',         'RC 1600',   'microfinance',  'KUDANGLA', '998',  'Lagos',  'Babs Ogundeyi',         150000000000, 3, 'active', true,  true,  false,NOW() - INTERVAL '1 year'),
('Moniepoint Microfinance Bank',   'RC 1700',   'microfinance',  'MONPNGLA', '997',  'Lagos',  'Tosin Eniolorunda',     180000000000, 3, 'active', true,  true,  false,NOW() - INTERVAL '1 year'),
('PalmPay Ltd',                    'RC 1800',   'microfinance',  'PALPNGLA', '996',  'Lagos',  'Sofia Zab',             120000000000, 3, 'active', true,  true,  false,NOW() - INTERVAL '6 months'),
('Carbon (One Finance Ltd)',       'RC 1900',   'microfinance',  'CARBNGLA', '995',  'Lagos',  'Chijioke Dozie',         90000000000, 3, 'active', true,  false, false,NOW() - INTERVAL '6 months'),
('VFD Microfinance Bank',          'RC 2000',   'microfinance',  'VFDMNGLA', '994',  'Lagos',  'Gbenga Omolokun',        70000000000, 3, 'active', true,  false, false,NOW() - INTERVAL '3 months')
ON CONFLICT DO NOTHING;

-- ─── KYC Records ─────────────────────────────────────────────────────────────
INSERT INTO kyc_records (bank_id, customer_ref, full_name, date_of_birth, bvn, nin, phone_number, email, address, state_of_origin, lga, nationality, id_type, id_number, id_expiry_date, selfie_url, liveness_score, bvn_verified, nin_verified, tier, status, risk_rating, pep_flag, sanctions_flag, last_verified_at, created_at) VALUES
(1,'CUST-FBN-001','Adebayo Okafor','1985-03-15','22234567890','12345678901','08012345678','adebayo.okafor@email.com','15 Broad Street, Lagos Island','Lagos','Lagos Island','Nigerian','national_id','A12345678','2028-03-15',NULL,0.97,true,true,3,'verified','low',false,false,NOW()-INTERVAL '6 months',NOW()-INTERVAL '6 months'),
(1,'CUST-FBN-002','Ngozi Adeyemi','1990-07-22','22345678901','23456789012','08023456789','ngozi.adeyemi@email.com','42 Victoria Island, Lagos','Lagos','Eti-Osa','Nigerian','drivers_license','DL987654321','2027-07-22',NULL,0.94,true,true,3,'verified','low',false,false,NOW()-INTERVAL '5 months',NOW()-INTERVAL '5 months'),
(2,'CUST-ZBP-001','Emeka Nwosu','1978-11-08','22456789012','34567890123','08034567890','emeka.nwosu@email.com','8 Adeola Odeku Street, VI','Lagos','Eti-Osa','Nigerian','passport','A00123456','2029-11-08',NULL,0.99,true,true,3,'verified','low',false,false,NOW()-INTERVAL '4 months',NOW()-INTERVAL '4 months'),
(3,'CUST-GTB-001','Fatima Al-Hassan','1995-02-14','22567890123','45678901234','08045678901','fatima.alhassan@email.com','12 Ahmadu Bello Way, Abuja','FCT','Abuja Municipal','Nigerian','national_id','B23456789','2027-02-14',NULL,0.91,true,true,2,'verified','medium',true,false,NOW()-INTERVAL '3 months',NOW()-INTERVAL '3 months'),
(4,'CUST-ACC-001','Chukwuemeka Eze','1982-09-30','22678901234','56789012345','08056789012','chukwuemeka.eze@email.com','5 Rumuola Road, Port Harcourt','Rivers','Port Harcourt','Nigerian','drivers_license','DL123456789','2026-09-30',NULL,0.88,true,false,2,'pending_nin','medium',false,false,NOW()-INTERVAL '2 months',NOW()-INTERVAL '2 months'),
(5,'CUST-UBA-001','Aisha Mohammed','1993-05-18','22789012345','67890123456','08067890123','aisha.mohammed@email.com','22 Ahmadu Bello Way, Kaduna','Kaduna','Kaduna North','Nigerian','national_id','C34567890','2028-05-18',NULL,0.95,true,true,3,'verified','low',false,false,NOW()-INTERVAL '2 months',NOW()-INTERVAL '2 months'),
(1,'CUST-FBN-003','Oluwaseun Adebisi','1988-12-25','22890123456','78901234567','08078901234','oluwaseun.adebisi@email.com','33 Opebi Road, Ikeja','Lagos','Ikeja','Nigerian','passport','A11234567','2030-12-25',NULL,0.96,true,true,3,'verified','low',false,false,NOW()-INTERVAL '1 month',NOW()-INTERVAL '1 month'),
(2,'CUST-ZBP-002','Babatunde Fashola','1975-04-03','22901234567','89012345678','08089012345','babatunde.fashola@email.com','7 Adeola Hopewell Street, VI','Lagos','Eti-Osa','Nigerian','national_id','D45678901','2027-04-03',NULL,0.92,true,true,3,'verified','high',true,false,NOW()-INTERVAL '3 weeks',NOW()-INTERVAL '3 weeks'),
(3,'CUST-GTB-002','Chiamaka Obi','1997-08-11','23012345678','90123456789','08090123456','chiamaka.obi@email.com','18 GRA, Enugu','Enugu','Enugu North','Nigerian','national_id','E56789012','2028-08-11',NULL,0.89,true,true,2,'verified','low',false,false,NOW()-INTERVAL '2 weeks',NOW()-INTERVAL '2 weeks'),
(4,'CUST-ACC-002','Ibrahim Musa','1980-01-20','23123456789','01234567890','08001234567','ibrahim.musa@email.com','4 Kano Road, Kano','Kano','Kano Municipal','Nigerian','drivers_license','DL234567890','2026-01-20',NULL,0.72,true,false,1,'tier1_only','high',false,true,NOW()-INTERVAL '1 week',NOW()-INTERVAL '1 week'),
(5,'CUST-UBA-002','Yetunde Bakare','1991-06-07','23234567890','12345098765','08012309876','yetunde.bakare@email.com','9 Allen Avenue, Ikeja','Lagos','Ikeja','Nigerian','passport','A22345678','2029-06-07',NULL,0.98,true,true,3,'verified','low',false,false,NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(6,'CUST-SIB-001','Tunde Okonkwo','1986-10-14','23345678901','23456098765','08023409876','tunde.okonkwo@email.com','15 Marina, Lagos Island','Lagos','Lagos Island','Nigerian','national_id','F67890123','2027-10-14',NULL,0.85,true,true,2,'verified','medium',false,false,NOW()-INTERVAL '4 days',NOW()-INTERVAL '4 days'),
(7,'CUST-FID-001','Blessing Nwofor','1994-03-28','23456789012','34567098765','08034509876','blessing.nwofor@email.com','27 Trans-Amadi, Port Harcourt','Rivers','Obio-Akpor','Nigerian','national_id','G78901234','2028-03-28',NULL,0.93,true,true,3,'verified','low',false,false,NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(8,'CUST-UBN-001','Musa Abdullahi','1983-07-19','23567890123','45678098765','08045609876','musa.abdullahi@email.com','12 Ahmadu Bello Way, Zaria','Kaduna','Zaria','Nigerian','national_id','H89012345','2027-07-19',NULL,0.77,false,false,1,'bvn_pending','high',false,false,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(9,'CUST-STB-001','Adaeze Okafor','1999-11-02','23678901234','56789098765','08056709876','adaeze.okafor@email.com','3 Aba Road, Port Harcourt','Rivers','Port Harcourt','Nigerian','national_id','I90123456','2028-11-02',NULL,0.91,true,true,2,'verified','low',false,false,NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── AML Cases ───────────────────────────────────────────────────────────────
INSERT INTO aml_cases (case_reference, bank_id, subject_type, subject_name, subject_id_ref, risk_score, pep_match, sanctions_match, adverse_media_match, transaction_ref, transaction_amount, transaction_currency, alert_trigger, case_type, status, assigned_analyst, disposition, disposition_notes, escalated_to_nfiu, nfiu_reference, str_filed, str_date, created_at, updated_at) VALUES
('AML-2026-001','1','individual','Babatunde Fashola','CUST-ZBP-002',85,'true','false','true','TXN-ZBP-20260101-001',45000000,'NGN','pep_match','enhanced_due_diligence','under_review','Analyst-A01',NULL,NULL,false,NULL,false,NULL,NOW()-INTERVAL '30 days',NOW()-INTERVAL '1 day'),
('AML-2026-002','4','individual','Ibrahim Musa','CUST-ACC-002',92,'false','true','false','TXN-ACC-20260105-001',12000000,'NGN','sanctions_hit','sanctions_screening','escalated','Analyst-A02',NULL,NULL,true,'NFIU-2026-0045',true,'2026-01-10',NOW()-INTERVAL '28 days',NOW()-INTERVAL '2 days'),
('AML-2026-003','1','corporate','Bright Future Holdings Ltd',NULL,78,'false','false','true','TXN-FBN-20260110-001',250000000,'NGN','large_cash_deposit','suspicious_activity','str_filed','Analyst-A03',NULL,NULL,false,NULL,true,'2026-01-15',NOW()-INTERVAL '25 days',NOW()-INTERVAL '3 days'),
('AML-2026-004','3','individual','Chukwuemeka Eze','CUST-GTB-001',65,'false','false','false','TXN-GTB-20260112-001',8500000,'NGN','velocity_breach','transaction_monitoring','closed','Analyst-A01','false_positive','Customer is a legitimate contractor',false,NULL,false,NULL,NOW()-INTERVAL '22 days',NOW()-INTERVAL '5 days'),
('AML-2026-005','2','corporate','Global Trade Partners Ltd',NULL,88,'false','true','true','TXN-ZBP-20260115-001',180000000,'USD','sanctions_hit','sanctions_screening','escalated','Analyst-A04',NULL,NULL,true,'NFIU-2026-0067',true,'2026-01-20',NOW()-INTERVAL '20 days',NOW()-INTERVAL '1 day'),
('AML-2026-006','5','individual','Aisha Mohammed','CUST-UBA-001',45,'false','false','false','TXN-UBA-20260118-001',3200000,'NGN','structuring_pattern','transaction_monitoring','closed','Analyst-A02','false_positive','Regular salary and business income',false,NULL,false,NULL,NOW()-INTERVAL '18 days',NOW()-INTERVAL '7 days'),
('AML-2026-007','1','corporate','Nexus Investment Corp',NULL,95,'true','true','true','TXN-FBN-20260120-001',500000000,'NGN','pep_match','high_risk_customer','escalated','Analyst-A05',NULL,NULL,true,'NFIU-2026-0089',true,'2026-01-25',NOW()-INTERVAL '15 days',NOW()),
('AML-2026-008','4','individual','Musa Abdullahi','CUST-UBN-001',72,'false','false','false','TXN-ACC-20260122-001',6800000,'NGN','unusual_pattern','transaction_monitoring','under_review','Analyst-A03',NULL,NULL,false,NULL,false,NULL,NOW()-INTERVAL '12 days',NOW()-INTERVAL '2 hours'),
('AML-2026-009','3','corporate','Pinnacle Resources Ltd',NULL,81,'false','false','true','TXN-GTB-20260125-001',95000000,'NGN','adverse_media','enhanced_due_diligence','under_review','Analyst-A01',NULL,NULL,false,NULL,false,NULL,NOW()-INTERVAL '10 days',NOW()-INTERVAL '4 hours'),
('AML-2026-010','2','individual','Emeka Nwosu','CUST-ZBP-001',58,'false','false','false','TXN-ZBP-20260128-001',4500000,'NGN','cash_intensive','transaction_monitoring','closed','Analyst-A02','true_positive','STR filed, customer exited',false,NULL,true,'2026-02-01',NOW()-INTERVAL '8 days',NOW()-INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

-- ─── Watchlist Entries ────────────────────────────────────────────────────────
INSERT INTO watchlist_entries (primary_name, aliases, entity_type, nationality, date_of_birth, id_numbers, source_list, risk_category, sanctions_programs, listing_date, delisted_date, reason, is_active, created_at) VALUES
('Abubakar Shekau',ARRAY['Abu Shekau','Abubakar Mohammed Shekau'],'individual','Nigerian','1969-01-01',ARRAY['NIN-XX-001'],'UN_CONSOLIDATED','terrorism',ARRAY['UN 1267','US OFAC'],'2014-05-22',NULL,'Boko Haram leader',true,NOW()-INTERVAL '5 years'),
('Hezekiah Dimka',ARRAY['H. Dimka'],'individual','Nigerian','1945-03-10',ARRAY[],'INTERPOL','financial_crime',ARRAY['INTERPOL RED'],'2020-01-15',NULL,'Money laundering',true,NOW()-INTERVAL '4 years'),
('Global Syndicate Holdings',ARRAY['GSH Ltd','Global Syndicate'],'entity','Nigerian',NULL,ARRAY['RC-999001'],'OFAC_SDN','sanctions',ARRAY['US OFAC SDN'],'2021-06-01',NULL,'Sanctions evasion',true,NOW()-INTERVAL '3 years'),
('Viktor Petrov',ARRAY['V. Petrov','Viktor P.'],'individual','Russian','1972-11-30',ARRAY[],'EU_CONSOLIDATED','sanctions',ARRAY['EU Sanctions','UK OFSI'],'2022-03-15',NULL,'Ukraine-related sanctions',true,NOW()-INTERVAL '2 years'),
('Bright Future Holdings Ltd',ARRAY['BFH','Bright Future'],'entity','Nigerian',NULL,ARRAY['RC-887654'],'NFIU_WATCHLIST','money_laundering',ARRAY['NFIU'],'2023-08-10',NULL,'Suspicious transaction patterns',true,NOW()-INTERVAL '1 year'),
('Mohammed Al-Rashid',ARRAY['M. Al-Rashid','Abu Rashid'],'individual','Libyan','1980-05-20',ARRAY[],'UN_CONSOLIDATED','terrorism',ARRAY['UN 1267','US OFAC'],'2019-11-01',NULL,'Terrorist financing',true,NOW()-INTERVAL '4 years'),
('Nexus Investment Corp',ARRAY['Nexus Corp','NIC Ltd'],'entity','Nigerian',NULL,ARRAY['RC-776543'],'NFIU_WATCHLIST','pep_related',ARRAY['NFIU'],'2024-01-20',NULL,'PEP-linked entity under investigation',true,NOW()-INTERVAL '6 months'),
('Oluwafemi Adegoke',ARRAY['Femi Adegoke'],'individual','Nigerian','1968-09-15',ARRAY['BVN-99887766'],'CBN_WATCHLIST','fraud',ARRAY['CBN'],'2023-05-05',NULL,'Bank fraud conviction',true,NOW()-INTERVAL '1 year'),
('Sahara Desert Trading',ARRAY['SDT','Sahara Trading'],'entity','Nigerian',NULL,ARRAY['RC-654321'],'EFCC_WATCHLIST','corruption',ARRAY['EFCC'],'2022-12-01',NULL,'EFCC investigation for corruption',true,NOW()-INTERVAL '1 year 6 months'),
('Chidi Okeke',ARRAY['C. Okeke','Chidi O.'],'individual','Nigerian','1975-07-04',ARRAY['BVN-88776655'],'EFCC_WATCHLIST','fraud',ARRAY['EFCC','INTERPOL'],'2021-09-20',NULL,'Advance fee fraud',true,NOW()-INTERVAL '2 years 6 months'),
('Global Trade Partners Ltd',ARRAY['GTP','Global Trade'],'entity','Nigerian',NULL,ARRAY['RC-543210'],'OFAC_SDN','sanctions',ARRAY['US OFAC SDN','EU Sanctions'],'2023-02-14',NULL,'Sanctions violation — Iran',true,NOW()-INTERVAL '1 year 2 months'),
('Aminu Kano',ARRAY['A. Kano'],'individual','Nigerian','1960-04-12',ARRAY[],'CBN_WATCHLIST','pep','CBN','{}'::text[],'2020-07-01',NULL,'Former minister under investigation',true,NOW()-INTERVAL '3 years'),
('Pinnacle Resources Ltd',ARRAY['Pinnacle Res','PRL'],'entity','Nigerian',NULL,ARRAY['RC-432109'],'NFIU_WATCHLIST','money_laundering',ARRAY['NFIU'],'2024-03-01',NULL,'Adverse media — money laundering allegations',true,NOW()-INTERVAL '3 months'),
('Yusuf Al-Baraka',ARRAY['Y. Al-Baraka'],'individual','Sudanese','1978-02-28',ARRAY[],'UN_CONSOLIDATED','terrorism',ARRAY['UN 1267'],'2018-06-15',NULL,'Terrorist financing',true,NOW()-INTERVAL '5 years'),
('Ekene Eze',ARRAY['E. Eze'],'individual','Nigerian','1990-12-01',ARRAY['BVN-77665544'],'EFCC_WATCHLIST','fraud',ARRAY['EFCC'],'2025-01-10',NULL,'Cybercrime conviction',true,NOW()-INTERVAL '3 months')
ON CONFLICT DO NOTHING;

-- ─── NIP Transactions ────────────────────────────────────────────────────────
INSERT INTO nip_transactions (session_id, sender_bank_code, sender_account_number, sender_name, receiver_bank_code, receiver_account_number, receiver_name, amount, narration, channel, status, nibss_reference, settlement_date, response_code, response_message, created_at) VALUES
('NIP20260101001','011','1234567890','Adebayo Okafor','057','9876543210','Ngozi Adeyemi',250000,'Transfer to Zenith','mobile',  'completed','NIBSS-2026-0000001','2026-01-01',  '00','Approved',NOW()-INTERVAL '30 days'),
('NIP20260101002','057','9876543210','Ngozi Adeyemi', '044','1122334455','Emeka Nwosu',  500000,'Business payment',  'internet','completed','NIBSS-2026-0000002','2026-01-01',  '00','Approved',NOW()-INTERVAL '30 days'),
('NIP20260101003','058','2233445566','GTB Customer',  '033','3344556677','UBA Customer', 1000000,'Rent payment',      'pos',     'completed','NIBSS-2026-0000003','2026-01-01',  '00','Approved',NOW()-INTERVAL '29 days'),
('NIP20260102001','044','3344556677','Access Customer','011','4455667788','FBN Customer', 75000, 'School fees',       'mobile',  'completed','NIBSS-2026-0000004','2026-01-02',  '00','Approved',NOW()-INTERVAL '29 days'),
('NIP20260102002','033','4455667788','UBA Customer',  '057','5566778899','Zenith Cust',  2500000,'Supplier payment',  'internet','completed','NIBSS-2026-0000005','2026-01-02',  '00','Approved',NOW()-INTERVAL '28 days'),
('NIP20260102003','011','5566778899','FBN Customer',  '058','6677889900','GTB Customer', 150000,'Personal transfer',  'mobile',  'failed',   NULL,                NULL,           '51','Insufficient funds',NOW()-INTERVAL '28 days'),
('NIP20260103001','057','6677889900','Zenith Customer','044','7788990011','Access Cust',  5000000,'Property deposit',  'internet','completed','NIBSS-2026-0000006','2026-01-03',  '00','Approved',NOW()-INTERVAL '27 days'),
('NIP20260103002','058','7788990011','GTB Customer',  '033','8899001122','UBA Customer', 350000,'Medical bills',     'mobile',  'completed','NIBSS-2026-0000007','2026-01-03',  '00','Approved',NOW()-INTERVAL '27 days'),
('NIP20260103003','044','8899001122','Access Customer','011','9900112233','FBN Customer', 800000,'Equipment purchase', 'internet','completed','NIBSS-2026-0000008','2026-01-03',  '00','Approved',NOW()-INTERVAL '26 days'),
('NIP20260104001','033','9900112233','UBA Customer',  '057','0011223344','Zenith Cust',  125000,'Utility payment',   'ussd',    'completed','NIBSS-2026-0000009','2026-01-04',  '00','Approved',NOW()-INTERVAL '26 days'),
('NIP20260104002','011','0011223344','FBN Customer',  '058','1122334456','GTB Customer', 3500000,'Investment transfer','internet','pending',  NULL,                NULL,           NULL,NULL,       NOW()-INTERVAL '25 days'),
('NIP20260104003','057','1122334456','Zenith Customer','044','2233445567','Access Cust',  200000,'Airtime purchase',  'mobile',  'completed','NIBSS-2026-0000010','2026-01-04',  '00','Approved',NOW()-INTERVAL '25 days'),
('NIP20260105001','058','2233445567','GTB Customer',  '033','3344556678','UBA Customer', 750000,'Salary advance',    'internet','completed','NIBSS-2026-0000011','2026-01-05',  '00','Approved',NOW()-INTERVAL '24 days'),
('NIP20260105002','044','3344556678','Access Customer','011','4455667789','FBN Customer', 50000, 'Food purchase',     'pos',     'completed','NIBSS-2026-0000012','2026-01-05',  '00','Approved',NOW()-INTERVAL '24 days'),
('NIP20260105003','033','4455667789','UBA Customer',  '057','5566778890','Zenith Cust',  10000000,'Large transfer',  'internet','completed','NIBSS-2026-0000013','2026-01-05',  '00','Approved',NOW()-INTERVAL '23 days'),
('NIP20260106001','011','5566778890','FBN Customer',  '058','6677889901','GTB Customer', 450000,'Loan repayment',    'mobile',  'completed','NIBSS-2026-0000014','2026-01-06',  '00','Approved',NOW()-INTERVAL '23 days'),
('NIP20260106002','057','6677889901','Zenith Customer','044','7788990012','Access Cust',  1800000,'Car purchase deposit','internet','completed','NIBSS-2026-0000015','2026-01-06','00','Approved',NOW()-INTERVAL '22 days'),
('NIP20260106003','058','7788990012','GTB Customer',  '033','8899001123','UBA Customer', 25000, 'Fuel purchase',     'pos',     'failed',   NULL,                NULL,           '91','No such issuer',NOW()-INTERVAL '22 days'),
('NIP20260107001','044','8899001123','Access Customer','011','9900112234','FBN Customer', 600000,'Insurance premium', 'internet','completed','NIBSS-2026-0000016','2026-01-07',  '00','Approved',NOW()-INTERVAL '21 days'),
('NIP20260107002','033','9900112234','UBA Customer',  '057','0011223345','Zenith Cust',  2200000,'Dividend payment',  'internet','completed','NIBSS-2026-0000017','2026-01-07',  '00','Approved',NOW()-INTERVAL '21 days')
ON CONFLICT DO NOTHING;

-- ─── RTGS Transactions ────────────────────────────────────────────────────────
INSERT INTO rtgs_transactions (reference, sender_bank_code, sender_account, sender_name, receiver_bank_code, receiver_account, receiver_name, amount, currency, narration, priority, status, settlement_time, cbn_reference, created_at) VALUES
('RTGS-2026-001','011','1000000001','First Bank Treasury','057','2000000001','Zenith Bank Treasury',5000000000,'NGN','Interbank settlement',  'high','settled','2026-01-02 09:15:00','CBN-RTGS-2026-001',NOW()-INTERVAL '30 days'),
('RTGS-2026-002','057','2000000001','Zenith Bank Treasury','044','3000000001','Access Bank Treasury',8500000000,'NGN','Interbank liquidity',   'high','settled','2026-01-02 10:30:00','CBN-RTGS-2026-002',NOW()-INTERVAL '30 days'),
('RTGS-2026-003','058','4000000001','GTB Treasury',        '033','5000000001','UBA Treasury',        3200000000,'NGN','Daily settlement',      'normal','settled','2026-01-03 11:00:00','CBN-RTGS-2026-003',NOW()-INTERVAL '29 days'),
('RTGS-2026-004','044','3000000001','Access Bank Treasury','011','1000000001','First Bank Treasury',12000000000,'NGN','Large value transfer',  'high','settled','2026-01-05 09:00:00','CBN-RTGS-2026-004',NOW()-INTERVAL '27 days'),
('RTGS-2026-005','033','5000000001','UBA Treasury',        '058','4000000001','GTB Treasury',        6700000000,'NGN','Interbank settlement',  'normal','settled','2026-01-07 14:00:00','CBN-RTGS-2026-005',NOW()-INTERVAL '25 days'),
('RTGS-2026-006','011','1000000001','First Bank Treasury','044','3000000001','Access Bank Treasury',9800000000,'NGN','Government bond payment','high','settled','2026-01-10 10:00:00','CBN-RTGS-2026-006',NOW()-INTERVAL '22 days'),
('RTGS-2026-007','057','2000000001','Zenith Bank Treasury','058','4000000001','GTB Treasury',        4500000000,'NGN','Treasury bill settlement','normal','settled','2026-01-12 11:30:00','CBN-RTGS-2026-007',NOW()-INTERVAL '20 days'),
('RTGS-2026-008','044','3000000001','Access Bank Treasury','033','5000000001','UBA Treasury',        7200000000,'NGN','FGN bond coupon',        'high','settled','2026-01-15 09:45:00','CBN-RTGS-2026-008',NOW()-INTERVAL '17 days'),
('RTGS-2026-009','058','4000000001','GTB Treasury',        '011','1000000001','First Bank Treasury',2100000000,'NGN','Interbank repo',         'normal','settled','2026-01-18 13:00:00','CBN-RTGS-2026-009',NOW()-INTERVAL '14 days'),
('RTGS-2026-010','033','5000000001','UBA Treasury',        '057','2000000001','Zenith Bank Treasury',15000000000,'NGN','Syndicated loan disbursement','high','settled','2026-01-20 10:15:00','CBN-RTGS-2026-010',NOW()-INTERVAL '12 days'),
('RTGS-2026-011','011','1000000001','First Bank Treasury','058','4000000001','GTB Treasury',        3800000000,'NGN','Interbank settlement',  'normal','settled','2026-01-22 11:00:00','CBN-RTGS-2026-011',NOW()-INTERVAL '10 days'),
('RTGS-2026-012','057','2000000001','Zenith Bank Treasury','033','5000000001','UBA Treasury',        6100000000,'NGN','Treasury management',   'high','settled','2026-01-25 09:30:00','CBN-RTGS-2026-012',NOW()-INTERVAL '7 days'),
('RTGS-2026-013','044','3000000001','Access Bank Treasury','011','1000000001','First Bank Treasury',11500000000,'NGN','Pension fund transfer',  'high','settled','2026-01-28 10:00:00','CBN-RTGS-2026-013',NOW()-INTERVAL '4 days'),
('RTGS-2026-014','058','4000000001','GTB Treasury',        '057','2000000001','Zenith Bank Treasury',4900000000,'NGN','Interbank settlement',  'normal','pending',NULL,'CBN-RTGS-2026-014',NOW()-INTERVAL '1 day'),
('RTGS-2026-015','033','5000000001','UBA Treasury',        '044','3000000001','Access Bank Treasury',8300000000,'NGN','FX settlement',          'high','processing',NULL,'CBN-RTGS-2026-015',NOW()-INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- ─── SWIFT Messages ───────────────────────────────────────────────────────────
INSERT INTO swift_messages (message_type, sender_bic, receiver_bic, transaction_reference, related_reference, value_date, currency, amount, ordering_customer, beneficiary_customer, details_of_charges, remittance_info, status, sanctions_screened, sanctions_result, compliance_hold, compliance_hold_reason, ack_received, ack_time, created_at) VALUES
('MT103','GTBINGLA','CHASUS33','TXN-SWIFT-001',NULL,'2026-01-05','USD',50000,'Guaranty Trust Bank Plc','JP Morgan Chase Bank',   'SHA','Invoice payment - INV-2026-001','settled',true,'clear',false,NULL,true,'2026-01-05 10:30:00',NOW()-INTERVAL '28 days'),
('MT103','FBNINGLA','BARCGB22','TXN-SWIFT-002',NULL,'2026-01-08','GBP',25000,'First Bank of Nigeria',  'Barclays Bank UK',        'SHA','Tuition fees - Oxford University','settled',true,'clear',false,NULL,true,'2026-01-08 14:15:00',NOW()-INTERVAL '25 days'),
('MT103','ZEIBNGLA','DEUTDEFF','TXN-SWIFT-003',NULL,'2026-01-10','EUR',75000,'Zenith Bank Plc',         'Deutsche Bank AG',        'OUR','Trade finance - machinery import','settled',true,'clear',false,NULL,true,'2026-01-10 09:00:00',NOW()-INTERVAL '23 days'),
('MT103','ABNGNGLA','CITIUS33','TXN-SWIFT-004',NULL,'2026-01-12','USD',120000,'Access Bank Plc',         'Citibank N.A.',           'SHA','Oil & gas equipment','settled',true,'clear',false,NULL,true,'2026-01-12 11:45:00',NOW()-INTERVAL '21 days'),
('MT103','UNAFNGLA','BNPAFRPP','TXN-SWIFT-005',NULL,'2026-01-15','EUR',35000,'UBA Plc',                  'BNP Paribas',             'SHA','Pharmaceutical imports','settled',true,'clear',false,NULL,true,'2026-01-15 08:30:00',NOW()-INTERVAL '18 days'),
('MT103','GTBINGLA','HSBCGB2L','TXN-SWIFT-006',NULL,'2026-01-18','GBP',200000,'GTB Plc',                 'HSBC Bank plc',           'OUR','Real estate acquisition','on_hold',true,'hit',true,'Potential sanctions match - under review',false,NULL,NOW()-INTERVAL '15 days'),
('MT202','FBNINGLA','CHASUS33','TXN-SWIFT-007',NULL,'2026-01-20','USD',5000000,'First Bank of Nigeria',  'JP Morgan Chase Bank',    'OUR','Interbank cover payment','settled',true,'clear',false,NULL,true,'2026-01-20 10:00:00',NOW()-INTERVAL '13 days'),
('MT103','ZEIBNGLA','SBICGB2L','TXN-SWIFT-008',NULL,'2026-01-22','USD',18000,'Zenith Bank Plc',         'Standard Bank UK',        'SHA','Education fees','settled',true,'clear',false,NULL,true,'2026-01-22 13:20:00',NOW()-INTERVAL '11 days'),
('MT103','ABNGNGLA','SCBLGB2L','TXN-SWIFT-009',NULL,'2026-01-25','USD',85000,'Access Bank Plc',         'Standard Chartered Bank', 'SHA','Agricultural equipment','settled',true,'clear',false,NULL,true,'2026-01-25 09:15:00',NOW()-INTERVAL '8 days'),
('MT700','GTBINGLA','CHASUS33','TXN-SWIFT-010',NULL,'2026-01-28','USD',2500000,'GTB Plc',                'JP Morgan Chase Bank',    'OUR','Letter of Credit - crude oil export','processing',true,'clear',false,NULL,false,NULL,NOW()-INTERVAL '5 days'),
('MT103','FBNINGLA','ABOCJPJT','TXN-SWIFT-011',NULL,'2026-02-01','JPY',8000000,'First Bank of Nigeria', 'Aozora Bank Japan',       'SHA','Technology import','settled',true,'clear',false,NULL,true,'2026-02-01 07:00:00',NOW()-INTERVAL '3 days'),
('MT103','UNAFNGLA','NEDSZAJJ','TXN-SWIFT-012',NULL,'2026-02-03','ZAR',500000,'UBA Plc',                 'Nedbank South Africa',    'SHA','Pan-African trade settlement','settled',true,'clear',false,NULL,true,'2026-02-03 11:00:00',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Fraud Alerts ─────────────────────────────────────────────────────────────
INSERT INTO fraud_alerts (bank_id, transaction_ref, account_number, alert_type, risk_score, ml_model, ml_model_version, features_triggered, transaction_amount, transaction_channel, ip_address, device_fingerprint, location, velocity_count_1h, velocity_amount_1h, disposition, disposition_notes, assigned_to, escalated, created_at, updated_at) VALUES
(1,'TXN-FBN-FRAUD-001','1234567890','velocity_breach',88,'xgboost_v3','3.1.2',ARRAY['high_velocity','unusual_hour','new_device'],450000,'mobile','196.45.12.34','DEV-ABC123','Lagos, NG',8,2100000,'under_review',NULL,'Fraud-Analyst-01',false,NOW()-INTERVAL '5 days',NOW()-INTERVAL '1 day'),
(2,'TXN-ZBP-FRAUD-001','9876543210','account_takeover',95,'isolation_forest_v2','2.3.0',ARRAY['new_device','location_anomaly','password_reset_recent'],1200000,'internet','41.58.234.12','DEV-XYZ789','Abuja, NG',2,1200000,'escalated',NULL,'Fraud-Analyst-02',true,NOW()-INTERVAL '4 days',NOW()-INTERVAL '12 hours'),
(3,'TXN-GTB-FRAUD-001','2233445566','card_not_present',72,'neural_net_v4','4.0.1',ARRAY['international_merchant','high_amount','card_not_present'],85000,'pos','203.45.67.89','DEV-POS001','London, UK',1,85000,'closed','Legitimate international purchase confirmed','Fraud-Analyst-01',false,NOW()-INTERVAL '3 days',NOW()-INTERVAL '2 days'),
(4,'TXN-ACC-FRAUD-001','3344556677','structuring',81,'gradient_boost_v2','2.1.5',ARRAY['structuring_pattern','cash_intensive','multiple_accounts'],4950000,'branch',NULL,NULL,'Port Harcourt, NG',5,4950000,'str_filed','Structuring pattern confirmed, STR filed','Fraud-Analyst-03',true,NOW()-INTERVAL '3 days',NOW()-INTERVAL '1 day'),
(5,'TXN-UBA-FRAUD-001','4455667788','sim_swap',91,'random_forest_v3','3.2.0',ARRAY['sim_swap_detected','new_device','large_transfer'],2500000,'mobile','197.210.45.67','DEV-NEW001','Kano, NG',3,2500000,'escalated',NULL,'Fraud-Analyst-02',true,NOW()-INTERVAL '2 days',NOW()-INTERVAL '6 hours'),
(1,'TXN-FBN-FRAUD-002','5566778899','phishing',68,'xgboost_v3','3.1.2',ARRAY['phishing_url_click','credential_compromise'],150000,'internet','105.112.45.23','DEV-DEF456','Lagos, NG',1,150000,'closed','Customer confirmed phishing, account secured','Fraud-Analyst-01',false,NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day'),
(2,'TXN-ZBP-FRAUD-002','6677889900','money_mule',85,'neural_net_v4','4.0.1',ARRAY['mule_account_pattern','rapid_pass_through','multiple_senders'],8900000,'internet','154.67.23.45','DEV-GHI789','Lagos, NG',12,8900000,'under_review',NULL,'Fraud-Analyst-04',false,NOW()-INTERVAL '1 day',NOW()-INTERVAL '3 hours'),
(3,'TXN-GTB-FRAUD-002','7788990011','false_positive',35,'xgboost_v3','3.1.2',ARRAY['unusual_amount'],500000,'mobile','197.210.12.34','DEV-JKL012','Abuja, NG',1,500000,'closed','False positive - regular customer behaviour','Fraud-Analyst-01',false,NOW()-INTERVAL '1 day',NOW()-INTERVAL '12 hours'),
(4,'TXN-ACC-FRAUD-002','8899001122','card_cloning',93,'isolation_forest_v2','2.3.0',ARRAY['card_cloning_pattern','multiple_locations','rapid_transactions'],3200000,'pos',NULL,'DEV-POS002','Multiple locations',15,3200000,'escalated',NULL,'Fraud-Analyst-03',true,NOW()-INTERVAL '12 hours',NOW()-INTERVAL '1 hour'),
(5,'TXN-UBA-FRAUD-002','9900112233','social_engineering',77,'gradient_boost_v2','2.1.5',ARRAY['social_engineering','unusual_beneficiary','large_amount'],750000,'mobile','196.45.78.90','DEV-MNO345','Lagos, NG',2,750000,'under_review',NULL,'Fraud-Analyst-02',false,NOW()-INTERVAL '6 hours',NOW())
ON CONFLICT DO NOTHING;

-- ─── CBN Reports ─────────────────────────────────────────────────────────────
INSERT INTO cbn_reports (bank_id, report_type, reporting_period, reporting_period_end, prepared_by, total_transactions, total_amount_ngn, suspicious_transactions, str_count, ctr_count, status, submission_date, cbn_acknowledgment_ref, cbn_feedback, xml_payload, created_at) VALUES
(1,'STR','2026-Q1','2026-03-31','Chief Compliance Officer',45230,125000000000,12,12,0,'submitted','2026-04-05','CBN-STR-2026-001','Received and under review','<STR><bank>FBN</bank><period>2026-Q1</period></STR>',NOW()-INTERVAL '9 days'),
(2,'CTR','2026-Q1','2026-03-31','Head of Compliance',38120,98000000000,0,0,45,'submitted','2026-04-06','CBN-CTR-2026-001','Acknowledged','<CTR><bank>ZBP</bank><period>2026-Q1</period></CTR>',NOW()-INTERVAL '8 days'),
(3,'STR','2026-Q1','2026-03-31','MLRO',52340,145000000000,8,8,0,'submitted','2026-04-07','CBN-STR-2026-002','Received','<STR><bank>GTB</bank><period>2026-Q1</period></STR>',NOW()-INTERVAL '7 days'),
(4,'CTR','2026-Q1','2026-03-31','Compliance Manager',61250,210000000000,0,0,67,'submitted','2026-04-08','CBN-CTR-2026-002','Acknowledged','<CTR><bank>ACC</bank><period>2026-Q1</period></CTR>',NOW()-INTERVAL '6 days'),
(5,'STR','2026-Q1','2026-03-31','Chief Risk Officer',29870,87000000000,5,5,0,'submitted','2026-04-09','CBN-STR-2026-003','Under review','<STR><bank>UBA</bank><period>2026-Q1</period></STR>',NOW()-INTERVAL '5 days'),
(1,'SCUML','2026-Q1','2026-03-31','AML Officer',45230,125000000000,0,0,0,'draft',NULL,NULL,NULL,'<SCUML><bank>FBN</bank><period>2026-Q1</period></SCUML>',NOW()-INTERVAL '4 days'),
(2,'STR','2026-Q1','2026-03-31','MLRO',38120,98000000000,3,3,0,'pending',NULL,NULL,NULL,'<STR><bank>ZBP</bank><period>2026-Q1</period></STR>',NOW()-INTERVAL '3 days'),
(3,'SCUML','2026-Q1','2026-03-31','Compliance Officer',52340,145000000000,0,0,0,'draft',NULL,NULL,NULL,'<SCUML><bank>GTB</bank><period>2026-Q1</period></SCUML>',NOW()-INTERVAL '2 days'),
(4,'STR','2026-Q1','2026-03-31','Chief Compliance Officer',61250,210000000000,7,7,0,'pending',NULL,NULL,NULL,'<STR><bank>ACC</bank><period>2026-Q1</period></STR>',NOW()-INTERVAL '1 day'),
(5,'CTR','2026-Q1','2026-03-31','MLRO',29870,87000000000,0,0,32,'draft',NULL,NULL,NULL,'<CTR><bank>UBA</bank><period>2026-Q1</period></CTR>',NOW())
ON CONFLICT DO NOTHING;

-- ─── Correspondent Banks ──────────────────────────────────────────────────────
INSERT INTO correspondent_banks (correspondent_name, correspondent_bic, country, currency, nostro_account_number, nostro_balance_usd, relationship_type, relationship_status, credit_limit_usd, annual_transaction_volume_usd, last_due_diligence_date, next_due_diligence_date, kyc_status, aml_risk_rating, local_bank_id, agreement_date, agreement_expiry, primary_contact, primary_contact_email, notes, created_at) VALUES
('JP Morgan Chase Bank N.A.','CHASUS33','US','USD','001-234567-89','125000000','nostro','active',500000000,2500000000,'2025-01-15','2026-01-15','approved','low',1,'2020-03-01','2027-03-01','Michael Johnson','mjohnson@jpmorgan.com','Primary USD correspondent',NOW()-INTERVAL '5 years'),
('Citibank N.A.','CITIUS33','US','USD','002-345678-90','85000000','nostro','active',300000000,1800000000,'2025-02-20','2026-02-20','approved','low',4,'2019-06-01','2026-06-01','Sarah Williams','swilliams@citi.com','Secondary USD correspondent',NOW()-INTERVAL '4 years'),
('Deutsche Bank AG','DEUTDEFF','DE','EUR','003-456789-01','45000000','nostro','active',200000000,900000000,'2025-03-10','2026-03-10','approved','low',2,'2021-01-15','2028-01-15','Hans Mueller','hmueller@db.com','EUR correspondent',NOW()-INTERVAL '3 years'),
('Barclays Bank PLC','BARCGB22','GB','GBP','004-567890-12','32000000','nostro','active',150000000,650000000,'2025-04-05','2026-04-05','approved','low',1,'2020-09-01','2027-09-01','James Smith','jsmith@barclays.com','GBP correspondent',NOW()-INTERVAL '3 years'),
('BNP Paribas','BNPAFRPP','FR','EUR','005-678901-23','28000000','nostro','active',120000000,550000000,'2025-05-12','2026-05-12','approved','low',5,'2022-03-01','2029-03-01','Pierre Dubois','pdubois@bnp.com','EUR secondary correspondent',NOW()-INTERVAL '2 years'),
('HSBC Bank PLC','HSBCGB2L','GB','GBP','006-789012-34','18000000','nostro','under_review',100000000,400000000,'2024-06-20','2025-06-20','pending_renewal','medium',3,'2021-06-15','2025-06-15','Robert Brown','rbrown@hsbc.com','Under review - AML concerns',NOW()-INTERVAL '2 years'),
('Standard Chartered Bank','SCBLGB2L','GB','USD','007-890123-45','22000000','nostro','active',80000000,350000000,'2025-07-08','2026-07-08','approved','low',4,'2023-01-01','2030-01-01','Emma Wilson','ewilson@sc.com','Trade finance specialist',NOW()-INTERVAL '1 year'),
('Nedbank Limited','NEDSZAJJ','ZA','ZAR','008-901234-56','5000000','nostro','active',30000000,120000000,'2025-08-15','2026-08-15','approved','low',5,'2022-07-01','2029-07-01','Thabo Nkosi','tnkosi@nedbank.co.za','Pan-African corridor',NOW()-INTERVAL '1 year'),
('Aozora Bank Ltd','ABOCJPJT','JP','JPY','009-012345-67','8000000','nostro','active',40000000,180000000,'2025-09-01','2026-09-01','approved','low',1,'2023-04-01','2030-04-01','Kenji Tanaka','ktanaka@aozora.co.jp','JPY correspondent',NOW()-INTERVAL '9 months'),
('Standard Bank South Africa','SBICGB2L','ZA','USD','010-123456-78','12000000','nostro','active',50000000,220000000,'2025-10-10','2026-10-10','approved','low',2,'2023-08-01','2030-08-01','Sipho Dlamini','sdlamini@standardbank.co.za','Africa trade finance',NOW()-INTERVAL '6 months')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Cases ────────────────────────────────────────────────────────
INSERT INTO enforcement_cases (penalty_id, organization_id, status, case_reference, assigned_officer_id, overdue_days, escalation_reason, nitda_reference_number, resolution_notes, opened_at, escalated_at, closed_at, updated_at) VALUES
(1,1,'open','NDPC-ENF-2026-001',1,0,NULL,'NITDA-2026-0001',NULL,NOW()-INTERVAL '25 days',NULL,NULL,NOW()-INTERVAL '1 day'),
(2,2,'escalated','NDPC-ENF-2026-002',1,15,'Failure to respond to initial notice','NITDA-2026-0002',NULL,NOW()-INTERVAL '30 days',NOW()-INTERVAL '15 days',NULL,NOW()-INTERVAL '2 hours'),
(3,3,'under_review','NDPC-ENF-2026-003',1,0,NULL,'NITDA-2026-0003',NULL,NOW()-INTERVAL '20 days',NULL,NULL,NOW()-INTERVAL '3 hours'),
(4,4,'closed','NDPC-ENF-2026-004',1,0,NULL,'NITDA-2026-0004','Organisation paid penalty and implemented remediation plan',NOW()-INTERVAL '60 days',NULL,NOW()-INTERVAL '10 days',NOW()-INTERVAL '10 days'),
(5,5,'open','NDPC-ENF-2026-005',1,5,'Partial response received','NITDA-2026-0005',NULL,NOW()-INTERVAL '15 days',NULL,NULL,NOW()-INTERVAL '4 hours')
ON CONFLICT DO NOTHING;

-- ─── Case Timeline ────────────────────────────────────────────────────────────
INSERT INTO case_timeline (case_id, event_type, description, performed_by, created_at) VALUES
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
(4,'penalty_paid','Penalty of ₦25M paid in full','FME Finance',NOW()-INTERVAL '20 days'),
(4,'case_closed','Case closed following full compliance','NDPC Officer',NOW()-INTERVAL '10 days'),
(5,'case_opened','Enforcement case opened for NNPC','NDPC Officer',NOW()-INTERVAL '15 days'),
(5,'notice_issued','Formal notice issued to NNPC','NDPC Officer',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── DPIA Assessments ─────────────────────────────────────────────────────────
INSERT INTO dpia_assessments (organization_id, title, description, processing_purpose, legal_basis, data_categories, data_subjects_count, retention_period, third_party_processors, cross_border_transfers, automated_decision_making, profiling, risk_level, risk_score, risks_identified, mitigations, dpo_consulted, supervisory_authority_consulted, status, approved_by, approved_at, review_date, created_by, created_at, updated_at) VALUES
(1,'Customer Data Analytics Platform DPIA','Assessment of customer behavioural analytics system','Fraud prevention and credit scoring','Legitimate interest',ARRAY['financial_data','behavioral_data','identity_data'],2500000,'5 years',ARRAY['Experian','TransUnion'],'false','true','true','high',78,ARRAY['Re-identification risk','Profiling bias','Data breach risk'],ARRAY['Pseudonymisation','Bias audit','Encryption at rest'],'true','false','approved','DPO-FBN-001',NOW()-INTERVAL '30 days',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '60 days',NOW()-INTERVAL '30 days'),
(2,'5G Network Data Collection DPIA','Assessment of 5G network metadata collection','Network optimisation and QoS','Legitimate interest',ARRAY['location_data','network_metadata','device_identifiers'],45000000,'2 years',ARRAY['Ericsson','Huawei'],'false','false','false','medium',55,ARRAY['Mass surveillance risk','Location tracking','Data retention'],ARRAY['Data minimisation','Anonymisation','Retention limits'],'true','false','approved','DPO-MTN-001',NOW()-INTERVAL '20 days',NOW()+INTERVAL '6 months',2,NOW()-INTERVAL '45 days',NOW()-INTERVAL '20 days'),
(3,'Patient Health Records Digitisation DPIA','Assessment of EHR system implementation','Healthcare delivery and research','Vital interests',ARRAY['health_data','biometric_data','genetic_data'],500000,'10 years',ARRAY['Oracle Health','Microsoft Azure'],'false','false','false','high',85,ARRAY['Sensitive health data breach','Unauthorised access','Data integrity'],ARRAY['Role-based access','Audit trails','Encryption'],'true','true','under_review','DPO-LUTH-001',NULL,NOW()+INTERVAL '3 months',3,NOW()-INTERVAL '30 days',NOW()-INTERVAL '5 days'),
(4,'Student Data Management DPIA','Assessment of student information system','Educational administration','Public task',ARRAY['educational_records','contact_data','financial_data'],2000000,'7 years',ARRAY['Blackboard','Microsoft'],'false','false','false','medium',45,ARRAY['Unauthorised access','Data accuracy','Third party risk'],ARRAY['Access controls','Regular audits','Vendor assessment'],'true','false','draft',NULL,NULL,NOW()+INTERVAL '2 months',4,NOW()-INTERVAL '15 days',NOW()-INTERVAL '2 days'),
(5,'Oil Field Sensor Data DPIA','Assessment of IoT sensor data collection at oil fields','Operational safety and efficiency','Legitimate interest',ARRAY['location_data','operational_data','employee_data'],50000,'3 years',ARRAY['Schlumberger','Halliburton'],'true','false','false','medium',60,ARRAY['Cross-border transfer risk','Employee monitoring','Data security'],ARRAY['SCCs for transfers','Transparency notices','Security protocols'],'true','false','approved','DPO-NNPC-001',NOW()-INTERVAL '10 days',NOW()+INTERVAL '9 months',5,NOW()-INTERVAL '25 days',NOW()-INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── TIA Assessments ──────────────────────────────────────────────────────────
INSERT INTO tia_assessments (organization_id, destination_country, destination_entity, transfer_mechanism, data_categories, data_subjects_count, transfer_purpose, adequacy_decision, adequacy_decision_date, safeguards_in_place, risk_level, risk_score, legal_basis, status, approved_by, approved_at, review_date, created_by, created_at) VALUES
(1,'United States','Experian Information Solutions Inc','standard_contractual_clauses',ARRAY['credit_data','identity_data'],2500000,'Credit risk assessment','false',NULL,ARRAY['SCCs (2021)','Binding corporate rules','Data processing agreement'],'medium',55,'legitimate_interest','approved','DPO-FBN-001',NOW()-INTERVAL '20 days',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '30 days'),
(2,'China','Huawei Technologies Co Ltd','adequacy_decision',ARRAY['network_metadata','technical_data'],0,'Network equipment support','false',NULL,ARRAY['Contractual clauses','Security assessment','NDA'],'high',75,'legitimate_interest','under_review',NULL,NULL,NOW()+INTERVAL '3 months',2,NOW()-INTERVAL '25 days'),
(3,'United States','Oracle Health Inc','standard_contractual_clauses',ARRAY['health_data','patient_records'],500000,'Healthcare IT services','false',NULL,ARRAY['SCCs (2021)','HIPAA BAA','Encryption requirements'],'high',80,'vital_interests','approved','DPO-LUTH-001',NOW()-INTERVAL '15 days',NOW()+INTERVAL '6 months',3,NOW()-INTERVAL '20 days'),
(5,'United States','Schlumberger Ltd','standard_contractual_clauses',ARRAY['operational_data','location_data'],50000,'Oilfield services','false',NULL,ARRAY['SCCs (2021)','Technical measures','Audit rights'],'medium',50,'legitimate_interest','approved','DPO-NNPC-001',NOW()-INTERVAL '10 days',NOW()+INTERVAL '1 year',5,NOW()-INTERVAL '15 days'),
(4,'United Kingdom','Microsoft Corporation','adequacy_decision',ARRAY['educational_records','contact_data'],2000000,'Cloud services','false',NULL,ARRAY['UK GDPR adequacy','DPA','Security controls'],'low',30,'public_task','approved','DPO-FME-001',NOW()-INTERVAL '5 days',NOW()+INTERVAL '2 years',4,NOW()-INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── Transfer Approvals ────────────────────────────────────────────────────────
INSERT INTO transfer_approvals (organization_id, dataset_name, destination_entity, destination_country, transfer_mechanism, data_classification, volume_gb, data_subjects_count, transfer_purpose, legal_basis, risk_level, status, approved_by, approved_at, expires_at, rejection_reason, created_by, created_at) VALUES
(1,'Customer Credit Profiles','Experian Information Solutions','United States','standard_contractual_clauses','tier2_financial',2.5,2500000,'Credit risk assessment','legitimate_interest','medium','approved','DPO-FBN-001',NOW()-INTERVAL '20 days',NOW()+INTERVAL '1 year',NULL,1,NOW()-INTERVAL '25 days'),
(2,'Network Performance Data','Ericsson AB','Sweden','adequacy_decision','tier5_public',150,0,'Network optimisation','legitimate_interest','low','approved','DPO-MTN-001',NOW()-INTERVAL '15 days',NOW()+INTERVAL '2 years',NULL,2,NOW()-INTERVAL '18 days'),
(3,'Patient Records Subset','Oracle Health Inc','United States','standard_contractual_clauses','tier3_health',0.8,500000,'Healthcare IT implementation','vital_interests','high','pending',NULL,NULL,NULL,NULL,3,NOW()-INTERVAL '10 days'),
(4,'Student Academic Records','Microsoft Corporation','United States','standard_contractual_clauses','tier1_pii',5,2000000,'Cloud storage migration','public_task','medium','approved','DPO-FME-001',NOW()-INTERVAL '8 days',NOW()+INTERVAL '3 years',NULL,4,NOW()-INTERVAL '12 days'),
(5,'Operational Sensor Data','Schlumberger Ltd','United States','standard_contractual_clauses','tier5_public',500,50000,'Oilfield services','legitimate_interest','medium','approved','DPO-NNPC-001',NOW()-INTERVAL '5 days',NOW()+INTERVAL '1 year',NULL,5,NOW()-INTERVAL '7 days'),
(6,'Customer Purchase History','Amazon Web Services','United States','standard_contractual_clauses','tier2_financial',10,1500000,'E-commerce analytics','legitimate_interest','medium','rejected',NULL,NULL,NULL,'Insufficient safeguards for financial data transfer',6,NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── Financial Ledger ─────────────────────────────────────────────────────────
INSERT INTO financial_ledger (transaction_id, organization_id, penalty_id, violation_id, tx_type, amount, currency, description, reference, status, created_at) VALUES
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
INSERT INTO bgp_routes (prefix, origin_asn, as_path, next_hop, local_pref, med, communities, origin_type, is_valid, is_selected, rpki_status, irr_status, data_residency_compliant, organization_id, detected_at, last_seen_at) VALUES
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
INSERT INTO residency_checks (organization_id, asset_id, check_type, data_classification, storage_location, storage_provider, storage_region, is_compliant, violation_type, violation_details, remediation_required, remediation_deadline, remediation_status, checked_at, created_at) VALUES
(1,1,'automated','tier2_financial','Lagos, Nigeria','AWS','af-south-1',true,NULL,NULL,false,NULL,'not_required',NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days'),
(2,2,'automated','tier1_pii','Dublin, Ireland','AWS','eu-west-1',false,'cross_border_without_approval','Customer PII stored outside Nigeria without NDPC approval',true,NOW()+INTERVAL '30 days','pending',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(3,3,'manual','tier3_health','London, UK','Azure','uksouth',false,'cross_border_without_approval','Patient health records stored in UK without adequate safeguards',true,NOW()+INTERVAL '14 days','in_progress',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(4,4,'automated','tier1_pii','Lagos, Nigeria','GCP','africa-south1',true,NULL,NULL,false,NULL,'not_required',NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(5,5,'automated','tier5_public','Houston, USA','Azure','eastus',false,'cross_border_without_approval','Operational data stored in US without proper transfer mechanism',true,NOW()+INTERVAL '45 days','pending',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Drift Alerts ─────────────────────────────────────────────────────────────
INSERT INTO drift_alerts (organization_id, alert_type, severity, title, description, baseline_value, current_value, drift_percentage, auto_remediated, remediation_action, status, acknowledged_by, acknowledged_at, resolved_at, created_at) VALUES
(1,'compliance_score_drop','high','Compliance Score Dropped 15%','First Bank compliance score dropped from 87 to 72 over 30 days',87,72,17.2,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '5 days'),
(2,'new_violation_spike','critical','Violation Count Spike Detected','MTN Nigeria violations increased 300% in 7 days',5,20,300,false,NULL,'acknowledged',1,NOW()-INTERVAL '3 days',NULL,NOW()-INTERVAL '4 days'),
(3,'data_transfer_anomaly','medium','Unusual Data Transfer Volume','LUTH data transfer volume 5x normal baseline',100,520,420,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '3 days'),
(4,'policy_change_detected','low','Privacy Policy Updated Without Notification','FME updated privacy policy without notifying NDPC',NULL,NULL,NULL,false,NULL,'resolved',1,NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day',NOW()-INTERVAL '2 days'),
(5,'asset_exposure','high','New Internet-Exposed Asset Detected','NNPC has new publicly accessible database endpoint',0,1,NULL,false,NULL,'open',NULL,NULL,NULL,NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Monitoring Snapshots ─────────────────────────────────────────────────────
INSERT INTO monitoring_snapshots (organization_id, snapshot_type, compliance_score, violation_count, open_cases, pending_actions, risk_level, data_assets_count, last_audit_date, next_audit_date, metadata, created_at) VALUES
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
INSERT INTO onboarding_phases (organization_id, phase_name, phase_order, status, started_at, completed_at, assigned_to, notes, created_at) VALUES
(1,'Initial Registration',1,'completed',NOW()-INTERVAL '180 days',NOW()-INTERVAL '175 days',1,'Organisation registered successfully',NOW()-INTERVAL '180 days'),
(1,'Document Verification',2,'completed',NOW()-INTERVAL '175 days',NOW()-INTERVAL '170 days',1,'CAC certificate and board resolution verified',NOW()-INTERVAL '175 days'),
(1,'DPO Appointment',3,'completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '165 days',1,'DPO appointed and registered',NOW()-INTERVAL '170 days'),
(1,'Compliance Assessment',4,'completed',NOW()-INTERVAL '165 days',NOW()-INTERVAL '150 days',1,'Initial compliance assessment completed - score 72',NOW()-INTERVAL '165 days'),
(1,'Policy Review',5,'in_progress',NOW()-INTERVAL '150 days',NULL,1,'Privacy policy under review',NOW()-INTERVAL '150 days'),
(2,'Initial Registration',1,'completed',NOW()-INTERVAL '200 days',NOW()-INTERVAL '195 days',1,'Organisation registered successfully',NOW()-INTERVAL '200 days'),
(2,'Document Verification',2,'completed',NOW()-INTERVAL '195 days',NOW()-INTERVAL '190 days',1,'All documents verified',NOW()-INTERVAL '195 days'),
(2,'DPO Appointment',3,'completed',NOW()-INTERVAL '190 days',NOW()-INTERVAL '185 days',1,'DPO appointed',NOW()-INTERVAL '190 days'),
(2,'Compliance Assessment',4,'completed',NOW()-INTERVAL '185 days',NOW()-INTERVAL '170 days',1,'Assessment completed - score 85',NOW()-INTERVAL '185 days'),
(2,'Policy Review',5,'completed',NOW()-INTERVAL '170 days',NOW()-INTERVAL '160 days',1,'All policies approved',NOW()-INTERVAL '170 days')
ON CONFLICT DO NOTHING;

-- ─── Portal Submissions ───────────────────────────────────────────────────────
INSERT INTO portal_submissions (organization_id, submission_type, sector, phase, title, description, submitted_by, status, reviewer_id, review_notes, submitted_at, reviewed_at, created_at) VALUES
(1,'compliance_return','Financial Services','annual','Annual Compliance Return 2025','Annual NDPR compliance return for FY2025','compliance@firstbank.com','approved',1,'All requirements met. Organisation is compliant.',NOW()-INTERVAL '30 days',NOW()-INTERVAL '20 days',NOW()-INTERVAL '30 days'),
(2,'breach_notification','Telecommunications','immediate','Data Breach Notification - January 2026','Notification of data breach affecting 50,000 subscribers','security@mtn.com','under_review',1,NULL,NOW()-INTERVAL '15 days',NULL,NOW()-INTERVAL '15 days'),
(3,'dpia_submission','Healthcare','quarterly','DPIA Submission - EHR System','DPIA for new Electronic Health Records system','dpo@luth.gov.ng','approved',1,'DPIA approved with conditions.',NOW()-INTERVAL '25 days',NOW()-INTERVAL '18 days',NOW()-INTERVAL '25 days'),
(4,'policy_registration','Government','initial','Privacy Policy Registration','Registration of updated privacy policy','compliance@fme.gov.ng','approved',1,'Policy meets NDPR requirements.',NOW()-INTERVAL '20 days',NOW()-INTERVAL '15 days',NOW()-INTERVAL '20 days'),
(5,'transfer_approval','Energy','ad_hoc','Cross-Border Transfer Approval Request','Request for approval of data transfer to US-based service provider','dpo@nnpc.gov.ng','pending',NULL,NULL,NOW()-INTERVAL '5 days',NULL,NOW()-INTERVAL '5 days'),
(6,'complaint_response','E-Commerce','immediate','Response to Consumer Complaint','Response to NDPC complaint reference NDPC-COMP-2026-001','legal@jumia.com','submitted',NULL,NULL,NOW()-INTERVAL '3 days',NULL,NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── Compliance Audit Returns ─────────────────────────────────────────────────
INSERT INTO compliance_audit_returns (organization_id, return_period, return_type, compliance_score, total_controls, controls_implemented, controls_partial, controls_missing, critical_findings, high_findings, medium_findings, low_findings, dpo_name, dpo_email, submitted_by, submission_date, status, reviewer_id, review_notes, created_at) VALUES
(1,'2025','annual',72,50,36,8,6,2,3,5,4,'Adewale Adeyemi','dpo@firstbank.com','Chief Compliance Officer','2026-01-31','approved',1,'Annual return reviewed and accepted. Improvement plan required for critical findings.',NOW()-INTERVAL '75 days'),
(2,'2025','annual',85,50,43,5,2,0,2,3,2,'Chukwuemeka Obi','dpo@mtn.com','Head of Compliance','2026-01-31','approved',1,'Return accepted. Good compliance posture.',NOW()-INTERVAL '70 days'),
(3,'2025','annual',68,50,34,9,7,3,4,6,5,'Dr. Amaka Nwosu','dpo@luth.gov.ng','Director of Administration','2026-02-15','under_review',NULL,NULL,NOW()-INTERVAL '55 days'),
(4,'2025','annual',91,50,46,3,1,0,0,2,1,'Ibrahim Suleiman','dpo@fme.gov.ng','Director of Legal Services','2026-01-31','approved',1,'Excellent compliance. Minimal findings.',NOW()-INTERVAL '65 days'),
(5,'2025','annual',78,50,39,7,4,1,2,4,3,'Ngozi Okonkwo','dpo@nnpc.gov.ng','Chief Compliance Officer','2026-02-28','pending',NULL,NULL,NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── Penalty Appeals ──────────────────────────────────────────────────────────
INSERT INTO penalty_appeals (penalty_id, organization_id, appeal_grounds, supporting_documents, legal_representative, appeal_date, hearing_date, status, decision, decision_notes, decided_by, decided_at, created_at) VALUES
(2,2,'Disproportionate penalty amount given the nature of the violation and the organisation''s remediation efforts',ARRAY['remediation_plan.pdf','compliance_certificate.pdf'],'Adewale & Associates Legal','2026-02-15','2026-03-20','under_review',NULL,NULL,NULL,NULL,NOW()-INTERVAL '55 days'),
(3,3,'First-time offence with immediate remediation. Penalty amount exceeds NDPR guidelines for healthcare sector.',ARRAY['dpia_report.pdf','remediation_evidence.pdf'],'Healthcare Legal Partners','2026-02-20',NULL,'submitted',NULL,NULL,NULL,NULL,NOW()-INTERVAL '50 days')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Actions ──────────────────────────────────────────────────────
INSERT INTO enforcement_actions (violation_id, organization_id, workflow_id, action_type, status, notice_issued_at, audit_scheduled_at, penalty_imposed_at, penalty_amount, notes, created_at, updated_at) VALUES
(1,1,'WF-ENF-001','formal_notice','completed',NOW()-INTERVAL '24 days',NULL,NULL,NULL,'Formal notice issued for data breach',NOW()-INTERVAL '24 days',NOW()-INTERVAL '20 days'),
(2,2,'WF-ENF-002','formal_notice','completed',NOW()-INTERVAL '29 days',NULL,NULL,NULL,'Formal notice issued for NDPR violations',NOW()-INTERVAL '29 days',NOW()-INTERVAL '25 days'),
(2,2,'WF-ENF-002','audit_scheduled','completed',NULL,NOW()-INTERVAL '20 days',NULL,NULL,'Compliance audit scheduled',NOW()-INTERVAL '25 days',NOW()-INTERVAL '20 days'),
(3,3,'WF-ENF-003','formal_notice','completed',NOW()-INTERVAL '19 days',NULL,NULL,NULL,'Formal notice issued for consent violations',NOW()-INTERVAL '19 days',NOW()-INTERVAL '15 days'),
(4,4,'WF-ENF-004','penalty_imposed','completed',NULL,NULL,NOW()-INTERVAL '20 days',25000000,'Penalty of ₦25M imposed and paid',NOW()-INTERVAL '25 days',NOW()-INTERVAL '20 days'),
(5,5,'WF-ENF-005','formal_notice','pending',NOW()-INTERVAL '14 days',NULL,NULL,NULL,'Formal notice issued for data transfer violations',NOW()-INTERVAL '14 days',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Streaming Events ─────────────────────────────────────────────────────────
INSERT INTO streaming_events (event_type, source_service, organization_id, payload, severity, processed, processed_at, created_at) VALUES
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
INSERT INTO webhook_subscriptions (organization_id, url, secret, event_types, is_active, description, created_at) VALUES
(1,'https://compliance.firstbank.com/webhooks/ndsep','secret-fbngla-001',ARRAY['compliance_violation','enforcement_action','breach_notification'],true,'First Bank NDSEP webhook endpoint',NOW()-INTERVAL '60 days'),
(2,'https://api.mtn.com/ndsep/events','secret-mtnngla-001',ARRAY['compliance_violation','data_residency_alert','bgp_anomaly'],true,'MTN Nigeria NDSEP integration',NOW()-INTERVAL '45 days'),
(3,'https://it.luth.gov.ng/ndsep/webhook','secret-luth-001',ARRAY['dpia_status_change','transfer_approval','enforcement_action'],true,'LUTH NDSEP webhook',NOW()-INTERVAL '30 days'),
(4,'https://systems.fme.gov.ng/ndsep/hook','secret-fme-001',ARRAY['compliance_violation','audit_return_status'],true,'FME NDSEP integration',NOW()-INTERVAL '20 days'),
(5,'https://digital.nnpc.gov.ng/ndsep/events','secret-nnpc-001',ARRAY['compliance_violation','transfer_approval','enforcement_action'],true,'NNPC NDSEP webhook',NOW()-INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- ─── Webhook Deliveries ───────────────────────────────────────────────────────
INSERT INTO webhook_deliveries (subscription_id, event_type, payload, response_status, response_body, attempt_count, delivered_at, next_retry_at, created_at) VALUES
(1,'compliance_violation','{"event":"compliance_violation","org_id":1,"severity":"critical"}',200,'{"status":"received"}',1,NOW()-INTERVAL '29 days',NULL,NOW()-INTERVAL '30 days'),
(2,'bgp_anomaly','{"event":"bgp_anomaly","prefix":"105.112.0.0/14","asn":29465}',200,'{"status":"ok"}',1,NOW()-INTERVAL '9 days',NULL,NOW()-INTERVAL '10 days'),
(1,'enforcement_action','{"event":"enforcement_action","case_ref":"NDPC-ENF-2026-001"}',500,'{"error":"Internal Server Error"}',3,NULL,NOW()+INTERVAL '1 hour',NOW()-INTERVAL '24 days'),
(3,'dpia_status_change','{"event":"dpia_status_change","dpia_id":3,"status":"under_review"}',200,'{"status":"received"}',1,NOW()-INTERVAL '4 days',NULL,NOW()-INTERVAL '5 days'),
(5,'transfer_approval','{"event":"transfer_approval","transfer_id":5,"status":"approved"}',200,'{"status":"ok"}',1,NOW()-INTERVAL '4 days',NULL,NOW()-INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Clients ─────────────────────────────────────────────────────────────
INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, contact_phone, status, risk_level, compliance_score, onboarded_at, metadata, created_at) VALUES
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
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, engagement_ref, engagement_type, scope, start_date, end_date, status, lead_auditor, team_members, total_controls, controls_reviewed, findings_critical, findings_high, findings_medium, findings_low, compliance_score, report_url, created_at) VALUES
(1,1,'ENG-DG-2026-001','full_audit','Full NDPR compliance audit including data mapping, consent management, and breach response','2026-01-10','2026-02-10','completed','Senior Auditor A',ARRAY['Auditor B','Auditor C'],50,50,1,2,4,3,82,'https://storage.ndsep.ng/reports/ENG-DG-2026-001.pdf',NOW()-INTERVAL '90 days'),
(1,2,'ENG-DG-2026-002','gap_assessment','NDPR gap assessment for Fidelity Bank','2026-02-01','2026-02-28','completed','Senior Auditor A',ARRAY['Auditor D'],30,30,2,3,5,4,75,'https://storage.ndsep.ng/reports/ENG-DG-2026-002.pdf',NOW()-INTERVAL '60 days'),
(2,4,'ENG-PS-2026-001','full_audit','Comprehensive NDPR audit for AIICO Insurance','2026-01-20','2026-02-20','completed','Lead Auditor X',ARRAY['Auditor Y'],50,50,0,1,3,2,88,'https://storage.ndsep.ng/reports/ENG-PS-2026-001.pdf',NOW()-INTERVAL '55 days'),
(3,6,'ENG-CF-2026-001','policy_review','Privacy policy and consent management review for Kuda','2026-03-01','2026-03-15','completed','Auditor P',ARRAY[],20,20,0,0,2,1,91,'https://storage.ndsep.ng/reports/ENG-CF-2026-001.pdf',NOW()-INTERVAL '30 days'),
(1,3,'ENG-DG-2026-003','dpia_support','DPIA support for Jumia e-commerce platform','2026-03-10',NULL,'in_progress','Senior Auditor A',ARRAY['Auditor E'],25,15,0,1,2,3,NULL,NULL,NOW()-INTERVAL '35 days'),
(2,5,'ENG-PS-2026-002','full_audit','Full NDPR audit for Nigerian Ports Authority','2026-04-01',NULL,'in_progress','Lead Auditor X',ARRAY['Auditor Z','Auditor W'],50,10,1,2,3,2,NULL,NULL,NOW()-INTERVAL '13 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Training Sessions ───────────────────────────────────────────────────
INSERT INTO dpco_training_sessions (dpco_org_id, client_id, session_title, session_type, delivery_mode, scheduled_at, duration_hours, attendees_count, facilitator, topics_covered, materials_url, status, feedback_score, created_at) VALUES
(1,1,'NDPR Fundamentals for Banking Staff','awareness','virtual','2026-01-15 09:00:00',3,45,'Senior Auditor A',ARRAY['NDPR overview','Data subject rights','Breach notification'],'https://storage.ndsep.ng/training/NDPR-Banking-101.pdf','completed',4.5,NOW()-INTERVAL '89 days'),
(1,2,'Data Protection Officer Training','dpo_training','in_person','2026-02-10 09:00:00',8,5,'Senior Auditor A',ARRAY['DPO responsibilities','DPIA methodology','Regulatory engagement'],'https://storage.ndsep.ng/training/DPO-Training.pdf','completed',4.8,NOW()-INTERVAL '63 days'),
(2,4,'Insurance Sector NDPR Compliance','sector_specific','virtual','2026-01-25 10:00:00',4,30,'Lead Auditor X',ARRAY['Insurance data processing','Customer consent','Retention policies'],'https://storage.ndsep.ng/training/Insurance-NDPR.pdf','completed',4.2,NOW()-INTERVAL '79 days'),
(3,6,'Fintech Data Privacy Best Practices','awareness','virtual','2026-03-20 14:00:00',2,25,'Auditor P',ARRAY['Fintech data flows','BVN/NIN handling','Customer consent'],'https://storage.ndsep.ng/training/Fintech-Privacy.pdf','completed',4.7,NOW()-INTERVAL '25 days'),
(1,3,'E-Commerce Privacy Compliance','sector_specific','virtual','2026-04-15 10:00:00',3,20,'Senior Auditor A',ARRAY['E-commerce data collection','Cookie consent','Cross-border transfers'],NULL,'scheduled',NULL,NOW()-INTERVAL '5 days'),
(2,5,'Government Sector Data Protection','sector_specific','in_person','2026-04-20 09:00:00',6,40,'Lead Auditor X',ARRAY['Government data handling','FOIA compliance','Citizen data rights'],NULL,'scheduled',NULL,NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Evidence Items ──────────────────────────────────────────────────────
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, evidence_type, title, description, file_url, file_hash, collected_by, collection_date, expiry_date, status, tags, created_at) VALUES
(1,1,'policy_document','First Bank Privacy Policy v3.2','Updated privacy policy meeting NDPR requirements','https://storage.ndsep.ng/evidence/FBN-Privacy-Policy-v3.2.pdf','sha256:abc123def456','Senior Auditor A','2026-01-15','2027-01-15','verified',ARRAY['policy','privacy','banking'],NOW()-INTERVAL '89 days'),
(1,1,'audit_report','First Bank NDPR Audit Report 2026','Full audit report for First Bank NDPR compliance','https://storage.ndsep.ng/evidence/FBN-Audit-2026.pdf','sha256:def456ghi789','Senior Auditor A','2026-02-10','2028-02-10','verified',ARRAY['audit','banking','ndpr'],NOW()-INTERVAL '63 days'),
(2,3,'dpo_appointment','AIICO DPO Appointment Letter','Formal appointment of Data Protection Officer','https://storage.ndsep.ng/evidence/AIICO-DPO-Appointment.pdf','sha256:ghi789jkl012','Lead Auditor X','2026-01-20','2028-01-20','verified',ARRAY['dpo','insurance'],NOW()-INTERVAL '84 days'),
(3,4,'training_certificate','Kuda Staff Training Completion Certificates','Training completion certificates for 25 staff','https://storage.ndsep.ng/evidence/Kuda-Training-Certs.pdf','sha256:jkl012mno345','Auditor P','2026-03-20','2027-03-20','verified',ARRAY['training','fintech'],NOW()-INTERVAL '25 days'),
(1,5,'dpia_report','Jumia DPIA Draft Report','Draft DPIA report for Jumia e-commerce platform','https://storage.ndsep.ng/evidence/Jumia-DPIA-Draft.pdf','sha256:mno345pqr678','Senior Auditor A','2026-03-25',NULL,'pending_review',ARRAY['dpia','ecommerce'],NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Verification Statements ────────────────────────────────────────────
INSERT INTO dpco_verification_statements (dpco_org_id, client_id, engagement_id, statement_ref, statement_type, compliance_level, summary, findings_summary, recommendations, valid_from, valid_until, issued_by, signed_at, status, created_at) VALUES
(1,1,1,'VS-DG-2026-001','full_compliance_certificate','substantial','First Bank of Nigeria Plc demonstrates substantial compliance with the Nigeria Data Protection Regulation (NDPR) 2019 and Nigeria Data Protection Act (NDPA) 2023.','1 critical finding (customer data analytics profiling without explicit consent) and 5 medium findings identified. All high-priority findings remediated.','Implement explicit consent mechanism for analytics profiling; complete staff training programme; update retention schedules.','2026-02-15','2027-02-15','DataGuard Nigeria Ltd','2026-02-15','active',NOW()-INTERVAL '58 days'),
(2,4,3,'VS-PS-2026-001','full_compliance_certificate','high','AIICO Insurance Plc demonstrates high compliance with NDPR and NDPA requirements.','No critical findings. 1 high finding (retention policy gaps) remediated during audit. 3 medium findings remain.','Update retention policies for legacy systems; implement automated retention enforcement; conduct annual DPIA.','2026-02-25','2027-02-25','PrivacyShield Associates','2026-02-25','active',NOW()-INTERVAL '48 days'),
(3,6,4,'VS-CF-2026-001','policy_compliance_certificate','high','Kuda Microfinance Bank demonstrates high compliance with NDPR requirements for fintech operations.','No critical or high findings. 2 medium findings related to cookie consent implementation.','Implement granular cookie consent; update privacy notice for BVN/NIN processing.','2026-03-20','2027-03-20','ComplianceFirst Ltd','2026-03-20','active',NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
INSERT INTO dpco_policy_drafts (dpco_org_id, client_id, engagement_id, policy_type, title, version, content, status, reviewed_by, review_notes, approved_at, created_at) VALUES
(1,1,1,'privacy_policy','First Bank Privacy Policy','3.2','# Privacy Policy\n\nFirst Bank of Nigeria Plc ("First Bank") is committed to protecting your personal data...\n\n## 1. Data We Collect\n...','approved','Senior Auditor A','Policy meets all NDPR requirements. Approved for publication.',NOW()-INTERVAL '60 days',NOW()-INTERVAL '89 days'),
(1,2,2,'data_retention_policy','Fidelity Bank Data Retention Policy','1.1','# Data Retention Policy\n\nThis policy governs the retention and disposal of personal data...','under_review','Senior Auditor A',NULL,NULL,NOW()-INTERVAL '50 days'),
(2,4,3,'dpo_charter','AIICO DPO Charter','2.0','# Data Protection Officer Charter\n\nThis charter defines the role, responsibilities and authority of the DPO...','approved','Lead Auditor X','DPO charter meets NDPR Article 30 requirements.',NOW()-INTERVAL '55 days',NOW()-INTERVAL '84 days'),
(3,6,4,'consent_framework','Kuda Consent Management Framework','1.0','# Consent Management Framework\n\nThis framework governs how Kuda collects, records and manages customer consent...','approved','Auditor P','Consent framework meets NDPR requirements for fintech.',NOW()-INTERVAL '25 days',NOW()-INTERVAL '35 days'),
(1,3,5,'dpia_template','Jumia DPIA Template','1.0','# Data Protection Impact Assessment Template\n\nThis template guides the DPIA process for Jumia...','draft',NULL,NULL,NULL,NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Engagement Requests ─────────────────────────────────────────────────
INSERT INTO dpco_engagement_requests (org_name, org_sector, org_country, org_registration_number, contact_name, contact_email, contact_phone, dpco_org_id, audit_scope, preferred_start_date, estimated_data_subjects, processing_activities, status, dpco_response_note, responded_at, engagement_id, reference_token, created_at) VALUES
('Moniepoint Microfinance Bank','Financial Services','Nigeria','RC-1700','Tosin Eniolorunda','tosin@moniepoint.com','+2348012345679',1,'Full NDPR compliance audit for fintech operations','2026-05-01','5000000',ARRAY['payment_processing','kyc_verification','customer_analytics'],'accepted','We are pleased to accept this engagement. Our team will contact you shortly.',NOW()-INTERVAL '5 days',NULL,'REQ-DG-2026-001',NOW()-INTERVAL '10 days'),
('VFD Microfinance Bank','Financial Services','Nigeria','RC-2000','Gbenga Omolokun','gbenga@vfd.ng','+2348023456780',2,'NDPR gap assessment and policy review','2026-05-15','2000000',ARRAY['deposit_taking','loan_processing','customer_onboarding'],'pending',NULL,NULL,NULL,'REQ-PS-2026-001',NOW()-INTERVAL '7 days'),
('Opay Digital Services Ltd','Financial Services','Nigeria','RC-1604','Yahui Zhou','yahui@opay.com','+2348034567891',3,'Privacy policy review and staff training','2026-06-01','10000000',ARRAY['payment_processing','agent_banking','customer_data'],'pending',NULL,NULL,NULL,'REQ-CF-2026-001',NOW()-INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Accreditation Applications ─────────────────────────────────────────
INSERT INTO dpco_accreditation_applications (org_name, cac_number, rc_number, tax_id, dpo_name, dpo_email, dpo_phone, dpo_qualification, organisation_type, tier_applied, state, address, services, sectors, website, indemnity_insurance_url, status, submitted_at, reviewed_by, review_notes, approved_at, licence_issued_at, licence_expiry, created_at) VALUES
('DataGuard Nigeria Ltd','CAC-DG-001','RC-100001','TIN-DG-001','Adebayo Okafor','adebayo@dataguard.ng','+2348012345678','CIPP/E, CIPM','limited_liability','professional','Lagos','15 Broad Street, Lagos Island',ARRAY['full_audit','gap_assessment','dpo_as_service'],ARRAY['banking','fintech','insurance'],'https://dataguard.ng',NULL,'approved','2025-06-01',1,'All requirements met. Excellent application.',NOW()-INTERVAL '300 days',NOW()-INTERVAL '295 days',NOW()+INTERVAL '1 year 65 days',NOW()-INTERVAL '310 days'),
('PrivacyShield Associates','CAC-PS-001','RC-100002','TIN-PS-001','Ngozi Adeyemi','ngozi@privacyshield.ng','+2348023456789','CIPP/E, LLM','limited_liability','professional','Lagos','42 Victoria Island, Lagos',ARRAY['full_audit','policy_review','training'],ARRAY['insurance','healthcare','government'],'https://privacyshield.ng',NULL,'approved','2025-07-15',1,'Strong application. Approved.',NOW()-INTERVAL '270 days',NOW()-INTERVAL '265 days',NOW()+INTERVAL '1 year 95 days',NOW()-INTERVAL '280 days'),
('ComplianceFirst Ltd','CAC-CF-001','RC-100003','TIN-CF-001','Emeka Nwosu','emeka@compliancefirst.ng','+2348034567890','CIPP/E, CIPM','limited_liability','professional','Abuja','8 Adeola Odeku Street, Abuja',ARRAY['gap_assessment','dpo_as_service','training'],ARRAY['fintech','ecommerce','telecom'],'https://compliancefirst.ng',NULL,'approved','2025-08-01',1,'Approved with conditions. Must complete advanced training.',NOW()-INTERVAL '255 days',NOW()-INTERVAL '250 days',NOW()+INTERVAL '1 year 110 days',NOW()-INTERVAL '265 days'),
('TechPrivacy Solutions','CAC-TP-001','RC-100004','TIN-TP-001','Aisha Mohammed','aisha@techprivacy.ng','+2348045678901','CIPP/E','limited_liability','associate','Kano','22 Ahmadu Bello Way, Kano',ARRAY['policy_review','training'],ARRAY['healthcare','education'],'https://techprivacy.ng',NULL,'under_review','2026-01-10',NULL,NULL,NULL,NULL,NULL,NOW()-INTERVAL '94 days'),
('NigeriaDataPro Ltd','CAC-NDP-001','RC-100005','TIN-NDP-001','Babatunde Fashola','babatunde@nigeriadatapro.ng','+2348056789012','CIPP/E, MBA','limited_liability','professional','Lagos','7 Adeola Hopewell Street, VI',ARRAY['full_audit','dpia_support','gap_assessment'],ARRAY['banking','government','energy'],'https://nigeriadatapro.ng',NULL,'pending','2026-03-20',NULL,NULL,NULL,NULL,NULL,NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Performance Metrics (key-value format matching actual schema) ────────
INSERT INTO dpco_performance_metrics (dpco_org_id, metric_name, metric_value, period_start, period_end, recorded_at) VALUES
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
INSERT INTO ai_governance_scores (organization_id, ai_system_id, assessment_date, transparency_score, fairness_score, accountability_score, robustness_score, privacy_score, overall_score, risk_level, assessor_id, notes, created_at) VALUES
(1,1,'2026-01-15',75,68,80,72,85,76,'medium',1,'Customer credit scoring model shows some fairness concerns in demographic groups',NOW()-INTERVAL '89 days'),
(2,2,'2026-01-20',82,78,85,80,88,83,'low',1,'Network anomaly detection system meets AI governance requirements',NOW()-INTERVAL '84 days'),
(3,3,'2026-02-01',65,55,70,68,72,66,'high',1,'Diagnostic AI system requires bias audit and explainability improvements',NOW()-INTERVAL '73 days'),
(4,4,'2026-02-10',88,85,90,87,92,88,'low',1,'Student performance prediction system demonstrates good governance',NOW()-INTERVAL '64 days'),
(5,5,'2026-02-20',71,65,75,70,78,72,'medium',1,'Predictive maintenance AI requires additional documentation',NOW()-INTERVAL '54 days'),
(1,6,'2026-03-01',79,72,82,76,84,79,'medium',1,'Fraud detection model shows good performance with some explainability gaps',NOW()-INTERVAL '44 days'),
(2,7,'2026-03-10',85,80,88,83,90,85,'low',1,'Customer churn prediction meets governance standards',NOW()-INTERVAL '35 days'),
(3,8,'2026-03-20',60,52,65,58,68,61,'high',1,'Drug interaction prediction AI requires significant governance improvements',NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── API Keys ─────────────────────────────────────────────────────────────────
INSERT INTO api_keys (organization_id, key_name, key_hash, key_prefix, scopes, rate_limit_per_hour, is_active, last_used_at, expires_at, created_by, created_at) VALUES
(1,'First Bank Production API Key','sha256:fbngla-prod-hash-001','fbk_prod_',ARRAY['compliance:read','violations:read','reports:read'],1000,true,NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '90 days'),
(2,'MTN Nigeria API Integration','sha256:mtnngla-prod-hash-001','mtn_prod_',ARRAY['compliance:read','bgp:read','residency:read'],2000,true,NOW()-INTERVAL '30 minutes',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '60 days'),
(3,'LUTH Data Portal Key','sha256:luth-prod-hash-001','lth_prod_',ARRAY['compliance:read','dpia:read','transfers:read'],500,true,NOW()-INTERVAL '2 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '45 days'),
(4,'FME Integration Key','sha256:fme-prod-hash-001','fme_prod_',ARRAY['compliance:read','reports:read'],500,true,NOW()-INTERVAL '6 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '30 days'),
(5,'NNPC API Key','sha256:nnpc-prod-hash-001','nnp_prod_',ARRAY['compliance:read','residency:read','transfers:read'],1000,true,NOW()-INTERVAL '3 hours',NOW()+INTERVAL '1 year',1,NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── In-App Notifications ─────────────────────────────────────────────────────
INSERT INTO in_app_notifications (user_id, title, body, notification_type, severity, is_read, action_url, metadata, created_at) VALUES
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
INSERT INTO notification_settings (user_id, email_enabled, sms_enabled, push_enabled, alert_types, created_at) VALUES
(1,true,true,true,ARRAY['critical','high','medium','low'],NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Control Ratings ───────────────────────────────────────────────
INSERT INTO dpco_audit_control_ratings (engagement_id, control_domain, control_id, control_name, rating, finding_severity, finding_description, recommendation, evidence_ref, created_at) VALUES
(1,'data_governance','DG-001','Data Inventory and Classification','substantial','medium','Data inventory exists but lacks automated discovery for shadow IT assets','Implement automated data discovery tools','ENG-DG-2026-001-DG001',NOW()-INTERVAL '63 days'),
(1,'consent_management','CM-001','Consent Collection Mechanism','limited','high','Analytics consent bundled with service consent — not granular','Implement separate consent for each processing purpose','ENG-DG-2026-001-CM001',NOW()-INTERVAL '63 days'),
(1,'breach_response','BR-001','Breach Detection and Response','substantial','low','Breach response procedure exists and was tested','No action required','ENG-DG-2026-001-BR001',NOW()-INTERVAL '63 days'),
(3,'data_governance','DG-001','Data Inventory and Classification','high','low','Comprehensive data inventory maintained','Continue current practice','ENG-PS-2026-001-DG001',NOW()-INTERVAL '55 days'),
(3,'retention_policy','RP-001','Data Retention Schedule','substantial','high','Retention schedules exist but not enforced for legacy systems','Implement automated retention enforcement for legacy systems','ENG-PS-2026-001-RP001',NOW()-INTERVAL '55 days'),
(4,'consent_management','CM-001','Cookie Consent Implementation','substantial','medium','Cookie consent banner present but lacks granular controls','Implement category-based cookie consent','ENG-CF-2026-001-CM001',NOW()-INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Logs ──────────────────────────────────────────────────────────
INSERT INTO dpco_audit_logs (dpco_org_id, user_id, action, resource_type, resource_id, details, ip_address, created_at) VALUES
(1,1,'engagement_created','engagement',1,'Created audit engagement ENG-DG-2026-001 for First Bank','196.45.12.34',NOW()-INTERVAL '90 days'),
(1,1,'report_generated','engagement',1,'Generated final audit report for ENG-DG-2026-001','196.45.12.34',NOW()-INTERVAL '63 days'),
(1,1,'verification_issued','verification_statement',1,'Issued verification statement VS-DG-2026-001','196.45.12.34',NOW()-INTERVAL '58 days'),
(2,1,'engagement_created','engagement',3,'Created audit engagement ENG-PS-2026-001 for AIICO Insurance','196.45.12.34',NOW()-INTERVAL '84 days'),
(2,1,'report_generated','engagement',3,'Generated final audit report for ENG-PS-2026-001','196.45.12.34',NOW()-INTERVAL '55 days'),
(3,1,'engagement_created','engagement',4,'Created audit engagement ENG-CF-2026-001 for Kuda','196.45.12.34',NOW()-INTERVAL '35 days'),
(3,1,'training_scheduled','training',5,'Scheduled e-commerce privacy training for Jumia','196.45.12.34',NOW()-INTERVAL '5 days'),
(1,1,'client_onbo
