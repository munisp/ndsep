/**
 * demoSeed.ts
 * Truncates all demo-owned data and re-seeds it atomically.
 * Called by GET /api/demo-reset
 *
 * Column names match the actual Drizzle schema in drizzle/schema.ts.
 */

import type { Pool } from "pg";
import { encryptField } from "./encryption";

const DEMO_DPCO_OPEN_ID = "demo-dpco-user-001";
const DEMO_ADMIN_OPEN_ID = "demo-admin-user-001";
const DEMO_DPCO_NAME = "DataGuard Ltd (Demo)";
const DEMO_ADMIN_NAME = "NDPC Admin (Demo)";
const DEMO_ORG_LICENCE = "NDPC-DPCO-2024-DGL-001";

export async function resetDemoData(pool: Pool): Promise<{ seeded: Record<string, number> }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 0. Ensure enum values exist ────────────────────────────────────────────
    for (const val of ['resolved', 'closed', 'overdue']) {
      await client.query(`DO $$ BEGIN ALTER TYPE citizen_request_status ADD VALUE IF NOT EXISTS '${val}'; EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    }
    for (const val of ['published', 'expired', 'revoked']) {
      await client.query(`DO $$ BEGIN ALTER TYPE privacy_notice_status ADD VALUE IF NOT EXISTS '${val}'; EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    }

    // ── 1. Upsert demo users ──────────────────────────────────────────────────
    await client.query(
      `INSERT INTO users (open_id, name, role, created_at, updated_at)
       VALUES ($1, $2, 'user', NOW(), NOW()), ($3, $4, 'admin', NOW(), NOW())
       ON CONFLICT (open_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [DEMO_DPCO_OPEN_ID, encryptField(DEMO_DPCO_NAME), DEMO_ADMIN_OPEN_ID, encryptField(DEMO_ADMIN_NAME)]
    );

    const { rows: [dpcoUser] } = await client.query(
      `SELECT id FROM users WHERE open_id = $1`, [DEMO_DPCO_OPEN_ID]
    );
    const userId: number = dpcoUser.id;

    // ── 2. Upsert DPCO organisation ───────────────────────────────────────────
    // Schema columns: id, name, licence_number, status, tier, email, phone,
    //   address, cac_number, tax_id, rc_number, dpo_name, dpo_email,
    //   services, sectors, website, logo_url, licence_expires_at,
    //   approved_at, approved_by, rejection_reason, metadata, created_at, updated_at
    const { rows: [org] } = await client.query(
      `INSERT INTO dpco_organisations
         (licence_number, name, email, phone, address, services, tier, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::text[], 'professional', 'active', NOW(), NOW())
       ON CONFLICT (licence_number) DO UPDATE
         SET name = EXCLUDED.name,
             tier = EXCLUDED.tier,
             updated_at = NOW()
       RETURNING id`,
      [
        DEMO_ORG_LICENCE,
        "DataGuard Ltd",
        "demo@dataguard.ng",
        "+234-801-000-0001",
        "14 Adeola Odeku Street, Victoria Island, Lagos",
        ["data_audit", "dpia", "training", "policy_review", "breach_response"],
      ]
    );
    const orgId: number = org.id;

    // ── 3. Clear existing demo data (owned by this org) ───────────────────────
    await client.query(`DELETE FROM platform_revenue_splits WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_payments WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_invoices WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_subscriptions WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_audit_engagements WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_training_sessions WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_policy_drafts WHERE dpco_org_id = $1`, [orgId]);
    await client.query(`DELETE FROM dpco_clients WHERE dpco_org_id = $1`, [orgId]);

    // ── 4. Seed clients ───────────────────────────────────────────────────────
    // Schema columns: id, dpco_org_id, org_name, org_sector, org_location,
    //   contact_name, contact_email, contact_phone, status, risk_level,
    //   compliance_score, onboarded_at, metadata, created_at, updated_at
    const clientRows = [
      ["Zenith Bank Plc",      "Financial Services",  "Lagos",    "high",   "active"],
      ["MTN Nigeria Comms",    "Telecommunications",  "Lagos",    "medium", "active"],
      ["NNPC Ltd",             "Energy & Utilities",  "Abuja",    "high",   "active"],
      ["Jumia Nigeria",        "E-Commerce",          "Lagos",    "medium", "active"],
      ["Access Bank Plc",      "Financial Services",  "Lagos",    "high",   "active"],
      ["Airtel Nigeria",       "Telecommunications",  "Lagos",    "medium", "active"],
      ["Dangote Industries",   "Manufacturing",       "Lagos",    "low",    "active"],
      ["Flutterwave Inc",      "Fintech",             "Lagos",    "high",   "active"],
      ["Lagos State Govt",     "Government",          "Lagos",    "medium", "active"],
    ];
    let clientCount = 0;
    for (const [name, sector, location, risk, status] of clientRows) {
      await client.query(
        `INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, risk_level, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [orgId, name, sector, location, risk, status]
      );
      clientCount++;
    }

    // ── 5. Seed audit engagements ─────────────────────────────────────────────
    // Schema columns: id, dpco_org_id, client_id, title, current_stage,
    //   compliance_score, lead_auditor, planned_start, planned_end,
    //   actual_start, actual_end, critical_findings, high_findings,
    //   medium_findings, low_findings, management_response, notes, metadata,
    //   created_at, updated_at
    const auditRows = [
      ["Annual NDPA Compliance Review 2025",   "fieldwork",        "2025-01-15", "2025-06-30", 72],
      ["Data Retention Policy Audit",          "fieldwork",        "2025-03-01", "2025-05-31", 45],
      ["Cross-Border Transfer Assessment",     "report_issued",    "2024-10-01", "2025-01-31", 100],
      ["DPIA for New Loyalty Programme",       "initiated",        "2025-04-01", "2025-07-31", 0],
      ["Breach Response Readiness Review",     "findings_review",  "2025-02-15", "2025-05-15", 60],
    ];
    let auditCount = 0;
    for (const [title, stage, start, end, score] of auditRows) {
      await client.query(
        `INSERT INTO dpco_audit_engagements (dpco_org_id, title, current_stage, compliance_score, planned_start, planned_end, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [orgId, title, stage, score, start, end]
      );
      auditCount++;
    }

    // ── 6. Seed training sessions ─────────────────────────────────────────────
    // Schema columns: id, dpco_org_id, client_id, title, description,
    //   training_type, status, scheduled_date, completed_date,
    //   participant_count, certificates_issued, ndpa_section,
    //   facilitator, venue, materials, metadata, created_at, updated_at
    const trainingRows: [string, string, string, number, string][] = [
      ["NDPA Fundamentals for DPOs",             "completed", "2025-02-10", 24, "Comprehensive overview of NDPA 2023 obligations"],
      ["Data Subject Rights Workshop",            "completed", "2025-03-15", 18, "Practical guide to handling DSR requests"],
      ["Breach Notification Procedures",          "scheduled", "2025-04-05", 12, "Step-by-step breach response and NDPC reporting"],
      ["Cross-Border Data Transfer Masterclass",  "scheduled", "2025-04-20", 30, "Adequacy decisions, SCCs, and BCRs under NDPA"],
      ["Privacy by Design in Product Teams",      "scheduled", "2025-05-10", 20, "Embedding privacy into SDLC and product roadmaps"],
      ["AI & Automated Decision-Making Risks",    "scheduled", "2025-06-01", 15, "NDPA obligations for AI systems and profiling"],
    ];
    let trainingCount = 0;
    for (const [title, status, date, attendees, description] of trainingRows) {
      await client.query(
        `INSERT INTO dpco_training_sessions (dpco_org_id, title, description, status, scheduled_date, participant_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [orgId, title, description, status, date, attendees]
      );
      trainingCount++;
    }

    // ── 7. Seed policy drafts ─────────────────────────────────────────────────
    const policyRows: [string, string, string][] = [
      ["Privacy Notice Template v3.2",           "approved",    "2025-01-20"],
      ["Data Retention & Disposal Policy",        "approved",    "2025-02-05"],
      ["Breach Response Playbook 2025",           "under_review","2025-03-10"],
      ["Cross-Border Transfer Standard Clauses",  "draft",       "2025-04-01"],
      ["Employee Data Processing Policy",         "approved",    "2024-11-15"],
      ["Cookie & Consent Management Policy",      "under_review","2025-03-25"],
    ];
    let policyCount = 0;
    for (const [title, status, date] of policyRows) {
      await client.query(
        `INSERT INTO dpco_policy_drafts (dpco_org_id, title, document_type, status, created_at, updated_at)
         VALUES ($1,$2,'policy',$3,NOW(),NOW())`,
        [orgId, title, status]
      );
      policyCount++;
    }

    // ── 8. Seed subscription ──────────────────────────────────────────────────
    // Schema columns: id, dpco_org_id, tier, status, monthly_fee, currency,
    //   max_clients, max_audits_per_month, platform_fee_rate, trial_ends_at,
    //   current_period_start, current_period_end, cancelled_at, features,
    //   metadata, created_at, updated_at
    await client.query(
      `INSERT INTO dpco_subscriptions
         (dpco_org_id, tier, status, monthly_fee, platform_fee_rate,
          current_period_start, current_period_end, created_at, updated_at)
       VALUES ($1,'professional','active',450000.00,0.1000,NOW(),NOW() + INTERVAL '30 days',NOW(),NOW())
       ON CONFLICT (dpco_org_id) DO UPDATE
         SET tier = EXCLUDED.tier, status = EXCLUDED.status, updated_at = NOW()`,
      [orgId]
    );

    // ── 9. Seed 6 months of invoices + payments ───────────────────────────────
    // Schema columns for dpco_invoices: id, dpco_org_id, invoice_number,
    //   dpco_subscription_id, billing_period_start, billing_period_end,
    //   subtotal, vat_amount, total_amount, platform_fee_rate,
    //   platform_fee_amount, dpco_net_amount, currency, status,
    //   issue_date, due_date, paid_at, notes, line_items, metadata,
    //   created_at, updated_at
    const months: Array<{ label: string; due: string; gross: number; fee: number; net: number; status: string; svc: string }> = [
      { label: "Oct 2024", due: "2024-10-31", gross: 1200000, fee: 120000, net: 1080000, status: "paid",  svc: "audit" },
      { label: "Nov 2024", due: "2024-11-30", gross: 850000,  fee: 85000,  net: 765000,  status: "paid",  svc: "dpia" },
      { label: "Dec 2024", due: "2024-12-31", gross: 2100000, fee: 210000, net: 1890000, status: "paid",  svc: "training" },
      { label: "Jan 2025", due: "2025-01-31", gross: 950000,  fee: 95000,  net: 855000,  status: "paid",  svc: "advisory" },
      { label: "Feb 2025", due: "2025-02-28", gross: 1750000, fee: 175000, net: 1575000, status: "paid",  svc: "audit" },
      { label: "Mar 2025", due: "2025-03-31", gross: 1100000, fee: 110000, net: 990000,  status: "sent",  svc: "gap_assessment" },
      { label: "Apr 2025", due: "2025-04-30", gross: 1400000, fee: 140000, net: 1260000, status: "sent",  svc: "dpia" },
      { label: "May 2025", due: "2025-05-31", gross: 600000,  fee: 60000,  net: 540000,  status: "draft", svc: "training" },
    ];

    let invoiceCount = 0;
    let paymentCount = 0;
    let splitCount = 0;

    for (const m of months) {
      const invNum = `INV-DGL-${m.due.replace(/-/g, "").slice(0, 6)}-001`;
      const { rows: [inv] } = await client.query(
        `INSERT INTO dpco_invoices
           (dpco_org_id, invoice_number, client_name, service_type, description,
            subtotal, vat_amount, total_amount,
            platform_fee_rate, platform_fee_amount, dpco_net_amount,
            currency, status, issue_date, due_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,'NGN',$11,NOW(),$12,NOW(),NOW())
         RETURNING id`,
        [orgId, invNum, "DataGuard Ltd Portfolio", m.svc,
         `${m.label} professional services — ${m.svc}`,
         m.gross, m.gross, 0.1000, m.fee, m.net, m.status, m.due]
      );
      invoiceCount++;

      if (m.status === "paid") {
        const { rows: [pay] } = await client.query(
          `INSERT INTO dpco_payments
             (invoice_id, dpco_org_id, payment_reference, amount, platform_fee_amount,
              dpco_net_amount, payment_method, paid_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'bank_transfer',NOW(),NOW())
           RETURNING id`,
          [inv.id, orgId, `TXN-${invNum}`, m.gross, m.fee, m.net]
        );
        paymentCount++;

        await client.query(
          `INSERT INTO platform_revenue_splits
             (payment_id, invoice_id, dpco_org_id, total_amount, platform_share,
              dpco_share, platform_fee_rate, split_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
          [pay.id, inv.id, orgId, m.gross, m.fee, m.net, 0.1000]
        );
        splitCount++;

        await client.query(
          `UPDATE dpco_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [inv.id]
        );
      }
    }

    // ── 10. Banking Seed Data ─────────────────────────────────────────────────
    // 10a. Clear existing banking data (order matters for FK constraints)
    await client.query(`DELETE FROM nip_transactions`);
    await client.query(`DELETE FROM cbn_reports`);
    await client.query(`DELETE FROM fraud_alerts`);
    await client.query(`DELETE FROM aml_cases`);
    await client.query(`DELETE FROM swift_messages`);
    await client.query(`DELETE FROM kyc_records`);
    await client.query(`DELETE FROM watchlist_entries`);
    await client.query(`DELETE FROM correspondent_banks`);
    await client.query(`DELETE FROM banking_institutions`);

    // 10b. Banking Institutions
    // Schema: id, cbn_code, sort_code, bic_code, name, short_name, license_type(enum), license_number, status(enum),
    //   head_office_address, ceo_name, total_assets, capital_adequacy_ratio, non_performing_loan_ratio,
    //   data_protection_officer, dpco_org_id, last_examination_date, next_examination_date, compliance_score, created_at, updated_at
    const bankInstitutions: Array<[string, string, string, string, string, string, string, string, number, number]> = [
      ["Zenith Bank Plc",    "RC000018", "044", "ZEIBNGLA", "Zenith",    "commercial",           "LIC-ZEN-001", "Lagos", 12500000000000, 19.2],
      ["GTBank Plc",         "RC000014", "058", "GTBINGLA", "GTBank",    "commercial",           "LIC-GTB-001", "Lagos",  9800000000000, 18.5],
      ["Access Bank Plc",    "RC000125", "033", "ABNGNGLA", "Access",    "commercial",           "LIC-ACC-001", "Lagos", 15200000000000, 17.8],
      ["OPay Digital Svcs",  "RC000006", "100", "OPAYNG00", "OPay",      "payment_service_bank", "LIC-OPY-001", "Lagos",  2500000000000, 16.4],
      ["Kuda Microfinance",  "RC000004", "090", "KUDANGLA", "Kuda",      "microfinance",         "LIC-KUD-001", "Lagos",   500000000000, 17.1],
      ["First Bank Nigeria", "RC000010", "011", "FBNINGLA", "FirstBank", "commercial",           "LIC-FBN-001", "Lagos", 11000000000000, 16.9],
    ];
    const bankIds: number[] = [];
    for (const [name, cbn_code, sort_code, bic_code, short_name, license_type, license_number, hq, assets, car] of bankInstitutions) {
      const { rows: [b] } = await client.query(
        `INSERT INTO banking_institutions
           (name, cbn_code, sort_code, bic_code, short_name, license_type,
            license_number, status, head_office_address, total_assets,
            capital_adequacy_ratio, last_examination_date, next_examination_date,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'licensed',$8,$9,$10,NOW(),NOW() + INTERVAL '1 year',NOW(),NOW())
         ON CONFLICT (cbn_code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [name, cbn_code, sort_code, bic_code, short_name, license_type, license_number, hq, assets, car]
      );
      bankIds.push(b.id);
    }

    // 10c. KYC Records — diverse statuses, risk ratings, and customer types
    // Schema: id, reference_id, organization_id, bank_id, subject_type, full_name,
    //   date_of_birth, nationality, bvn, nin, phone_number, email, address,
    //   selfie_url, id_document_type, id_document_url, liveness_score, face_match_score,
    //   bvn_verified, nin_verified, address_verified, tier(enum), status(enum), risk_level,
    //   created_at, updated_at
    let kycCount = 0;
    const kycRecords: Array<[number, string, string, string, string, string, boolean, boolean]> = [
      [0, 'CUS-001', 'individual', 'Adaeze Okonkwo',     'tier2', 'verified',  true,  true],
      [0, 'CUS-002', 'individual', 'Emeka Nwosu',        'tier1', 'pending',   false, false],
      [0, 'CUS-003', 'individual', 'Fatima Al-Hassan',   'tier3', 'verified',  true,  true],
      [1, 'CUS-004', 'individual', 'Apex Trading Ltd',   'tier3', 'verified',  true,  true],
      [1, 'CUS-005', 'individual', 'NovaTech Systems',   'tier2', 'verified',  true,  true],
      [1, 'CUS-006', 'individual', 'Chukwuemeka Eze',    'tier2', 'pending',   true,  false],
      [2, 'CUS-007', 'individual', 'Ngozi Adeyemi',      'tier1', 'verified',  true,  true],
      [2, 'CUS-008', 'individual', 'Babatunde Olatunji', 'tier2', 'in_review', true,  true],
      [2, 'CUS-009', 'individual', 'Pinnacle Holdings',  'tier3', 'verified',  true,  true],
    ];
    for (const [bidx, ref, stype, fname, tier, kstatus, bvn_v, nin_v] of kycRecords) {
      const bankId = bankIds[bidx];
      await client.query(
        `INSERT INTO kyc_records
           (bank_id, reference_id, subject_type, full_name,
            bvn, nin, tier, status, bvn_verified, nin_verified,
            nationality, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Nigerian',NOW(),NOW())`,
        [bankId, ref, stype, fname,
         `220${bankId}00${kycCount}`, `${bankId}0${kycCount}000`,
         tier, kstatus, bvn_v, nin_v]
      );
      kycCount++;
    }

    // 10d. AML Cases — 6 cases with diverse statuses
    // Schema: id, case_ref, organization_id, bank_id, subject_name, subject_type, subject_bvn,
    //   case_type(enum), status(enum), risk_score, pep_match, sanctions_match, adverse_media_match,
    //   transaction_amount, transaction_currency, transaction_ref, source_of_funds, narrative,
    //   str_reference, str_filed_at, assigned_to, escalated_to, closed_at, created_at, updated_at
    let amlCount = 0;
    const amlCases: Array<[number, string, string, string, number, string, number, boolean, boolean]> = [
      [0, 'AML-2025-001', 'suspicious_transaction', 'Ibrahim Musa',       85, 'under_investigation', 15000000, true,  false],
      [0, 'AML-2025-002', 'structuring',            'Amina Bello',        72, 'filed_str',           8500000,  false, true],
      [1, 'AML-2025-003', 'unusual_pattern',         'Chidi Okafor',       62, 'open',                3200000,  false, false],
      [1, 'AML-2025-004', 'sanctions_match',         'Yusuf Abdullahi',    92, 'under_investigation', 25000000, true,  true],
      [2, 'AML-2025-005', 'suspicious_transaction',  'Blessing Eze',       45, 'closed_no_action',    1800000,  false, false],
      [2, 'AML-2025-006', 'threshold_breach',        'Tunde Fashola Corp', 79, 'filed_str',           42000000, false, false],
    ];
    for (const [bidx, ref, ctype, subject, score, status, amount, pep_match, sanctions_match] of amlCases) {
      const bankId = bankIds[bidx];
      await client.query(
        `INSERT INTO aml_cases
           (bank_id, case_ref, case_type, subject_name, risk_score,
            status, transaction_amount, transaction_currency,
            pep_match, sanctions_match, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'NGN',$8,$9,NOW(),NOW())`,
        [bankId, ref, ctype, subject, score, status, amount, pep_match, sanctions_match]
      );
      amlCount++;
    }

    // 10e. Watchlist entries — 8 entries with diverse source/category enums
    // Schema: id, entity_id, entity_type, primary_name, aliases, date_of_birth, nationality,
    //   passport_number, source(enum), category(enum), risk_level, listing_date, delisting_date,
    //   is_active, reason, additional_info, created_at, updated_at
    const watchlistEntries: Array<[string, string, string, string, string, string, string, boolean]> = [
      ['WL-001', 'ofac_sdn',       'sanctions',       'individual', 'Abubakar Shekau',       'Nigerian', 'Terrorism financing',        true],
      ['WL-002', 'un_consolidated', 'sanctions',       'individual', 'Viktor Petrov',         'Russian',  'Sanctions violation',        true],
      ['WL-003', 'nfiu',           'pep',             'individual', 'Alhaji Musa Tanko',     'Nigerian', 'Politically Exposed Person', true],
      ['WL-004', 'ofac_sdn',       'money_laundering','entity',     'Crescent Trading LLC',  'UAE',      'Money laundering network',   true],
      ['WL-005', 'eu_consolidated', 'sanctions',       'individual', 'Dmitri Volkov',         'Russian',  'Financial sanctions',        true],
      ['WL-006', 'un_consolidated', 'terrorism',       'entity',     'Al-Nusra Front',        'Syrian',   'Terrorist organization',     true],
      ['WL-007', 'nfiu',           'pep',             'individual', 'Senator Adewale Bello', 'Nigerian', 'Politically Exposed Person', true],
      ['WL-008', 'uk_hmt',         'sanctions',       'individual', 'Nikolai Sorokin',       'Russian',  'Sanctions violation',        false],
    ];
    for (const [eid, source, category, etype, pname, nat, reason, active] of watchlistEntries) {
      await client.query(
        `INSERT INTO watchlist_entries
           (entity_id, source, category, entity_type, primary_name,
            nationality, reason, listing_date, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'2023-01-01',$8,NOW(),NOW())`,
        [eid, source, category, etype, pname, nat, reason, active]
      );
    }

    // 10f. SWIFT Messages
    // Schema: id, message_ref, message_type, sender_bic, sender_bank_name, receiver_bic, receiver_bank_name,
    //   amount, currency, value_date, ordering_customer, beneficiary_customer, remittance_info,
    //   correspondent_bic, status(enum), ack_nak_code, sanctions_screened, sanctions_flagged,
    //   raw_message, sent_at, processed_at, created_at, updated_at
    let swiftCount = 0;
    for (const bankId of bankIds.slice(0, 2)) {
      await client.query(
        `INSERT INTO swift_messages
           (message_ref, message_type, sender_bic, sender_bank_name,
            receiver_bic, receiver_bank_name, amount, currency, value_date,
            ordering_customer, beneficiary_customer,
            status, sanctions_screened, sent_at, created_at, updated_at)
         VALUES ($1,'MT103','ZEIBNGLA','Zenith Bank','DEUTDEFF','Deutsche Bank',
                 1000000,'USD',to_char(NOW(),'YYYY-MM-DD'),'DataGuard Ltd','Test Beneficiary',
                 'acknowledged',true,NOW(),NOW(),NOW())`,
        [`REF-${bankId}-${Date.now()}`]
      );
      swiftCount++;
    }

    // 10f-2. NIP Transactions — 10 transactions with diverse statuses and flags
    // Schema: id, session_id(NOT NULL), name_enquiry_ref, sender_bank_code(NOT NULL), sender_bank_name,
    //   sender_account_number(NOT NULL), sender_account_name, receiver_bank_code(NOT NULL), receiver_bank_name,
    //   receiver_account_number(NOT NULL), receiver_account_name, amount(NOT NULL), currency, narration,
    //   status(enum), response_code, response_message, nibss_ref, channel_code,
    //   aml_flagged, fraud_flagged, settlement_date, initiated_at
    let nipCount = 0;
    const nipTxns: Array<[string, string, string, string, string, number, string, string, string, boolean, boolean]> = [
      ['SES-001-NIBSS', '044', '0012345678', '058', '0098765432', 500000,   'School fees payment',       'completed',  'MOB', false, false],
      ['SES-002-NIBSS', '044', '0023456789', '011', '0087654321', 2500000,  'Business payment',          'completed',  'INT', false, false],
      ['SES-003-NIBSS', '044', '0034567890', '033', '0076543210', 15000000, 'Suspicious bulk transfer',  'initiated',  'USS', true,  false],
      ['SES-004-NIBSS', '058', '0045678901', '044', '0065432109', 750000,   'Rent payment',              'completed',  'MOB', false, false],
      ['SES-005-NIBSS', '058', '0056789012', '033', '0054321098', 8500000,  'Investment transfer',       'completed',  'INT', false, false],
      ['SES-006-NIBSS', '058', '0067890123', '011', '0043210987', 3200000,  'Possible fraud attempt',    'initiated',  'POS', false, true],
      ['SES-007-NIBSS', '033', '0078901234', '058', '0032109876', 1200000,  'Salary advance',            'completed',  'MOB', false, false],
      ['SES-008-NIBSS', '033', '0089012345', '044', '0021098765', 25000000, 'High-value AML flagged',    'initiated',  'INT', true,  false],
      ['SES-009-NIBSS', '100', '0090123456', '058', '0010987654', 450000,   'E-commerce payment',        'completed',  'MOB', false, false],
      ['SES-010-NIBSS', '100', '0001234567', '033', '0009876543', 180000,   'Utility bill payment',      'completed',  'USS', false, false],
    ];
    for (const [sid, scode, sacc, rcode, racc, amount, narr, status, channel, aml_f, fraud_f] of nipTxns) {
      await client.query(
        `INSERT INTO nip_transactions
           (session_id, sender_bank_code, sender_account_number,
            receiver_bank_code, receiver_account_number,
            amount, narration, status, channel_code,
            aml_flagged, fraud_flagged, initiated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [sid, scode, sacc, rcode, racc, amount, narr, status, channel, aml_f, fraud_f]
      );
      nipCount++;
    }

    // 10g. Fraud Alerts
    // Schema: id, alert_ref, bank_id, organization_id, transaction_ref, transaction_amount,
    //   account_number, alert_type(enum), risk_score, ml_model, ml_confidence,
    //   rule_triggered, status(enum), disposition, investigator_notes, assigned_to,
    //   blocked_at, resolved_at, detected_at, created_at, updated_at
    let fraudCount = 0;
    for (const bankId of bankIds.slice(0, 3)) {
      await client.query(
        `INSERT INTO fraud_alerts
           (bank_id, alert_ref, alert_type, transaction_amount,
            risk_score, ml_model, ml_confidence, status,
            detected_at, created_at, updated_at)
         VALUES ($1,$2,'velocity_breach',250000,
                 85,'fraud-ml-v2',0.92,'investigating',
                 NOW(),NOW(),NOW())`,
        [bankId, `FRD-${bankId}-${Date.now()}`]
      );
      fraudCount++;
    }

    // 10h. CBN Reports
    // Schema: id, report_ref, bank_id, organization_id, report_type(enum), reporting_period,
    //   status(enum), filing_deadline, submitted_at, acknowledged_at, cbn_ack_ref,
    //   xml_payload, pdf_url, total_transactions, total_amount, rejection_reason,
    //   prepared_by, approved_by, created_at, updated_at
    let cbnCount = 0;
    for (const bankId of bankIds.slice(0, 2)) {
      await client.query(
        `INSERT INTO cbn_reports
           (bank_id, report_ref, report_type, reporting_period,
            status, filing_deadline, submitted_at,
            total_transactions, total_amount, prepared_by,
            created_at, updated_at)
         VALUES ($1,$2,'str','Q1-2025',
                 'submitted','2025-04-15','2025-04-10',
                 15420,8500000000,'Compliance Officer',
                 NOW(),NOW())`,
        [bankId, `CBN-${bankId}-Q1-2025`]
      );
      cbnCount++;
    }

    // 10i. Correspondent Banks
    // Schema: id, bank_id, correspondent_name, correspondent_bic, country, currency,
    //   relationship_type(enum), nostro_account, vostro_account, status(enum),
    //   daily_limit, monthly_limit, kyc_completed, aml_risk_rating,
    //   last_review_date, next_review_date, agreement_url, notes, created_at, updated_at
    let corrCount = 0;
    for (const bankId of bankIds.slice(0, 2)) {
      await client.query(
        `INSERT INTO correspondent_banks
           (bank_id, correspondent_name, correspondent_bic, country, currency,
            relationship_type, nostro_account, status, daily_limit, monthly_limit,
            kyc_completed, aml_risk_rating, last_review_date, next_review_date,
            created_at, updated_at)
         VALUES ($1,$2,$3,'Germany','EUR',
                 'nostro','DE89370400440532013000','active',
                 50000000,500000000,true,'low',
                 '2024-12-01','2025-12-01',NOW(),NOW())`,
        [bankId, corrCount === 0 ? 'Deutsche Bank AG' : 'Citibank NA', corrCount === 0 ? 'DEUTDEFF' : 'CITIUS33']
      );
      corrCount++;
    }

    await client.query("COMMIT");

    return {
      seeded: {
        clients: clientCount,
        auditEngagements: auditCount,
        audits: auditCount,
        trainingSessions: trainingCount,
        training: trainingCount,
        policyDrafts: policyCount,
        policies: policyCount,
        invoices: invoiceCount,
        payments: paymentCount,
        revenueSplits: splitCount,
        splits: splitCount,
        banks: bankIds.length,
        kyc: kycCount,
        aml: amlCount,
        swift: swiftCount,
        fraud: fraudCount,
        cbn: cbnCount,
        correspondents: corrCount,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
