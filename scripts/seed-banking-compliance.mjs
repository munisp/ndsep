#!/usr/bin/env node
/**
 * NDSEP Banking & Compliance Comprehensive Seed Script
 * Seeds: banking_institutions, kyc_records, aml_cases, watchlist_entries,
 *        nip_transactions, compliance_policies, breach_incidents,
 *        consent_records, data_catalog_entries, enforcement_actions
 *
 * Run: node scripts/seed-banking-compliance.mjs
 */
import pg from "pg";
const { Pool } = pg;

const DB_URL = process.env.LOCAL_DATABASE_URL ??
  (process.env.DATABASE_URL || "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db");

const pool = new Pool({ connectionString: DB_URL, ssl: false });

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── Nigerian Banks (CBN-licensed) ──────────────────────────────────────────
const BANKS = [
  { cbn_code: "000001", sort_code: "000001", bic_code: "GTBINGLA", name: "Guaranty Trust Bank Plc", short_name: "GTBank", license_type: "commercial", license_number: "RC152321", status: "licensed", head_office_address: "635 Akin Adesola Street, Victoria Island, Lagos", ceo_name: "Segun Agbaje", total_assets: 7200000000000, capital_adequacy_ratio: 22.5, non_performing_loan_ratio: 3.2, data_protection_officer: "Adaeze Okafor", compliance_score: 94 },
  { cbn_code: "000002", sort_code: "000002", bic_code: "ZENITHNG", name: "Zenith Bank Plc", short_name: "Zenith", license_type: "commercial", license_number: "RC6008", status: "licensed", head_office_address: "Zenith Heights, Plot 84, Ajose Adeogun Street, Victoria Island, Lagos", ceo_name: "Ebenezer Onyeagwu", total_assets: 9100000000000, capital_adequacy_ratio: 21.8, non_performing_loan_ratio: 2.8, data_protection_officer: "Chioma Nwosu", compliance_score: 96 },
  { cbn_code: "000003", sort_code: "000003", bic_code: "FIRSTNIG", name: "First Bank of Nigeria Limited", short_name: "FirstBank", license_type: "commercial", license_number: "RC6290", status: "licensed", head_office_address: "Samuel Asabia House, 35 Marina, Lagos Island, Lagos", ceo_name: "Olusegun Alebiosu", total_assets: 11500000000000, capital_adequacy_ratio: 19.2, non_performing_loan_ratio: 5.1, data_protection_officer: "Ngozi Adeyemi", compliance_score: 88 },
  { cbn_code: "000004", sort_code: "000004", bic_code: "UBANNING", name: "United Bank for Africa Plc", short_name: "UBA", license_type: "commercial", license_number: "RC2457", status: "licensed", head_office_address: "UBA House, 57 Marina, Lagos Island, Lagos", ceo_name: "Oliver Alawuba", total_assets: 8400000000000, capital_adequacy_ratio: 20.1, non_performing_loan_ratio: 3.9, data_protection_officer: "Emeka Okonkwo", compliance_score: 91 },
  { cbn_code: "000005", sort_code: "000005", bic_code: "ACCESSNG", name: "Access Bank Plc", short_name: "Access", license_type: "commercial", license_number: "RC125384", status: "licensed", head_office_address: "Plot 1665, Oyin Jolayemi Street, Victoria Island, Lagos", ceo_name: "Roosevelt Ogbonna", total_assets: 12800000000000, capital_adequacy_ratio: 18.7, non_performing_loan_ratio: 4.2, data_protection_officer: "Fatima Bello", compliance_score: 89 },
  { cbn_code: "000006", sort_code: "000006", bic_code: "STBINGLA", name: "Stanbic IBTC Bank Plc", short_name: "Stanbic IBTC", license_type: "commercial", license_number: "RC125097", status: "licensed", head_office_address: "I.B.T.C. Place, Walter Carrington Crescent, Victoria Island, Lagos", ceo_name: "Wole Adeniyi", total_assets: 2900000000000, capital_adequacy_ratio: 24.3, non_performing_loan_ratio: 2.1, data_protection_officer: "Kemi Adeleke", compliance_score: 97 },
  { cbn_code: "000007", sort_code: "000007", bic_code: "FCMBNGLA", name: "First City Monument Bank Limited", short_name: "FCMB", license_type: "commercial", license_number: "RC46713", status: "licensed", head_office_address: "Primrose Tower, 17A Tinubu Street, Lagos Island, Lagos", ceo_name: "Yemisi Edun", total_assets: 2100000000000, capital_adequacy_ratio: 17.9, non_performing_loan_ratio: 6.3, data_protection_officer: "Tunde Afolabi", compliance_score: 82 },
  { cbn_code: "000008", sort_code: "000008", bic_code: "FIDELITY", name: "Fidelity Bank Plc", short_name: "Fidelity", license_type: "commercial", license_number: "RC103022", status: "licensed", head_office_address: "2 Kofo Abayomi Street, Victoria Island, Lagos", ceo_name: "Nneka Onyeali-Ikpe", total_assets: 2600000000000, capital_adequacy_ratio: 18.4, non_performing_loan_ratio: 4.7, data_protection_officer: "Adaora Obiechina", compliance_score: 85 },
  { cbn_code: "000009", sort_code: "000009", bic_code: "ECOBNIG", name: "Ecobank Nigeria Limited", short_name: "Ecobank", license_type: "commercial", license_number: "RC89773", status: "licensed", head_office_address: "Plot 21, Ahmadu Bello Way, Victoria Island, Lagos", ceo_name: "Patrick Akinwuntan", total_assets: 1800000000000, capital_adequacy_ratio: 16.8, non_performing_loan_ratio: 7.2, data_protection_officer: "Amaka Eze", compliance_score: 79 },
  { cbn_code: "000010", sort_code: "000010", bic_code: "POLARIS", name: "Polaris Bank Limited", short_name: "Polaris", license_type: "commercial", license_number: "RC1433899", status: "licensed", head_office_address: "3 Broad Street, Lagos Island, Lagos", ceo_name: "Innocent Ike", total_assets: 1200000000000, capital_adequacy_ratio: 15.3, non_performing_loan_ratio: 8.9, data_protection_officer: "Bola Adeyemi", compliance_score: 74 },
  { cbn_code: "000011", sort_code: "000011", bic_code: "OPAY", name: "OPay Digital Services Limited", short_name: "OPay", license_type: "payment_service_bank", license_number: "RC1474689", status: "licensed", head_office_address: "Plot 1, Block 1, Lekki Free Trade Zone, Lagos", ceo_name: "Dauda Gotring", total_assets: 450000000000, capital_adequacy_ratio: 28.1, non_performing_loan_ratio: 1.2, data_protection_officer: "Aisha Mohammed", compliance_score: 92 },
  { cbn_code: "000012", sort_code: "000012", bic_code: "KUDA", name: "Kuda Microfinance Bank Limited", short_name: "Kuda", license_type: "microfinance", license_number: "RC1450862", status: "licensed", head_office_address: "14 Saka Tinubu Street, Victoria Island, Lagos", ceo_name: "Babs Ogundeyi", total_assets: 180000000000, capital_adequacy_ratio: 32.5, non_performing_loan_ratio: 2.8, data_protection_officer: "Temi Oyelaran", compliance_score: 95 },
];

