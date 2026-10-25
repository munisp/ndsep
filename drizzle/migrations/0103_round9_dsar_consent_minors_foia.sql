-- Migration 0103: Round-9 FIX-B hardening — DSAR edge cases, consent
-- propagation, minors consent, FOIA, USSD sync target.
--
-- Covers:
--   1. citizen_request_status vocabulary: add 'merged' (dsarEdgeCases
--      mergeRequests no longer misstates merged duplicates as 'completed').
--   2. DSAR response-clock pause intervals (verification pending) +
--      deadline-extension columns on citizen_requests.
--   3. dsar_notification_retries: refusal/extension subject-notification
--      retry queue (failures are queued, never dropped).
--   4. rate_limit_counters: shared atomic fixed-window counters used by the
--      non-TOCTOU upsert rate limiters (public complaints, DSAR edge
--      submissions, FOIA, whistleblower channel, NIN verification).
--   5. ussd_intake_queue sync_target vocabulary: add 'public_complaints'
--      (USSD complaints now land directly in public_complaints).
--   6. Minors: data_subject_ref_hmac equality-lookup columns (PII encrypted
--      at rest is not equality-searchable), parental-consent linkage,
--      consent_refresh_tasks.evidence_ref; parental_consent_records created
--      if missing.
--   7. Consent propagation: propagation_records retry metadata (failed
--      dispatch outbox), legacy plaintext ack tokens hashed in place,
--      consent_withdrawal_links self-service withdrawal tokens (NDPA s.35
--      withdrawal parity).
--   8. FOIA: statutory 7-day extension columns + foia_events notice log.
--
-- Idempotent: safe to run repeatedly.
-- NOTE: ALTER TYPE ... ADD VALUE must not run inside an explicit transaction
-- block; apply with `psql -f` or a per-statement runner (same constraint as
-- migration 0071).

-- ─── 1. DSAR status vocabulary: 'merged' ────────────────────────────────────
ALTER TYPE citizen_request_status ADD VALUE IF NOT EXISTS 'merged';

-- ─── 2. DSAR clock pause + extension columns ────────────────────────────────
ALTER TABLE citizen_requests
  ADD COLUMN IF NOT EXISTS initial_response_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extension_notified_at TIMESTAMPTZ;

-- Backfill the initial response window marker from the current deadline for
-- rows that have never been extended.
UPDATE citizen_requests
SET initial_response_deadline = response_deadline
WHERE initial_response_deadline IS NULL
  AND extension_days = 0
  AND response_deadline IS NOT NULL;

