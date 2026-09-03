#!/usr/bin/env node
/**
 * NDSEP Comprehensive Seed Script
 * Seeds the maintained synthetic scenario set, then verifies every deployed public table has data.
 * 
 * Usage (synthetic, non-production databases only):
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY \
 *     DATABASE_URL=postgresql://.../ndsep_synthetic node scripts/seed-comprehensive.mjs
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY \
 *     DATABASE_URL=postgresql://.../ndsep_synthetic FORCE_SEED=1 node scripts/seed-comprehensive.mjs
 *
 * Non-loopback database targets additionally require the same explicit
 * SYNTHETIC_SEED_ALLOW_REMOTE confirmation. Production-labelled database
 * names and NODE_ENV=production are always refused.
 * 
 * This script:
 *   1. Runs the core seed (organizations, assets, compliance, etc.)
 *   2. Creates banking tables if they don't exist
 *   3. Seeds banking module (institutions, KYC, AML, watchlist, payments, etc.)
 *   4. Performs an authoritative public-table coverage check
 *   5. Exits nonzero and lists every remaining empty table
 * 
 * Environment variables:
 *   DATABASE_URL or POSTGRES_URL — explicitly supplied PostgreSQL connection string
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY — required for every run
 *   SYNTHETIC_SEED_ALLOW_REMOTE=NDSEP_SYNTHETIC_DATA_ONLY — additionally required for non-loopback targets
 *   FORCE_SEED=1 — permits re-seeding an explicitly confirmed synthetic target
 */
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  getSyntheticSeedPoolOptions,
  inspectPublicTableCoverage,
  requireCompleteSyntheticSeed,
  summarizePublicTableCoverage,
} from "./lib/synthetic-seed-safety.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;
const FORCE = process.env.FORCE_SEED === "1";