// ─── KYC Records ─────────────────────────────────────────────────────────────
const KYC_RECORDS = [
  { reference_id: "KYC-2026-001", subject_type: "individual", full_name: "Adebayo Olusola Adeyemi", date_of_birth: "1985-03-15", nationality: "Nigerian", bvn: "22345678901", nin: "12345678901", phone_number: "+2348012345678", email: "adebayo.adeyemi@email.com", address: "15 Adeola Odeku Street, Victoria Island, Lagos", liveness_score: 98.5, face_match_score: 97.2, bvn_verified: true, nin_verified: true, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "national_id" },
  { reference_id: "KYC-2026-002", subject_type: "individual", full_name: "Chidinma Okonkwo-Nwosu", date_of_birth: "1990-07-22", nationality: "Nigerian", bvn: "22456789012", nin: "23456789012", phone_number: "+2348023456789", email: "chidinma.nwosu@email.com", address: "42 Awolowo Road, Ikoyi, Lagos", liveness_score: 96.8, face_match_score: 95.4, bvn_verified: true, nin_verified: true, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "passport" },
  { reference_id: "KYC-2026-003", subject_type: "individual", full_name: "Musa Ibrahim Abdullahi", date_of_birth: "1978-11-08", nationality: "Nigerian", bvn: "22567890123", nin: "34567890123", phone_number: "+2348034567890", email: "musa.abdullahi@email.com", address: "7 Yakubu Gowon Way, Kaduna", liveness_score: 94.2, face_match_score: 93.1, bvn_verified: true, nin_verified: false, address_verified: true, tier: "tier2", status: "in_review", risk_rating: "medium", pep_flag: false, sanctions_flag: false, id_document_type: "drivers_license" },
  { reference_id: "KYC-2026-004", subject_type: "individual", full_name: "Ngozi Amara Obi", date_of_birth: "1995-02-28", nationality: "Nigerian", bvn: "22678901234", nin: "45678901234", phone_number: "+2348045678901", email: "ngozi.obi@email.com", address: "23 Enugu Road, Onitsha, Anambra", liveness_score: 99.1, face_match_score: 98.7, bvn_verified: true, nin_verified: true, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "national_id" },
  { reference_id: "KYC-2026-005", subject_type: "individual", full_name: "Emeka Chukwuemeka Eze", date_of_birth: "1972-09-14", nationality: "Nigerian", bvn: "22789012345", nin: "56789012345", phone_number: "+2348056789012", email: "emeka.eze@email.com", address: "5 Aba Road, Port Harcourt, Rivers", liveness_score: 91.5, face_match_score: 89.3, bvn_verified: true, nin_verified: true, address_verified: false, tier: "tier2", status: "in_review", risk_rating: "high", pep_flag: true, sanctions_flag: false, id_document_type: "passport" },
  { reference_id: "KYC-2026-006", subject_type: "corporate", full_name: "Dangote Industries Limited", date_of_birth: null, nationality: "Nigerian", bvn: null, nin: null, phone_number: "+2341234567890", email: "compliance@dangote.com", address: "Union Marble House, 1 Alfred Rewane Road, Ikoyi, Lagos", liveness_score: null, face_match_score: null, bvn_verified: false, nin_verified: false, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "cac_certificate" },
  { reference_id: "KYC-2026-007", subject_type: "individual", full_name: "Aisha Bello Usman", date_of_birth: "1988-05-30", nationality: "Nigerian", bvn: "22890123456", nin: "67890123456", phone_number: "+2348067890123", email: "aisha.usman@email.com", address: "12 Shehu Shagari Way, Abuja", liveness_score: 97.3, face_match_score: 96.8, bvn_verified: true, nin_verified: true, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "national_id" },
  { reference_id: "KYC-2026-008", subject_type: "individual", full_name: "Olawale Taiwo Ogundimu", date_of_birth: "1982-12-03", nationality: "Nigerian", bvn: "22901234567", nin: "78901234567", phone_number: "+2348078901234", email: "olawale.ogundimu@email.com", address: "88 Ibadan Street, Ibadan, Oyo", liveness_score: 85.2, face_match_score: 82.7, bvn_verified: true, nin_verified: false, address_verified: false, tier: "tier1", status: "rejected", risk_rating: "high", pep_flag: false, sanctions_flag: true, id_document_type: "drivers_license" },
  { reference_id: "KYC-2026-009", subject_type: "corporate", full_name: "MTN Nigeria Communications Plc", date_of_birth: null, nationality: "Nigerian", bvn: null, nin: null, phone_number: "+2341234500000", email: "dpo@mtn.com", address: "MTN House, 1 Mobolaji Johnson Avenue, Alausa, Lagos", liveness_score: null, face_match_score: null, bvn_verified: false, nin_verified: false, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "cac_certificate" },
  { reference_id: "KYC-2026-010", subject_type: "individual", full_name: "Fatima Zahra Al-Hassan", date_of_birth: "1993-08-17", nationality: "Nigerian", bvn: "23012345678", nin: "89012345678", phone_number: "+2348089012345", email: "fatima.alhassan@email.com", address: "3 Sultan Abubakar Road, Sokoto", liveness_score: 96.1, face_match_score: 95.5, bvn_verified: true, nin_verified: true, address_verified: true, tier: "tier3", status: "verified", risk_rating: "low", pep_flag: false, sanctions_flag: false, id_document_type: "national_id" },
];