CREATE TABLE IF NOT EXISTS dsar_clock_pauses (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES citizen_requests(id),
  paused_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at  TIMESTAMPTZ,                       -- NULL = clock currently paused
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one open pause interval per request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dsar_clock_pauses_open
  ON dsar_clock_pauses (request_id) WHERE resumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dsar_clock_pauses_request
  ON dsar_clock_pauses (request_id, paused_at);

-- ─── 3. DSAR subject-notification retry queue ───────────────────────────────
CREATE TABLE IF NOT EXISTS dsar_notification_retries (
  id            BIGSERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES citizen_requests(id),
  kind          TEXT NOT NULL CHECK (kind IN ('refusal', 'extension')),
  recipient     TEXT NOT NULL,                   -- encrypted at rest (encryptField)
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsar_notification_retries_due
  ON dsar_notification_retries (status, next_retry_at) WHERE status = 'pending';

-- ─── 4. Shared atomic rate-limit counters (non-TOCTOU) ─────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  limiter_key  TEXT NOT NULL,                    -- e.g. sha256(salt|action|ip) or subject-scoped key
  window_start TIMESTAMPTZ NOT NULL,             -- fixed-window bucket start
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (limiter_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window
  ON rate_limit_counters (window_start);

-- ─── 5. USSD sync target vocabulary ─────────────────────────────────────────
ALTER TABLE ussd_intake_queue DROP CONSTRAINT IF EXISTS ussd_intake_queue_sync_target_check;
ALTER TABLE ussd_intake_queue
  ADD CONSTRAINT ussd_intake_queue_sync_target_check
  CHECK (sync_target IN ('complaints', 'public_complaints', 'ussd_intake_queue'));

-- ─── 6. Minors: HMAC lookup columns + parental-consent linkage ──────────────
-- parental_consent_records is canonical (drizzle/0024); create if missing so
-- the age-assurance linkage has a target.
CREATE TABLE IF NOT EXISTS parental_consent_records (
  id                       SERIAL PRIMARY KEY,
  organization_id          INTEGER NOT NULL,
  child_name               VARCHAR(256),
  child_age                INTEGER,
  parent_name              VARCHAR(256) NOT NULL,
  parent_email             VARCHAR(320) NOT NULL,
  parent_id_verified       BOOLEAN DEFAULT false,
  purpose                  TEXT NOT NULL,
  parental_consent_status  VARCHAR(32) NOT NULL DEFAULT 'pending',
  consent_given_at         TIMESTAMPTZ,
  consent_withdrawn_at     TIMESTAMPTZ,
  verification_method      VARCHAR(128),
  age_verification_method  VARCHAR(128),
  metadata                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PII is now encrypted at rest (encryptField, FIX-B round 9). Ciphertext does
-- not fit the legacy VARCHAR/DATE shapes and is not date-arithmetic-able, so:
--   - dob becomes TEXT (ciphertext; legacy rows keep their plaintext
--     'YYYY-MM-DD' text form),
--   - a separate plaintext majority_date DATE column carries the only value
--     the SQL arithmetic actually needs (dob + 18 years), computed in app
--     code at write time and backfilled here from legacy plaintext dobs.
ALTER TABLE age_assurance_records ALTER COLUMN dob TYPE TEXT;
ALTER TABLE age_assurance_records
  ADD COLUMN IF NOT EXISTS majority_date DATE,
  ADD COLUMN IF NOT EXISTS data_subject_ref_hmac VARCHAR(64),
  ADD COLUMN IF NOT EXISTS parental_consent_record_id INTEGER REFERENCES parental_consent_records(id);

UPDATE age_assurance_records
SET majority_date = (dob::date + INTERVAL '18 years')::date
WHERE majority_date IS NULL
  AND dob ~ '^\d{4}-\d{2}-\d{2}$';

ALTER TABLE age_assurance_records ALTER COLUMN data_subject_ref TYPE TEXT;
ALTER TABLE age_assurance_records ALTER COLUMN guardian_name TYPE TEXT;
ALTER TABLE age_assurance_records ALTER COLUMN guardian_contact TYPE TEXT;
ALTER TABLE consent_refresh_tasks ALTER COLUMN data_subject_ref TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_age_assurance_majority
  ON age_assurance_records (majority_date);

CREATE INDEX IF NOT EXISTS idx_age_assurance_subject_hmac
  ON age_assurance_records (data_subject_ref_hmac);

ALTER TABLE consent_refresh_tasks
  ADD COLUMN IF NOT EXISTS data_subject_ref_hmac VARCHAR(64),
  ADD COLUMN IF NOT EXISTS evidence_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_consent_refresh_subject_hmac
  ON consent_refresh_tasks (data_subject_ref_hmac);

-- ─── 7. Consent propagation hardening ───────────────────────────────────────
-- subject_ref is encrypted at rest (FIX-B round 9); widen for ciphertext.
ALTER TABLE withdrawal_events ALTER COLUMN subject_ref TYPE TEXT;
-- Failed-dispatch outbox metadata on propagation records.
ALTER TABLE propagation_records
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_propagation_records_retry
  ON propagation_records (status, next_retry_at) WHERE status = 'failed';

-- Legacy ack tokens were stored as 48-char plaintext hex; hash them in place
-- so only the SHA-256 form exists at rest (acknowledgeByToken now matches the
-- hash only). 64-hex rows are already hashed and are left untouched.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE propagation_records
SET ack_token = encode(digest(ack_token, 'sha256'), 'hex'),
    updated_at = NOW()
WHERE ack_token !~ '^[0-9a-f]{64}$';

-- Self-service withdrawal links (NDPA 2023 s.35: withdrawal as easy as giving
-- consent). One-time signed tokens; only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS consent_withdrawal_links (
  id                BIGSERIAL PRIMARY KEY,
  consent_record_id INTEGER NOT NULL REFERENCES consent_records(id),
  organization_id   INTEGER NOT NULL,
  token_hash        VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 of the raw token
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_withdrawal_links_record
  ON consent_withdrawal_links (consent_record_id);
CREATE INDEX IF NOT EXISTS idx_consent_withdrawal_links_active
  ON consent_withdrawal_links (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

-- ─── 8. FOIA statutory extension + applicant notice events ─────────────────
-- reporter_email is encrypted at rest (FIX-B round 9); widen for ciphertext.
ALTER TABLE whistleblower_reports ALTER COLUMN reporter_email TYPE TEXT;
ALTER TABLE protection_flags ALTER COLUMN reporter_email TYPE TEXT;

ALTER TABLE foia_requests
  ADD COLUMN IF NOT EXISTS extension_granted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extension_days INTEGER,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT,
  ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS foia_events (
  id              BIGSERIAL PRIMARY KEY,
  foia_request_id INTEGER NOT NULL REFERENCES foia_requests(id),
  event_type      TEXT NOT NULL,                 -- submitted|status_change|extension_granted|overdue|notification_*
  actor           TEXT NOT NULL DEFAULT 'system',
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foia_events_request
  ON foia_events (foia_request_id, created_at);
-- The overdue sweep inserts at most one 'overdue' event per request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_foia_events_overdue_once
  ON foia_events (foia_request_id) WHERE event_type = 'overdue';
