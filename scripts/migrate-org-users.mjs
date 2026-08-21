/**
 * Migration: create organization_users table
 * Run: node scripts/migrate-org-users.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'create_organization_users.sql'), 'utf8');

const pool = new pg.Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
});

try {
  await pool.query(sql);
  console.log('[migrate-org-users] ✓ organization_users table created/seeded');
} catch (err) {
  console.error('[migrate-org-users] Error:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