// ─── AML Cases ────────────────────────────────────────────────────────────────
const AML_CASES = [
  { case_ref: "AML-2026-001", subject_name: "Olawale Taiwo Ogundimu", subject_type: "individual", subject_bvn: "22901234567", case_type: "suspicious_transaction", status: "under_investigation", risk_score: 85, pep_match: false, sanctions_match: true, adverse_media_match: true, transaction_amount: 45000000, transaction_currency: "NGN", transaction_ref: "TXN-2026-001234", source_of_funds: "Unknown — inconsistent with declared income", narrative: "Multiple large cash deposits inconsistent with customer profile. Transactions structured to avoid reporting thresholds (smurfing pattern detected). Customer on OFAC SDN list.", str_reference: "STR-2026-001", assigned_to: "Compliance Officer Adaeze Nwosu" },
  { case_ref: "AML-2026-002", subject_name: "Bright Star Trading Company", subject_type: "corporate", subject_bvn: null, case_type: "pep_match", status: "open", risk_score: 72, pep_match: true, sanctions_match: false, adverse_media_match: false, transaction_amount: 250000000, transaction_currency: "NGN", transaction_ref: "TXN-2026-002345", source_of_funds: "Business proceeds", narrative: "Corporate account linked to politically exposed person (state governor). Large wire transfers to offshore accounts require enhanced due diligence.", str_reference: null, assigned_to: "Senior AML Analyst Tunde Afolabi" },
  { case_ref: "AML-2026-003", subject_name: "Emeka Chukwuemeka Eze", subject_type: "individual", subject_bvn: "22789012345", case_type: "sanctions_match", status: "filed_str", risk_score: 91, pep_match: true, sanctions_match: true, adverse_media_match: true, transaction_amount: 180000000, transaction_currency: "NGN", transaction_ref: "TXN-2026-003456", source_of_funds: "Undisclosed", narrative: "Subject matches UN Security Council sanctions list. Multiple adverse media reports. STR filed with NFIU. Account frozen pending investigation.", str_reference: "STR-2026-003", str_filed_at: new Date("2026-03-15T10:30:00Z"), assigned_to: "Head of Compliance Ngozi Adeyemi" },
  { case_ref: "AML-2026-004", subject_name: "Global Ventures Nigeria Ltd", subject_type: "corporate", subject_bvn: null, case_type: "unusual_pattern", status: "open", risk_score: 65, pep_match: false, sanctions_match: false, adverse_media_match: true, transaction_amount: 95000000, transaction_currency: "NGN", transaction_ref: "TXN-2026-004567", source_of_funds: "Export proceeds", narrative: "Unusual pattern of round-number transactions. Adverse media reports link company to procurement fraud. Enhanced monitoring activated.", str_reference: null, assigned_to: "AML Analyst Kemi Adeleke" },
  { case_ref: "AML-2026-005", subject_name: "Ibrahim Musa Garba", subject_type: "individual", subject_bvn: "23123456789", case_type: "suspicious_transaction", status: "closed_no_action", risk_score: 45, pep_match: false, sanctions_match: false, adverse_media_match: false, transaction_amount: 12000000, transaction_currency: "NGN", transaction_ref: "TXN-2026-005678", source_of_funds: "Salary and business income", narrative: "Initial flag due to unusual cash deposits. Investigation revealed legitimate business income from agricultural produce trading. Case closed — no suspicious activity confirmed.", str_reference: null, closed_at: new Date("2026-02-28T16:00:00Z"), closure_notes: "Legitimate business income verified. Source of funds documented. No further action required.", assigned_to: "AML Analyst Bola Adeyemi" },
];

