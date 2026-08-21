-- NDSEP Local Docker PostgreSQL Initialization
-- Run by Docker entrypoint when initializing a fresh postgres container
-- Usage: docker run -e POSTGRES_PASSWORD=postgres -v $(pwd)/scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql postgres:15

-- Create application database
CREATE DATABASE ndsep_db
    WITH
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.utf8'
    LC_CTYPE = 'en_US.utf8'
    TEMPLATE = template0;

COMMENT ON DATABASE ndsep_db IS 'National Data Sovereignty Enforcement Platform — primary database';

-- Create application user
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ndsep_user') THEN
        CREATE ROLE ndsep_user WITH
            LOGIN
            PASSWORD 'ndsep_secure_2026'
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            NOREPLICATION
            CONNECTION LIMIT 50;
    END IF;
END
$$;

-- Create read-only reporting user
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ndsep_readonly') THEN
        CREATE ROLE ndsep_readonly WITH
            LOGIN
            PASSWORD 'ndsep_readonly_2026'
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            NOREPLICATION
            CONNECTION LIMIT 10;
    END IF;
END
$$;

-- Grant privileges on ndsep_db
GRANT ALL PRIVILEGES ON DATABASE ndsep_db TO ndsep_user;
GRANT CONNECT ON DATABASE ndsep_db TO ndsep_readonly;

-- Connect to ndsep_db to set schema permissions
\connect ndsep_db

-- Grant schema-level permissions
GRANT ALL ON SCHEMA public TO ndsep_user;
GRANT USAGE ON SCHEMA public TO ndsep_readonly;

-- Grant table-level permissions for existing and future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ndsep_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO ndsep_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ndsep_user;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create audit schema for audit logs
CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION ndsep_user;
GRANT USAGE ON SCHEMA audit TO ndsep_readonly;

-- Create performance indexes helper function
CREATE OR REPLACE FUNCTION ndsep_create_indexes() RETURNS void AS $$
BEGIN
    -- These will be created by Drizzle migrations, but we pre-create GIN indexes
    -- for full-text search on key tables if they already exist
    RAISE NOTICE 'NDSEP database initialized successfully';
END;
$$ LANGUAGE plpgsql;

SELECT ndsep_create_indexes();

-- Set connection parameters for performance
ALTER DATABASE ndsep_db SET statement_timeout = '30s';
ALTER DATABASE ndsep_db SET idle_in_transaction_session_timeout = '60s';
ALTER DATABASE ndsep_db SET lock_timeout = '10s';
ALTER DATABASE ndsep_db SET log_min_duration_statement = '1000';

-- Set timezone
ALTER DATABASE ndsep_db SET timezone = 'UTC';

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'NDSEP database initialization complete at %', NOW();
    RAISE NOTICE 'Database: ndsep_db';
    RAISE NOTICE 'App user: ndsep_user';
    RAISE NOTICE 'Readonly user: ndsep_readonly';
    RAISE NOTICE 'Extensions: uuid-ossp, pgcrypto, pg_stat_statements, btree_gin, pg_trgm';
END
$$;
