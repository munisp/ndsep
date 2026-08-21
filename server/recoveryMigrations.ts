import type { Pool } from "pg";

const RECOVERY_DDL = [
  `CREATE TABLE IF NOT EXISTS recovery_authorizations (
    id uuid PRIMARY KEY,
    queue_id text NOT NULL,
    payload_hash char(64) NOT NULL,
    idempotency_key uuid NOT NULL,
    owner_subject text NOT NULL,
    target_device_fingerprint char(64) NOT NULL,
    challenge text NOT NULL UNIQUE,
    kms_ciphertext text NOT NULL,
    kms_encryption_context jsonb NOT NULL,
    rewrapped_ciphertext text NULL,
    status text NOT NULL CHECK (status IN ('pending', 'authorized', 'rewrap_in_progress', 'replay_in_progress', 'consumed', 'expired', 'denied')),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_authorizations_pending_binding_unique UNIQUE (queue_id, payload_hash, target_device_fingerprint, status)
  )`,
  `CREATE INDEX IF NOT EXISTS recovery_authorizations_status_idx ON recovery_authorizations (status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id uuid PRIMARY KEY,
    subject text NOT NULL,
    credential_id text NOT NULL UNIQUE,
    credential_public_key text NOT NULL,
    sign_count bigint NOT NULL DEFAULT 0,
    transports jsonb NULL,
    revoked_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS webauthn_credentials_subject_idx ON webauthn_credentials (subject) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS recovery_approvals (
    id uuid PRIMARY KEY,
    authorization_id uuid NOT NULL REFERENCES recovery_authorizations(id) ON DELETE RESTRICT,
    approver_subject text NOT NULL,
    approver_role text NOT NULL CHECK (approver_role IN ('security_engineer', 'planning_supervisor')),
    credential_id text NOT NULL REFERENCES webauthn_credentials(credential_id) ON DELETE RESTRICT,
    assertion jsonb NOT NULL,
    signed_digest char(64) NOT NULL,
    sign_count bigint NOT NULL,
    signed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_approvals_subject_unique UNIQUE (authorization_id, approver_subject),
    CONSTRAINT recovery_approvals_role_unique UNIQUE (authorization_id, approver_role)
  )`,
  `CREATE INDEX IF NOT EXISTS recovery_approvals_authorization_idx ON recovery_approvals (authorization_id)`,
  `CREATE TABLE IF NOT EXISTS recovery_replays (
    authorization_id uuid PRIMARY KEY REFERENCES recovery_authorizations(id) ON DELETE RESTRICT,
    idempotency_key uuid NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    replay_endpoint text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_error text NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_audit_events (
    id uuid PRIMARY KEY,
    authorization_id uuid NOT NULL REFERENCES recovery_authorizations(id) ON DELETE RESTRICT,
    sequence_number bigint NOT NULL,
    event_type text NOT NULL,
    actor_subject text NULL,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    previous_event_hash char(64) NULL,
    event_hash char(64) NOT NULL UNIQUE,
    CONSTRAINT recovery_audit_events_sequence_unique UNIQUE (authorization_id, sequence_number)
  )`,
  `CREATE INDEX IF NOT EXISTS recovery_audit_events_authorization_idx ON recovery_audit_events (authorization_id, sequence_number)`,
  `CREATE OR REPLACE FUNCTION reject_recovery_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery approvals are immutable' USING ERRCODE = '55000'; END; $$`,
  `CREATE OR REPLACE FUNCTION reject_recovery_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery audit events are append-only' USING ERRCODE = '55000'; END; $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'recovery_approvals_immutable') THEN
      CREATE TRIGGER recovery_approvals_immutable BEFORE UPDATE OR DELETE ON recovery_approvals FOR EACH ROW EXECUTE FUNCTION reject_recovery_approval_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'recovery_audit_events_immutable') THEN
      CREATE TRIGGER recovery_audit_events_immutable BEFORE UPDATE OR DELETE ON recovery_audit_events FOR EACH ROW EXECUTE FUNCTION reject_recovery_audit_mutation();
    END IF;
  END $$`,
];

export async function runRecoveryMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(734209114)");
    for (const statement of RECOVERY_DDL) await client.query(statement);
  } finally {
    await client.query("SELECT pg_advisory_unlock(734209114)").catch(() => undefined);
    client.release();
  }
}