// ─── Watchlist Entries ────────────────────────────────────────────────────────
const WATCHLIST_ENTRIES = [
  { entity_id: "WL-OFAC-001", entity_type: "individual", primary_name: "Olawale Taiwo Ogundimu", aliases: ["O.T. Ogundimu", "Wale Ogundimu"], date_of_birth: "1982-12-03", nationality: "Nigerian", source: "ofac_sdn", category: "sanctions", risk_level: "critical", listing_date: new Date("2025-06-15"), reason: "Designated under OFAC SDN List for involvement in financial crimes and money laundering activities.", is_active: true },
  { entity_id: "WL-INTERPOL-001", entity_type: "individual", primary_name: "Chukwudi Emmanuel Okafor", aliases: ["C.E. Okafor", "Emmanuel Okafor"], date_of_birth: "1975-04-20", nationality: "Nigerian", source: "interpol", category: "fraud", risk_level: "high", listing_date: new Date("2025-09-01"), reason: "INTERPOL Red Notice for international fraud and cybercrime. Wanted by multiple jurisdictions.", is_active: true },
  { entity_id: "WL-UN-001", entity_type: "corporate", primary_name: "Apex Resources International Ltd", aliases: ["ARI Limited", "Apex Resources"], date_of_birth: null, nationality: "Nigerian", source: "un_consolidated", category: "sanctions", risk_level: "critical", listing_date: new Date("2025-11-20"), reason: "UN Security Council Resolution 2374 — linked to arms trafficking and terrorism financing.", is_active: true },
  { entity_id: "WL-NFIU-001", entity_type: "individual", primary_name: "Emeka Chukwuemeka Eze", aliases: ["E.C. Eze", "Emeka Eze"], date_of_birth: "1972-09-14", nationality: "Nigerian", source: "nfiu", category: "pep", risk_level: "high", listing_date: new Date("2024-03-10"), reason: "Politically Exposed Person — former state commissioner. Subject of ongoing EFCC investigation.", is_active: true },
  { entity_id: "WL-EFCC-001", entity_type: "individual", primary_name: "Babatunde Adewale Fashola-Obi", aliases: ["B.A. Fashola-Obi"], date_of_birth: "1968-07-12", nationality: "Nigerian", source: "efcc", category: "adverse_media", risk_level: "medium", listing_date: new Date("2026-01-05"), reason: "EFCC investigation for alleged procurement fraud. Not yet charged but under active investigation.", is_active: true },
  { entity_id: "WL-CBN-001", entity_type: "corporate", primary_name: "Sunrise Capital Partners Nigeria", aliases: ["Sunrise Capital", "SCPN"], date_of_birth: null, nationality: "Nigerian", source: "cbn_internal", category: "sanctions", risk_level: "high", listing_date: new Date("2025-08-22"), reason: "CBN directive — unlicensed financial institution operating without CBN approval. Cease and desist order issued.", is_active: true },
];

