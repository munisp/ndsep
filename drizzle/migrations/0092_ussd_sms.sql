-- Migration 0092: USSD/SMS public complaint intake channels.
--
-- Backs server/routers/ussdChannel.ts:
--   ussd_sessions      server-side USSD session state machine (language →
--                      category → controller lookup → description → confirm).
--                      Sessions expire after 180s of inactivity (gateway-side
--                      timeouts differ per aggregator; 180s is the NDPC SLA).
--                      MSISDN is stored ONLY as HMAC-SHA256 + last4.
--   ussd_intake_queue  dual-path complaint landing table. NDPC-CMP-YYYY-NNNNNN
--                      references come from ndsep_complaint_ref_seq — the SAME
--                      sequence family web complaint intake must use so USSD
--                      and web complaints never collide. At submit time the
--                      router inserts into the platform `complaints` table IF
--                      it exists (to_regclass check), else parks the fully
--                      formed complaint here for later sync (status
--                      'pending_sync' → 'synced'/'failed').
--   sms_outbox         status-change SMS notifications with delivery-status
--                      tracking. Delivery is attempted via the configured SMS
--                      gateway (SMS_GATEWAY_BASE/SMS_GATEWAY_API_KEY); without
--                      gateway credentials rows are marked 'unconfigured' —
--                      never silently marked 'sent'.
--
-- Idempotent: safe to run repeatedly.

-- NDPC-CMP-YYYY-NNNNNN complaint references (USSD + web complaint intake).
CREATE SEQUENCE IF NOT EXISTS ndsep_complaint_ref_seq START 1;

CREATE TABLE IF NOT EXISTS ussd_sessions (
  id             BIGSERIAL PRIMARY KEY,
  session_id     TEXT NOT NULL UNIQUE,         -- gateway-assigned session id
  msisdn_hmac    VARCHAR(64) NOT NULL,         -- HMAC-SHA256 of MSISDN; raw MSISDN is never persisted
  msisdn_last4   VARCHAR(4) NOT NULL,          -- last 4 digits for operator correlation
  state          TEXT NOT NULL DEFAULT 'LANG_SELECT'
                 CHECK (state IN
                   ('LANG_SELECT', 'CATEGORY_MENU', 'CONTROLLER_LOOKUP',
                    'CONTROLLER_PICK', 'DESCRIPTION', 'CONFIRM',
                    'DONE', 'CANCELLED')),
  language       TEXT CHECK (language IN ('en', 'ha', 'yo', 'ig')),
  payload        JSONB NOT NULL DEFAULT '{}',  -- collected fields: {category, controller_query, controller_ref, controller_name, description}
  complaint_ref  VARCHAR(32),                  -- NDPC-CMP-YYYY-NNNNNN once issued
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 seconds'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ussd_sessions_msisdn
  ON ussd_sessions (msisdn_hmac, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ussd_sessions_expiry
  ON ussd_sessions (expires_at) WHERE state NOT IN ('DONE', 'CANCELLED');

CREATE TABLE IF NOT EXISTS ussd_intake_queue (
  id              BIGSERIAL PRIMARY KEY,
  complaint_ref   VARCHAR(32) NOT NULL UNIQUE, -- NDPC-CMP-YYYY-NNNNNN (ndsep_complaint_ref_seq)
  session_id      TEXT NOT NULL,
  msisdn_hmac     VARCHAR(64) NOT NULL,
  msisdn_last4    VARCHAR(4) NOT NULL,
  language        TEXT NOT NULL DEFAULT 'en',
  category        TEXT NOT NULL,
  controller_ref  TEXT,                        -- org id / short code when resolved
  controller_name TEXT,                        -- controller display name or raw query fragment
  description     TEXT NOT NULL,               -- encrypted at the application layer (encryptField) like other intake channels
  sync_target     TEXT NOT NULL DEFAULT 'ussd_intake_queue'
                  CHECK (sync_target IN ('complaints', 'ussd_intake_queue')),
  status          TEXT NOT NULL DEFAULT 'pending_sync'
                  CHECK (status IN ('pending_sync', 'synced', 'failed')),
  synced_at       TIMESTAMPTZ,
  sync_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ussd_intake_queue_status
  ON ussd_intake_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ussd_intake_queue_msisdn
  ON ussd_intake_queue (msisdn_hmac);

CREATE TABLE IF NOT EXISTS sms_outbox (
  id                BIGSERIAL PRIMARY KEY,
  msisdn_hmac       VARCHAR(64) NOT NULL,      -- recipient as HMAC only; raw MSISDN held in memory at enqueue, never stored
  msisdn_last4      VARCHAR(4) NOT NULL,
  message           TEXT NOT NULL,             -- contains complaint ref + status only — never free-text PII
  related_ref       VARCHAR(32),               -- e.g. NDPC-CMP-2026-000123
  notification_type TEXT NOT NULL DEFAULT 'status_change'
                    CHECK (notification_type IN ('status_change', 'intake_confirmation', 'otp')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'unconfigured')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  gateway_response  JSONB,                     -- last gateway HTTP status/body excerpt for delivery tracking
  last_attempt_at   TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_outbox_status
  ON sms_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_related_ref
  ON sms_outbox (related_ref);
