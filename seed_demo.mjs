import pg from 'pg';
import { readFile } from 'fs/promises';

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required. Set it before running this script.");
  process.exit(1);
}
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: false 
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // Create demo DPCO org
  await client.query(`
    INSERT INTO dpco_organisations (id, name, licence_number, status, tier, email, phone, address, cac_number, services, created_at, updated_at)
    VALUES (1, 'DataGuard Ltd', 'NDPC-DPCO-2024-DGL-001', 'active', 'professional', 'info@dataguard.ng', '+234-801-000-0001', 'Victoria Island, Lagos', 'RC-123456', ARRAY['Data Audit','DPO Services','Training'], NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
  `);

  // Create demo DPCO user
  await client.query(`
    INSERT INTO users (open_id, name, role, dpco_org_id, created_at, updated_at)
    VALUES ('demo-dpco-user-001', 'DataGuard Ltd (Demo)', 'user', 1, NOW(), NOW())
    ON CONFLICT (open_id) DO UPDATE SET dpco_org_id = 1, updated_at = NOW()
  `);

  // Create demo admin user
  await client.query(`
    INSERT INTO users (open_id, name, role, dpco_org_id, created_at, updated_at)
    VALUES ('demo-admin-user-001', 'NDPC Admin (Demo)', 'admin', NULL, NOW(), NOW())
    ON CONFLICT (open_id) DO UPDATE SET role = 'admin', updated_at = NOW()
  `);

  // Create 3 demo clients
  const clients = [
    [1, 1, 'First Bank Nigeria Plc', 'Banking & Finance', 'Lagos', 'active', 'high'],
    [2, 1, 'MTN Nigeria Communications', 'Telecommunications', 'Abuja', 'active', 'medium'],
    [3, 1, 'Jumia Technologies', 'E-Commerce', 'Lagos', 'active', 'low'],
  ];
  for (const [id, orgId, name, sector, location, status, risk] of clients) {
    await client.query(`
      INSERT INTO dpco_clients (id, dpco_org_id, org_name, org_sector, org_location, status, risk_level, contact_email, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'contact@example.ng', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET org_name = EXCLUDED.org_name, updated_at = NOW()
    `, [id, orgId, name, sector, location, status, risk]);
  }

  // Create 2 demo audit engagements
  const audits = [
    [1, 1, 1, 'First Bank Annual Compliance Audit 2024', 'fieldwork', 72, 'John Adeyemi', '2024-01-15', '2024-04-30'],
    [2, 1, 2, 'MTN Data Mapping & Gap Assessment', 'report_issued', 88, 'Amaka Okonkwo', '2024-02-01', '2024-05-31'],
  ];
  for (const [id, orgId, clientId, title, stage, score, auditor, start, end] of audits) {
    await client.query(`
      INSERT INTO dpco_audit_engagements (id, dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, current_stage = EXCLUDED.current_stage, updated_at = NOW()
    `, [id, orgId, clientId, title, stage, score, auditor, start, end]);
  }

  // Create 3 demo invoices
  const invoices = [
    [1, 1, 1, 'INV-2024-001', 'Data Protection Audit Services - Q1 2024', 450000, 'paid'],
    [2, 1, 2, 'INV-2024-002', 'DPO Retainer Services - February 2024', 180000, 'paid'],
    [3, 1, 3, 'INV-2024-003', 'Staff Training Workshop - March 2024', 120000, 'pending'],
  ];
  for (const [id, orgId, clientId, num, desc, amount, status] of invoices) {
    await client.query(`
      INSERT INTO dpco_invoices (id, dpco_org_id, client_id, invoice_number, description, amount, status, due_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
    `, [id, orgId, clientId, num, desc, amount, status]);
  }

  await client.query('COMMIT');
  console.log('Demo data seeded successfully');
} catch(e) {
  await client.query('ROLLBACK');
  console.error('Seed error:', e.message);
  console.error(e.stack);
} finally {
  client.release();
  await pool.end();
}