async function seedAll() {
  const pool = new Pool(getSyntheticSeedPoolOptions(process.env));
  const client = await pool.connect();
  try {
    console.log("=== NDSEP Comprehensive Seed Script ===\n");
    
    // Check if we should skip
    if (!FORCE) {
      try {
        const { rows } = await client.query("SELECT COUNT(*) as c FROM organizations");
        if (parseInt(rows[0].c) > 0) {
          console.log("Database already has core data. Checking for gaps...\n");
        }
      } catch {
        console.log("Core tables may not exist yet. Will create them.\n");
      }
    }

    // =====================================================================
    // STEP 1: Read and execute the comprehensive SQL seed file
    // =====================================================================
    const sqlPath = join(__dir, "seed-all.sql");
    if (existsSync(sqlPath)) {
      console.log("Step 1: Executing seed-all.sql (banking + missing tables)...");
      const sql = readFileSync(sqlPath, "utf8");
      
      // Split on semicolons but handle dollar-quoted blocks (DO $$ ... $$;)
      const statements = [];
      let current = "";
      let inDollarQuote = false;
      
      for (const line of sql.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("--")) continue; // skip comments
        
        if (trimmed.includes("$$")) {
          const count = (trimmed.match(/\$\$/g) || []).length;
          if (count % 2 === 1) inDollarQuote = !inDollarQuote;
        }
        
        current += line + "\n";
        
        if (!inDollarQuote && trimmed.endsWith(";")) {
          const stmt = current.trim();
          if (stmt && stmt !== ";") statements.push(stmt);
          current = "";
        }
      }
      
      let executed = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt);
          executed++;
        } catch (err) {
          // Log but continue — some statements may fail if tables already exist with different schema
          if (!err.message.includes("already exists") && !err.message.includes("duplicate key")) {
            console.warn(`  Warning: ${err.message.slice(0, 100)}`);
          }
        }
      }
      console.log(`  Executed ${executed} SQL statements\n`);
    } else {
      console.log("Step 1: seed-all.sql not found, creating banking tables inline...\n");
      await createBankingTablesInline(client);
    }

    // =====================================================================
    // STEP 2: Verify all currently deployed public tables have data.
    // A successful process result is forbidden if any table remains empty.
    // =====================================================================
    console.log("Step 2: Verifying all public tables...");
    const coverage = await inspectPublicTableCoverage(client);
    const coverageSummary = summarizePublicTableCoverage(coverage);
    console.log("\n=== Seed Verification ===");
    console.log(`Total tables: ${coverageSummary.totalTables}`);
    console.log(`Populated tables: ${coverageSummary.populatedTables}`);
    console.log(`Total rows: ${coverageSummary.totalRows}`);
    if (coverageSummary.emptyTables.length > 0) {
      console.log(`\nEmpty tables (${coverageSummary.emptyTables.length}):`);
      for (const table of coverageSummary.emptyTables) console.log(`  - ${table}`);
    }
    requireCompleteSyntheticSeed(coverageSummary);
    console.log(`\nAll ${coverageSummary.totalTables} public tables have synthetic data.`);

    // =====================================================================
    // STEP 3: Print banking stats
    // =====================================================================
    try {
      const { rows: bankStats } = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM banking_institutions) as institutions,
          (SELECT COUNT(*) FROM kyc_records) as kyc_records,
          (SELECT COUNT(*) FROM aml_cases) as aml_cases,
          (SELECT COUNT(*) FROM watchlist_entries) as watchlist_entries,
          (SELECT COUNT(*) FROM nip_transactions) as nip_transactions,
          (SELECT COUNT(*) FROM rtgs_transactions) as rtgs_transactions,
          (SELECT COUNT(*) FROM swift_messages) as swift_messages,
          (SELECT COUNT(*) FROM fraud_alerts) as fraud_alerts,
          (SELECT COUNT(*) FROM cbn_reports) as cbn_reports,
          (SELECT COUNT(*) FROM correspondent_banks) as correspondent_banks
      `);
      console.log("\n=== Banking Module ===");
      console.table(bankStats[0]);
    } catch {
      console.log("\nBanking tables not yet available.");
    }
    
    console.log("\n=== Seeding Complete ===");
    
  } finally {
    client.release();
    await pool.end();
  }
}

async function createBankingTablesInline(client) {
  // Fallback: create banking tables if seed-all.sql is missing
  const bankingDDL = `
    CREATE TABLE IF NOT EXISTS banking_institutions (
      id SERIAL PRIMARY KEY, cbn_code VARCHAR(20) UNIQUE, sort_code VARCHAR(20),
      bic_code VARCHAR(20), name VARCHAR(255) NOT NULL, short_name VARCHAR(100),
      license_type VARCHAR(50) DEFAULT 'commercial', license_number VARCHAR(50),
      status VARCHAR(50) DEFAULT 'licensed', head_office_address TEXT,
      ceo_name VARCHAR(255), total_assets NUMERIC(20,2),
      capital_adequacy_ratio NUMERIC(6,2), non_performing_loan_ratio NUMERIC(6,2),
      data_protection_officer VARCHAR(255), dpco_org_id INTEGER,
      compliance_score NUMERIC(6,2) DEFAULT 75.0,
      last_examination_date DATE, next_examination_date DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS kyc_records (
      id SERIAL PRIMARY KEY, reference_id VARCHAR(50) UNIQUE,
      bank_id INTEGER REFERENCES banking_institutions(id),
      subject_type VARCHAR(30) DEFAULT 'individual', full_name VARCHAR(255) NOT NULL,
      date_of_birth DATE, nationality VARCHAR(100) DEFAULT 'Nigerian',
      bvn VARCHAR(20), nin VARCHAR(20), address TEXT, phone VARCHAR(30),
      email VARCHAR(255), risk_level VARCHAR(20) DEFAULT 'low',
      status VARCHAR(30) DEFAULT 'pending', customer_ref VARCHAR(50),
      tier VARCHAR(10) DEFAULT 'tier1', pep_flag BOOLEAN DEFAULT false,
      sanctions_flag BOOLEAN DEFAULT false, bvn_verified BOOLEAN DEFAULT false,
      nin_verified BOOLEAN DEFAULT false, address_verified BOOLEAN DEFAULT false,
      face_match_score NUMERIC(5,2), liveness_score NUMERIC(5,2),
      phone_number VARCHAR(30), verified_at TIMESTAMPTZ, rejection_reason TEXT,
      reviewed_at TIMESTAMPTZ, reviewed_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS aml_cases (
      id SERIAL PRIMARY KEY, case_ref VARCHAR(50) UNIQUE,
      bank_id INTEGER REFERENCES banking_institutions(id),
      subject_name VARCHAR(255), subject_type VARCHAR(50) DEFAULT 'individual',
      subject_bvn VARCHAR(20), case_type VARCHAR(50) DEFAULT 'suspicious_transaction',
      status VARCHAR(30) DEFAULT 'open', risk_score INTEGER DEFAULT 50,
      pep_match BOOLEAN DEFAULT false, sanctions_match BOOLEAN DEFAULT false,
      narrative TEXT, amount NUMERIC(20,2), currency VARCHAR(10) DEFAULT 'NGN',
      assigned_to VARCHAR(255), resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS watchlist_entries (
      id SERIAL PRIMARY KEY, entity_id VARCHAR(50) UNIQUE,
      entity_type VARCHAR(30) DEFAULT 'individual', primary_name VARCHAR(255) NOT NULL,
      aliases TEXT, date_of_birth DATE, nationality VARCHAR(100),
      source VARCHAR(100) DEFAULT 'NFIU', list_type VARCHAR(50) DEFAULT 'sanctions',
      reason TEXT, is_active BOOLEAN DEFAULT true, added_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS nip_transactions (
      id SERIAL PRIMARY KEY, session_id VARCHAR(50) UNIQUE,
      sender_bank_code VARCHAR(20), sender_bank_name VARCHAR(255),
      sender_account_number VARCHAR(20), sender_account_name VARCHAR(255),
      receiver_bank_code VARCHAR(20), receiver_bank_name VARCHAR(255),
      receiver_account_number VARCHAR(20), receiver_account_name VARCHAR(255),
      amount NUMERIC(20,2), narration TEXT, status VARCHAR(30) DEFAULT 'pending',
      channel VARCHAR(30) DEFAULT 'web', response_code VARCHAR(10),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rtgs_transactions (
      id SERIAL PRIMARY KEY, reference VARCHAR(50) UNIQUE,
      sender_bank_code VARCHAR(20), sender_account_number VARCHAR(20),
      receiver_bank_code VARCHAR(20), receiver_account_number VARCHAR(20),
      amount NUMERIC(20,2), currency VARCHAR(10) DEFAULT 'NGN',
      status VARCHAR(30) DEFAULT 'pending', settlement_date DATE,
      narration TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS swift_messages (
      id SERIAL PRIMARY KEY, message_ref VARCHAR(50) UNIQUE,
      message_type VARCHAR(10) DEFAULT 'MT103', sender_bic VARCHAR(20),
      receiver_bic VARCHAR(20), amount NUMERIC(20,2), currency VARCHAR(10) DEFAULT 'USD',
      beneficiary_name VARCHAR(255), beneficiary_account VARCHAR(50),
      ordering_customer VARCHAR(255), status VARCHAR(30) DEFAULT 'pending',
      narrative TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fraud_alerts (
      id SERIAL PRIMARY KEY, alert_ref VARCHAR(50) UNIQUE,
      bank_id INTEGER REFERENCES banking_institutions(id),
      transaction_ref VARCHAR(50), transaction_amount NUMERIC(20,2),
      account_number VARCHAR(20), alert_type VARCHAR(50) DEFAULT 'suspicious_transaction',
      severity VARCHAR(20) DEFAULT 'medium', status VARCHAR(30) DEFAULT 'open',
      description TEXT, assigned_to VARCHAR(255),
      detected_at TIMESTAMPTZ DEFAULT NOW(), risk_score INTEGER DEFAULT 70,
      resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cbn_reports (
      id SERIAL PRIMARY KEY, report_ref VARCHAR(50) UNIQUE,
      bank_id INTEGER REFERENCES banking_institutions(id),
      report_type VARCHAR(50) DEFAULT 'prudential_return', reporting_period VARCHAR(30),
      status VARCHAR(30) DEFAULT 'draft', due_date DATE, submitted_at TIMESTAMPTZ,
      data JSONB DEFAULT '{}', narrative TEXT,
      filing_deadline DATE, cbn_ack_ref VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS correspondent_banks (
      id SERIAL PRIMARY KEY,
      bank_id INTEGER REFERENCES banking_institutions(id),
      correspondent_name VARCHAR(255) NOT NULL, correspondent_bic VARCHAR(20),
      country VARCHAR(100), currency VARCHAR(10) DEFAULT 'USD',
      account_number VARCHAR(50), relationship_type VARCHAR(50) DEFAULT 'nostro',
      status VARCHAR(30) DEFAULT 'active', risk_rating VARCHAR(20) DEFAULT 'low',
      last_review_date DATE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  
  for (const stmt of bankingDDL.split(";").filter(s => s.trim())) {
    await client.query(stmt);
  }
  console.log("  Banking tables created\n");
}

seedAll().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