// ─── NIP Transactions ─────────────────────────────────────────────────────────
const NIP_TRANSACTIONS = [
  { session_id: "NIP2026040100001", sender_bank_code: "000001", sender_bank_name: "GTBank", sender_account_number: "0123456789", sender_account_name: "Adebayo Olusola Adeyemi", receiver_bank_code: "000002", receiver_bank_name: "Zenith Bank", receiver_account_number: "9876543210", receiver_account_name: "Chidinma Okonkwo-Nwosu", amount: 500000, currency: "NGN", narration: "School fees payment", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100001", channel_code: "MOB", aml_flagged: false, fraud_flagged: false },
  { session_id: "NIP2026040100002", sender_bank_code: "000003", sender_bank_name: "FirstBank", sender_account_number: "2345678901", sender_account_name: "Musa Ibrahim Abdullahi", receiver_bank_code: "000004", receiver_bank_name: "UBA", receiver_account_number: "8765432109", receiver_account_name: "Ngozi Amara Obi", amount: 2500000, currency: "NGN", narration: "Business payment — Invoice INV-2026-0042", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100002", channel_code: "INT", aml_flagged: false, fraud_flagged: false },
  { session_id: "NIP2026040100003", sender_bank_code: "000005", sender_bank_name: "Access Bank", sender_account_number: "3456789012", sender_account_name: "Emeka Chukwuemeka Eze", receiver_bank_code: "000001", receiver_bank_name: "GTBank", receiver_account_number: "7654321098", receiver_account_name: "Bright Star Trading Company", amount: 45000000, currency: "NGN", narration: "Consultancy fee", status: "pending_confirmation", response_code: null, nibss_ref: null, channel_code: "INT", aml_flagged: true, fraud_flagged: false },
  { session_id: "NIP2026040100004", sender_bank_code: "000002", sender_bank_name: "Zenith Bank", sender_account_number: "4567890123", sender_account_name: "Aisha Bello Usman", receiver_bank_code: "000006", receiver_bank_name: "Stanbic IBTC", receiver_account_number: "6543210987", receiver_account_name: "Fatima Zahra Al-Hassan", amount: 150000, currency: "NGN", narration: "Rent payment", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100004", channel_code: "MOB", aml_flagged: false, fraud_flagged: false },
  { session_id: "NIP2026040100005", sender_bank_code: "000011", sender_bank_name: "OPay", sender_account_number: "5678901234", sender_account_name: "Olawale Taiwo Ogundimu", receiver_bank_code: "000003", receiver_bank_name: "FirstBank", receiver_account_number: "5432109876", receiver_account_name: "Global Ventures Nigeria Ltd", amount: 9900000, currency: "NGN", narration: "Payment for goods", status: "failed", response_code: "51", response_message: "Insufficient funds", nibss_ref: null, channel_code: "MOB", aml_flagged: true, fraud_flagged: true },
  { session_id: "NIP2026040100006", sender_bank_code: "000004", sender_bank_name: "UBA", sender_account_number: "6789012345", sender_account_name: "Dangote Industries Limited", receiver_bank_code: "000005", receiver_bank_name: "Access Bank", receiver_account_number: "4321098765", receiver_account_name: "MTN Nigeria Communications Plc", amount: 500000000, currency: "NGN", narration: "Spectrum licence fee payment", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100006", channel_code: "INT", aml_flagged: false, fraud_flagged: false },
  { session_id: "NIP2026040100007", sender_bank_code: "000012", sender_bank_name: "Kuda", sender_account_number: "7890123456", sender_account_name: "Ibrahim Musa Garba", receiver_bank_code: "000007", receiver_bank_name: "FCMB", receiver_account_number: "3210987654", receiver_account_name: "Sunrise Capital Partners Nigeria", amount: 1200000, currency: "NGN", narration: "Investment deposit", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100007", channel_code: "MOB", aml_flagged: false, fraud_flagged: false },
  { session_id: "NIP2026040100008", sender_bank_code: "000008", sender_bank_name: "Fidelity Bank", sender_account_number: "8901234567", sender_account_name: "Fatima Zahra Al-Hassan", receiver_bank_code: "000009", receiver_bank_name: "Ecobank", receiver_account_number: "2109876543", receiver_account_name: "Chidinma Okonkwo-Nwosu", amount: 75000, currency: "NGN", narration: "Personal transfer", status: "completed", response_code: "00", nibss_ref: "NIBSS2026040100008", channel_code: "USSD", aml_flagged: false, fraud_flagged: false },
];

// ─── Compliance Policies ──────────────────────────────────────────────────────
const COMPLIANCE_POLICIES = [
  { name: "NDPA Data Minimisation Policy", framework: "NDPA", description: "Governs the collection and processing of personal data to ensure only data necessary for specified purposes is collected.", policy_text: "1. Only personal data that is adequate, relevant, and limited to what is necessary in relation to the purposes for which it is processed shall be collected. 2. Data controllers must document the legal basis for each data processing activity. 3. Periodic reviews of data holdings must be conducted every 6 months.", status: "active", version: "2.1", effective_date: new Date("2026-01-01") },
  { name: "CBN AML/CFT Compliance Policy", framework: "CBN_AML", description: "Anti-Money Laundering and Counter-Financing of Terrorism policy aligned with CBN AML/CFT Regulations 2022.", policy_text: "1. All customers must undergo Know Your Customer (KYC) verification before account opening. 2. Suspicious Transaction Reports (STRs) must be filed with NFIU within 24 hours of detection. 3. Currency Transaction Reports (CTRs) must be filed for cash transactions above NGN 5,000,000.", status: "active", version: "3.0", effective_date: new Date("2026-01-01") },
  { name: "Data Breach Response Policy", framework: "NDPA", description: "Procedures for detecting, reporting, and responding to personal data breaches in compliance with NDPA Section 40.", policy_text: "1. Data breaches must be reported to the NDPC within 72 hours of discovery. 2. Affected data subjects must be notified without undue delay if the breach poses a high risk. 3. A breach register must be maintained documenting all incidents, their effects, and remedial actions.", status: "active", version: "1.5", effective_date: new Date("2025-07-01") },
  { name: "Cross-Border Data Transfer Policy", framework: "NDPA", description: "Policy governing the transfer of personal data outside Nigeria in compliance with NDPA Chapter 4.", policy_text: "1. Personal data may only be transferred to countries with adequate data protection laws or with appropriate safeguards. 2. Standard Contractual Clauses (SCCs) approved by NDPC must be used for transfers to non-adequate countries. 3. Binding Corporate Rules (BCRs) may be used for intra-group transfers.", status: "active", version: "1.2", effective_date: new Date("2025-10-01") },
  { name: "Consent Management Policy", framework: "NDPA", description: "Policy for obtaining, recording, and managing data subject consent in compliance with NDPA Section 25.", policy_text: "1. Consent must be freely given, specific, informed, and unambiguous. 2. Consent records must be maintained for the duration of processing plus 5 years. 3. Data subjects must be able to withdraw consent at any time through accessible mechanisms.", status: "active", version: "2.0", effective_date: new Date("2026-01-01") },
  { name: "Data Retention and Disposal Policy", framework: "NDPA", description: "Policy governing the retention periods for different categories of personal data and secure disposal procedures.", policy_text: "1. Financial records: 7 years after last transaction. 2. Customer KYC records: 5 years after account closure. 3. Audit logs: 7 years. 4. Marketing data: Until consent withdrawn or 2 years of inactivity. 5. Secure disposal must use NIST 800-88 standards.", status: "active", version: "1.8", effective_date: new Date("2025-04-01") },
  { name: "Employee Data Privacy Policy", framework: "NDPA", description: "Policy governing the collection and processing of employee personal data.", policy_text: "1. Employee data collected must be limited to what is necessary for employment purposes. 2. Employees must be informed of data processing activities through a privacy notice. 3. Employee monitoring must be proportionate and disclosed in advance.", status: "active", version: "1.3", effective_date: new Date("2025-06-01") },
  { name: "Third-Party Data Processor Policy", framework: "NDPA", description: "Policy governing the engagement of third-party data processors and their compliance requirements.", policy_text: "1. Data Processing Agreements (DPAs) must be executed with all third-party processors. 2. Processors must be assessed for data protection compliance before engagement. 3. Annual audits of key processors must be conducted.", status: "active", version: "1.1", effective_date: new Date("2025-09-01") },
];

// ─── Main Seed Function ───────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Seeding NDSEP banking & compliance data...\n");

  // ── Banking Institutions ──────────────────────────────────────────────────
  console.log("📦 Seeding banking_institutions...");
  for (const bank of BANKS) {
    await q(`
      INSERT INTO banking_institutions (
        cbn_code, sort_code, bic_code, name, short_name, license_type, license_number,
        status, head_office_address, ceo_name, total_assets, capital_adequacy_ratio,
        non_performing_loan_ratio, data_protection_officer, compliance_score
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (cbn_code) DO UPDATE SET
        name = EXCLUDED.name, compliance_score = EXCLUDED.compliance_score,
        total_assets = EXCLUDED.total_assets, updated_at = NOW()
    `, [bank.cbn_code, bank.sort_code, bank.bic_code, bank.name, bank.short_name,
        bank.license_type, bank.license_number, bank.status, bank.head_office_address,
        bank.ceo_name, bank.total_assets, bank.capital_adequacy_ratio,
        bank.non_performing_loan_ratio, bank.data_protection_officer, bank.compliance_score]);
  }
  console.log(`  ✓ ${BANKS.length} banks seeded`);

  // Get first bank ID for FK references
  const { rows: bankRows } = await q("SELECT id FROM banking_institutions ORDER BY id LIMIT 3");
  const bankId1 = bankRows[0]?.id;
  const bankId2 = bankRows[1]?.id;
  const bankId3 = bankRows[2]?.id;

  // ── KYC Records ───────────────────────────────────────────────────────────
  console.log("📦 Seeding kyc_records...");
  for (const kyc of KYC_RECORDS) {
    await q(`
      INSERT INTO kyc_records (
        reference_id, bank_id, subject_type, full_name, date_of_birth, nationality,
        bvn, nin, phone_number, email, address, liveness_score, face_match_score,
        bvn_verified, nin_verified, address_verified, tier, status, risk_rating,
        pep_flag, sanctions_flag, id_document_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (reference_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
    `, [kyc.reference_id, bankId1, kyc.subject_type, kyc.full_name, kyc.date_of_birth,
        kyc.nationality, kyc.bvn, kyc.nin, kyc.phone_number, kyc.email, kyc.address,
        kyc.liveness_score, kyc.face_match_score, kyc.bvn_verified, kyc.nin_verified,
        kyc.address_verified, kyc.tier, kyc.status, kyc.risk_rating,
        kyc.pep_flag, kyc.sanctions_flag, kyc.id_document_type]);
  }
  console.log(`  ✓ ${KYC_RECORDS.length} KYC records seeded`);

  // ── Watchlist Entries ─────────────────────────────────────────────────────
  console.log("📦 Seeding watchlist_entries...");
  for (const entry of WATCHLIST_ENTRIES) {
    await q(`
      INSERT INTO watchlist_entries (
        entity_id, entity_type, primary_name, aliases, date_of_birth, nationality,
        source, category, risk_level, listing_date, reason, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (entity_id) DO UPDATE SET
        is_active = EXCLUDED.is_active, reason = EXCLUDED.reason, updated_at = NOW()
    `, [entry.entity_id, entry.entity_type, entry.primary_name,
        JSON.stringify(entry.aliases), entry.date_of_birth, entry.nationality,
        entry.source, entry.category, entry.risk_level, entry.listing_date,
        entry.reason, entry.is_active]);
  }
  console.log(`  ✓ ${WATCHLIST_ENTRIES.length} watchlist entries seeded`);

  // ── AML Cases ─────────────────────────────────────────────────────────────
  console.log("📦 Seeding aml_cases...");
  for (const aml of AML_CASES) {
    await q(`
      INSERT INTO aml_cases (
        case_ref, bank_id, subject_name, subject_type, subject_bvn, case_type,
        status, risk_score, pep_match, sanctions_match, adverse_media_match,
        transaction_amount, transaction_currency, transaction_ref, source_of_funds,
        narrative, str_reference, str_filed_at, assigned_to, closed_at, closure_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (case_ref) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
    `, [aml.case_ref, bankId2, aml.subject_name, aml.subject_type, aml.subject_bvn,
        aml.case_type, aml.status, aml.risk_score, aml.pep_match, aml.sanctions_match,
        aml.adverse_media_match, aml.transaction_amount, aml.transaction_currency,
        aml.transaction_ref, aml.source_of_funds, aml.narrative, aml.str_reference,
        aml.str_filed_at ?? null, aml.assigned_to, aml.closed_at ?? null, aml.closure_notes ?? null]);
  }
  console.log(`  ✓ ${AML_CASES.length} AML cases seeded`);

  // ── NIP Transactions ──────────────────────────────────────────────────────
  console.log("📦 Seeding nip_transactions...");
  for (const tx of NIP_TRANSACTIONS) {
    await q(`
      INSERT INTO nip_transactions (
        session_id, sender_bank_code, sender_bank_name, sender_account_number,
        sender_account_name, receiver_bank_code, receiver_bank_name,
        receiver_account_number, receiver_account_name, amount, currency,
        narration, status, response_code, response_message, nibss_ref,
        channel_code, aml_flagged, fraud_flagged
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (session_id) DO UPDATE SET status = EXCLUDED.status
    `, [tx.session_id, tx.sender_bank_code, tx.sender_bank_name, tx.sender_account_number,
        tx.sender_account_name, tx.receiver_bank_code, tx.receiver_bank_name,
        tx.receiver_account_number, tx.receiver_account_name, tx.amount, tx.currency,
        tx.narration, tx.status, tx.response_code, tx.response_message ?? null,
        tx.nibss_ref ?? null, tx.channel_code, tx.aml_flagged, tx.fraud_flagged]);
  }
  console.log(`  ✓ ${NIP_TRANSACTIONS.length} NIP transactions seeded`);

  // ── Compliance Policies ───────────────────────────────────────────────────
  console.log("📦 Seeding compliance_policies...");
  for (const policy of COMPLIANCE_POLICIES) {
    await q(`
      INSERT INTO compliance_policies (name, description, category, opa_rule, severity, is_active, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT DO NOTHING
    `, [policy.name, policy.description, policy.framework, policy.policy_text, 'high', true]);
  }
  console.log(`  ✓ ${COMPLIANCE_POLICIES.length} compliance policies seeded`);

  // ── Breach Incidents ──────────────────────────────────────────────────────
  console.log("📦 Seeding breach_incidents...");
  const { rows: orgRows } = await q("SELECT id FROM organizations ORDER BY id LIMIT 5");
  const orgId = orgRows[0]?.id ?? 1;

  const breaches = [
    { organization_id: orgId, title: "Unauthorized Access to Customer Database", description: "Attacker exploited SQL injection vulnerability to access customer PII including names, emails, and phone numbers of 15,000 customers.", data_types_affected: ["name", "email", "phone", "address"], affected_individuals_count: 15000, detected_at: new Date("2026-02-10T09:00:00Z"), breach_incident_status: "resolved", breach_incident_severity: "high", ndpc_notified_at: new Date("2026-02-11T14:00:00Z"), individuals_notified_at: new Date("2026-02-13T10:00:00Z"), remediation_actions: "Patched SQL injection vulnerability. Implemented WAF. Conducted security audit. Notified affected customers.", breach_cause: "SQL injection vulnerability in customer portal", ndpc_notification_deadline: new Date("2026-02-13T09:00:00Z") },
    { organization_id: orgRows[1]?.id ?? orgId, title: "Ransomware Attack on HR Systems", description: "Ransomware encrypted HR system containing employee personal data including salary information, NIN, and BVN for 450 employees.", data_types_affected: ["name", "nin", "bvn", "salary", "employment_details"], affected_individuals_count: 450, detected_at: new Date("2026-01-15T08:00:00Z"), breach_incident_status: "resolved", breach_incident_severity: "critical", ndpc_notified_at: new Date("2026-01-16T10:00:00Z"), individuals_notified_at: new Date("2026-01-18T09:00:00Z"), remediation_actions: "Restored from backup. Implemented endpoint detection and response. Conducted mandatory security training for all staff.", breach_cause: "Ransomware via phishing email attachment", ndpc_notification_deadline: new Date("2026-01-18T08:00:00Z") },
    { organization_id: orgRows[2]?.id ?? orgId, title: "Phishing Attack — Customer Credentials Compromised", description: "Sophisticated phishing campaign targeted customers via SMS. Approximately 2,300 customers clicked malicious links and entered credentials.", data_types_affected: ["username", "password", "account_number"], affected_individuals_count: 2300, detected_at: new Date("2026-03-01T11:00:00Z"), breach_incident_status: "ndpc_notified", breach_incident_severity: "high", ndpc_notified_at: new Date("2026-03-02T09:00:00Z"), individuals_notified_at: null, remediation_actions: "Forced password reset for affected accounts. Implemented MFA. Notifying affected customers.", breach_cause: "SMS phishing campaign targeting mobile banking customers", ndpc_notification_deadline: new Date("2026-03-04T11:00:00Z") },
  ];

  for (const breach of breaches) {
    await q(`
      INSERT INTO breach_incidents (
        organization_id, title, description, data_types_affected,
        affected_individuals_count, detected_at, breach_incident_status,
        breach_incident_severity, ndpc_notified_at, individuals_notified_at,
        remediation_actions, breach_cause, ndpc_notification_deadline
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [breach.organization_id, breach.title, breach.description,
        JSON.stringify(breach.data_types_affected), breach.affected_individuals_count,
        breach.detected_at, breach.breach_incident_status, breach.breach_incident_severity,
        breach.ndpc_notified_at, breach.individuals_notified_at,
        breach.remediation_actions, breach.breach_cause, breach.ndpc_notification_deadline]);
  }
  console.log(`  ✓ ${breaches.length} breach incidents seeded`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = await q(`
    SELECT
      (SELECT COUNT(*) FROM banking_institutions) as banks,
      (SELECT COUNT(*) FROM kyc_records) as kyc,
      (SELECT COUNT(*) FROM aml_cases) as aml,
      (SELECT COUNT(*) FROM watchlist_entries) as watchlist,
      (SELECT COUNT(*) FROM nip_transactions) as nip_tx,
      (SELECT COUNT(*) FROM compliance_policies) as policies,
      (SELECT COUNT(*) FROM breach_incidents) as breaches
  `);
  console.log("\n✅ Seed complete! Database counts:");
  console.table(counts.rows[0]);
}

seed()
  .then(() => { pool.end(); process.exit(0); })
  .catch(err => { console.error("❌ Seed failed:", err.message); pool.end(); process.exit(1); });
