/**
 * Seed organization_users table
 * Links existing users to existing organizations for demo data.
 */
import pg from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const PG_URL = process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://ndsep_user:changeme@localhost:5432/ndsep_db";

const pool = new Pool({
  connectionString: PG_URL,
  ssl: PG_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
});

async function seed() {
  const client = await pool.connect();
  try {
    // Get existing users and organizations
    const { rows: users } = await client.query("SELECT id, name, email FROM users ORDER BY id LIMIT 20");
    const { rows: orgs } = await client.query("SELECT id, name FROM organizations ORDER BY id LIMIT 10");

    if (users.length === 0 || orgs.length === 0) {
      console.log("No users or organizations found. Skipping seed.");
      return;
    }

    console.log(`Found ${users.length} users and ${orgs.length} organizations`);

    // Check existing org_users to avoid duplicates
    const { rows: existing } = await client.query("SELECT user_id, organization_id FROM organization_users");
    const existingSet = new Set(existing.map(r => `${r.user_id}:${r.organization_id}`));

    const inserts = [];

    // Assign each user to 1-2 organizations
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const primaryOrg = orgs[i % orgs.length];
      const key = `${user.id}:${primaryOrg.id}`;

      if (!existingSet.has(key)) {
        inserts.push({
          userId: user.id,
          organizationId: primaryOrg.id,
          role: i === 0 ? "admin" : i < 3 ? "auditor" : "member",
          isPrimary: true,
        });
        existingSet.add(key);
      }

      // Some users get a secondary org
      if (i < 5 && orgs.length > 1) {
        const secondaryOrg = orgs[(i + 1) % orgs.length];
        const key2 = `${user.id}:${secondaryOrg.id}`;
        if (!existingSet.has(key2)) {
          inserts.push({
            userId: user.id,
            organizationId: secondaryOrg.id,
            role: "viewer",
            isPrimary: false,
          });
          existingSet.add(key2);
        }
      }
    }

    if (inserts.length === 0) {
      console.log("All organization_users already seeded.");
      return;
    }

    for (const row of inserts) {
      await client.query(
        `INSERT INTO organization_users (user_id, organization_id, role, is_primary, joined_at, created_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [row.userId, row.organizationId, row.role, row.isPrimary]
      );
    }

    console.log(`Seeded ${inserts.length} organization_users rows`);

    // Verify
    const { rows: count } = await client.query("SELECT count(*) FROM organization_users");
    console.log(`Total organization_users: ${count[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
