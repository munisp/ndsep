-- Migration 0081: Public complaint portal (CFPB Consumer Complaint Database
-- pattern) — NDPA 2023 s.46 complaint handling by the Commission.
--
-- Tables backing server/routers/publicComplaints.ts:
--
--   public_complaints      one row per complaint received through the public
--                          portal. Reference code NDPC-CMP-YYYY-NNNNNN from a
--                          DB sequence (0077 pattern). Status machine:
--                          received -> acknowledged -> under_review
--                          -> linked_to_case -> resolved -> closed, each with
--                          its own timestamp. 72-hour acknowledgement SLA
--                          (ack_sla_due_at). Duplicate merge via merged_into_id.
--   complaint_events       append-only lifecycle/audit timeline per complaint
--                          (status transitions, assignments, merges, notes).
--   complaint_attachments  content-addressed attachment records. Bytes go to
--                          the anti-wipe evidence vault API when configured;
--                          otherwise only the SHA-256 hash record is kept
--                          (vault_status = 'hash_record_only'). Attachment
--                          bytes are NEVER stored in this table.
--
-- PII columns (complainant_name / complainant_email / complainant_phone) are
-- encrypted at rest with encryptField() at the write point; they are listed
-- in round8/pii_fields/publicComplaints.txt. The column names are prefixed
-- "complainant_" (not shared with the encryption.ts PII_FIELDS registry,
-- which is a read-only shared file) and are explicitly decrypted with
-- decryptField() on read in the router.
--
-- Idempotent: safe to run repeatedly.

-- NDPC-CMP-YYYY-NNNNNN public complaint reference codes (0077 sequence pattern).
CREATE SEQUENCE IF NOT EXISTS ndsep_complaint_ref_seq START 1;

CREATE TABLE IF NOT EXISTS public_complaints (
  id                         BIGSERIAL PRIMARY KEY,
  reference_code             TEXT NOT NULL UNIQUE,        -- NDPC-CMP-YYYY-NNNNNN
  category                   TEXT NOT NULL
                             CHECK (category IN
                               ('consent', 'breach', 'cross_border',
                                'dark_pattern', 'excessive_collection',
                                'minors', 'other')),
  subject                    TEXT NOT NULL,
  description                TEXT NOT NULL,
  -- Controller linkage: registered controller resolved from its NDPC
  -- registration reference (organizations.registration_number), and/or a
  -- free-text controller name when the controller is not registered or the
  -- complainant does not know the reference.
  controller_id              INTEGER REFERENCES organizations(id),
  controller_registration_ref TEXT,
  controller_name            TEXT,                        -- free-text (unregistered or unresolved)
  -- Geography for spikes-and-trends slicing (Nigeria state / LGA).
  state                      TEXT,
  lga                        TEXT,
  -- Complainant identity (optional — anonymous complaints allowed). PII,
  -- encrypted at rest via encryptField() at the write point.
  complainant_name           TEXT,
  complainant_email          TEXT,
  complainant_phone          TEXT,
  is_anonymous               BOOLEAN NOT NULL DEFAULT true,
  -- SHA-256 of submitter IP (salted) for rate limiting; raw IP never stored.
  submitter_ip_hash          VARCHAR(64),
  -- Status machine + per-transition timestamps.
  status                     TEXT NOT NULL DEFAULT 'received'
                             CHECK (status IN
                               ('received', 'acknowledged', 'under_review',
                                'linked_to_case', 'resolved', 'closed')),
  assigned_officer_id        INTEGER,
  enforcement_case_id        INTEGER REFERENCES enforcement_cases(id),
  merged_into_id             BIGINT REFERENCES public_complaints(id),
  -- Acknowledgement SLA: ack within 72h of receipt.
  ack_sla_due_at             TIMESTAMPTZ NOT NULL,
  received_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at            TIMESTAMPTZ,
  under_review_at            TIMESTAMPTZ,
  linked_at                  TIMESTAMPTZ,
  resolved_at                TIMESTAMPTZ,
  closed_at                  TIMESTAMPTZ,
  resolution_notes           TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_complaints_status
  ON public_complaints (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_complaints_category
  ON public_complaints (category, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_complaints_controller
  ON public_complaints (controller_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_complaints_controller_name
  ON public_complaints (lower(controller_name));
CREATE INDEX IF NOT EXISTS idx_public_complaints_geo
  ON public_complaints (state, lga, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_complaints_ip_hash
  ON public_complaints (submitter_ip_hash, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_complaints_ack_sla
  ON public_complaints (ack_sla_due_at)
  WHERE status = 'received';
CREATE INDEX IF NOT EXISTS idx_public_complaints_case
  ON public_complaints (enforcement_case_id) WHERE enforcement_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_public_complaints_received
  ON public_complaints (received_at DESC);

CREATE TABLE IF NOT EXISTS complaint_events (
  id           BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public_complaints(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,                -- submitted | status_change | assigned |
                                             -- linked_to_case | merged | note | notification
  from_status  TEXT,
  to_status    TEXT,
  actor        TEXT,                         -- officer id/name, 'system', or 'public'
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaint_events_complaint
  ON complaint_events (complaint_id, created_at ASC);

CREATE TABLE IF NOT EXISTS complaint_attachments (
  id           BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES public_complaints(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT NOT NULL,
  sha256       VARCHAR(64) NOT NULL,         -- content address (evidence integrity)
  vault_status TEXT NOT NULL
               CHECK (vault_status IN ('stored', 'hash_record_only', 'failed')),
  vault_ref    TEXT,                         -- vault handle/path when stored
  vault_error  TEXT,                         -- diagnostic when not stored
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaint_attachments_complaint
  ON complaint_attachments (complaint_id);
CREATE INDEX IF NOT EXISTS idx_complaint_attachments_sha256
  ON complaint_attachments (sha256);
