-- Create organization_users join table for portal.myOrg procedure
-- This links users to their organizations for mobile portal access

CREATE TABLE IF NOT EXISTS organization_users (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_users_user_id ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_users_org_id ON organization_users(organization_id);

-- Seed: link demo DPCO user to first organization
-- This ensures portal.myOrg returns data for the demo user
INSERT INTO organization_users (user_id, organization_id, role)
SELECT u.id, o.id, 'member'
FROM users u
CROSS JOIN (SELECT id FROM organizations LIMIT 1) o
WHERE u.open_id = 'demo-dpco-user-001'
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- Seed: link all existing users with dpco_org_id to their org
INSERT INTO organization_users (user_id, organization_id, role)
SELECT u.id, u.dpco_org_id, 'member'
FROM users u
WHERE u.dpco_org_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;
