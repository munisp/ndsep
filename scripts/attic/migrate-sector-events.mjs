/**
 * Migration: create sector_compliance_events table
 * Run: node scripts/migrate-sector-events.mjs
 */
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sector_compliance_events (
      id SERIAL PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      sector VARCHAR(64) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'info',
      title VARCHAR(255) NOT NULL,
      description TEXT,
      details JSONB DEFAULT '{}',
      worker_name VARCHAR(128),
      rule_id VARCHAR(128),
      resolved BOOLEAN DEFAULT false,
      resolved_at TIMESTAMP,
      resolved_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[migrate] ✓ sector_compliance_events table created');

  // Seed with sample events from real organizations
  const { rows: orgs } = await pool.query('SELECT id, sector FROM organizations LIMIT 10');
  const workers = ['fintech_monitor', 'kyc_analysis_worker', 'telecom_compliance_worker', 'health_data_worker', 'insurance_monitor'];
  const eventTypes = ['scan_completed', 'violation_detected', 'alert_raised', 'remediation_required', 'certificate_issued'];
  const severities = ['info', 'info', 'warning', 'critical', 'info'];
  const rules = ['NDPR-2019-S4', 'CBN-2022-FIN', 'NCC-2021-TEL', 'NHIA-2022-HLT', 'NAICOM-2023-INS'];

  let seeded = 0;
  for (const org of orgs) {
    for (let i = 0; i < 3; i++) {
      const idx = i % workers.length;
      await pool.query(`
        INSERT INTO sector_compliance_events 
          (org_id, sector, event_type, severity, title, description, worker_name, rule_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        org.id,
        org.sector || 'fintech',
        eventTypes[idx],
        severities[idx],
        `${eventTypes[idx].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${org.sector || 'Fintech'} Sector`,
        `Automated compliance event recorded by ${workers[idx]} for sector ${org.sector || 'fintech'}.`,
        workers[idx],
        rules[idx],
      ]);
      seeded++;
    }
  }
  console.log(`[migrate] ✓ sector_compliance_events seeded with ${seeded} events across ${orgs.length} organizations`);
} catch (e) {
  console.error('[migrate] ERROR:', e.message);
} finally {
  await pool.end();
}
