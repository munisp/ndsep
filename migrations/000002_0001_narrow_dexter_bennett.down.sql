-- Rollback migration 000002: 0001_narrow_dexter_bennett

DROP TABLE IF EXISTS "residency_checks" CASCADE;
DROP TABLE IF EXISTS "financial_ledger" CASCADE;
DROP TABLE IF EXISTS "bgp_routes" CASCADE;
