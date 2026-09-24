import pg from 'pg';
const { Pool } = pg;

const PG_URL = process.env.LOCAL_DATABASE_URL || 
  (process.env.DATABASE_URL?.startsWith('postgresql') ? process.env.DATABASE_URL : null) ||
  (process.env.DATABASE_URL || 'postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db');

console.log('Connecting to:', PG_URL.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
const pool = new Pool({ connectionString: PG_URL, ssl: PG_URL.includes('ssl=true') ? { rejectUnauthorized: false } : false });

const statements = [
  `CREATE TABLE IF NOT EXISTS document_vault (
    id SERIAL PRIMARY KEY, document_id TEXT NOT NULL UNIQUE, organization_id INTEGER REFERENCES organizations(id),
    document_type TEXT NOT NULL DEFAULT 'general', file_name TEXT NOT NULL DEFAULT 'unknown',
    file_size BIGINT DEFAULT 0, mime_type TEXT DEFAULT 'application/octet-stream',
    storage_key TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '',
    expiry_date TIMESTAMPTZ, uploaded_by INTEGER, uploaded_at TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'active'
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY, key_id TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT 'API Key', organization_id INTEGER REFERENCES organizations(id),
    scopes TEXT DEFAULT '["read"]', expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'active', request_count INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id SERIAL PRIMARY KEY, endpoint_id TEXT NOT NULL UNIQUE, organization_id INTEGER REFERENCES organizations(id),
    url TEXT NOT NULL DEFAULT 'https://example.com/webhook', events TEXT DEFAULT '[]',
    secret TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '', created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(), last_delivered_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active', delivery_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS cross_sector_data_shares (
    id SERIAL PRIMARY KEY, share_id TEXT NOT NULL UNIQUE, organization_id INTEGER REFERENCES organizations(id),
    source_sector TEXT NOT NULL DEFAULT 'banking', target_sector TEXT NOT NULL DEFAULT 'telecom',
    data_type TEXT NOT NULL DEFAULT 'compliance', justification TEXT DEFAULT '',
    data_elements TEXT DEFAULT '[]', requested_by INTEGER, requested_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ, review_notes TEXT DEFAULT '', shared_at TIMESTAMPTZ, status TEXT DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS compliance_certificates (
    id SERIAL PRIMARY KEY, cert_number TEXT NOT NULL UNIQUE, organization_id INTEGER REFERENCES organizations(id),
    cert_type TEXT DEFAULT 'ndpa_compliance', issued_by INTEGER, issued_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, status TEXT DEFAULT 'active', notes TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS compliance_score_history (
    id SERIAL PRIMARY KEY, organization_id INTEGER REFERENCES organizations(id),
    score NUMERIC(5,2) NOT NULL DEFAULT 0, scored_at TIMESTAMPTZ DEFAULT NOW(),
    scored_by TEXT DEFAULT 'system', notes TEXT DEFAULT ''
  )`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,3) DEFAULT 0`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'low'`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS risk_scored_at TIMESTAMPTZ`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registration_number TEXT`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        process.stdout.write('.');
      } catch (e) {
        console.error('\nError:', e.message.substring(0, 100));
      }
    }
    console.log('\nDone!');
    const r = await client.query("SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema='public'");
    console.log('Total tables in DB:', r.rows[0].cnt);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
