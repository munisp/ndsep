-- Migration 0091: Regulatory intelligence knowledge base.
--
-- Backs server/routers/regIntel.ts and workers/python/regintel_ingest_worker.py:
-- a versioned corpus of Nigerian data-protection legal instruments (NDPA 2023,
-- GAID 2025, subsidiary legislation, tribunal/Federal High Court precedents)
-- with section-level chunks, supersession chains, rule→section references for
-- legal-change impact alerts, and persisted askLegal provenance.
--
-- Vector embeddings for each section chunk live in the Qdrant collection
-- `legal_corpus` (upserted by regintel_ingest_worker); qdrant_point_id links
-- a section row to its vector point. The corpus remains queryable (degraded
-- keyword mode) when Qdrant/embedding is unconfigured.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS legal_instruments (
  id                 BIGSERIAL PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,     -- e.g. 'NDPA-2023', 'GAID-2025'
  title              TEXT NOT NULL,
  instrument_type    TEXT NOT NULL
                     CHECK (instrument_type IN
                       ('act', 'regulation', 'guidance', 'subsidiary_legislation',
                        'tribunal_precedent', 'court_precedent')),
  issuing_authority  TEXT,                     -- e.g. 'National Assembly', 'NDPC'
  gazette_ref        TEXT,                     -- official gazette citation, if any
  status             TEXT NOT NULL DEFAULT 'in_force'
                     CHECK (status IN ('in_force', 'repealed', 'spent')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         TEXT
);

CREATE TABLE IF NOT EXISTS legal_versions (
  id                    BIGSERIAL PRIMARY KEY,
  instrument_id         BIGINT NOT NULL REFERENCES legal_instruments (id) ON DELETE CASCADE,
  version_label         TEXT NOT NULL,         -- e.g. '2023-original', '2025-amendment-1'
  effective_date        DATE NOT NULL,
  supersedes_version_id BIGINT REFERENCES legal_versions (id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'current'
                        CHECK (status IN ('current', 'superseded', 'repealed')),
  source                TEXT,                  -- provenance: upload ref / gazette URL
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT,
  UNIQUE (instrument_id, version_label)
);

CREATE INDEX IF NOT EXISTS idx_legal_versions_instrument
  ON legal_versions (instrument_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_legal_versions_status
  ON legal_versions (status);

CREATE TABLE IF NOT EXISTS legal_sections (
  id               BIGSERIAL PRIMARY KEY,
  instrument_id    BIGINT NOT NULL REFERENCES legal_instruments (id) ON DELETE CASCADE,
  version_id       BIGINT NOT NULL REFERENCES legal_versions (id) ON DELETE CASCADE,
  section_ref      TEXT NOT NULL,              -- e.g. 'Section 44(2)' / 'Article 5'
  heading          TEXT,
  body             TEXT NOT NULL,              -- section chunk text (public legal text, not PII)
  chunk_index      INTEGER NOT NULL DEFAULT 0, -- >0 when a long section is split
  qdrant_point_id  TEXT,                       -- point id in Qdrant collection `legal_corpus`; NULL when embedding unconfigured
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, section_ref, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_legal_sections_instrument
  ON legal_sections (instrument_id);
CREATE INDEX IF NOT EXISTS idx_legal_sections_version
  ON legal_sections (version_id);
CREATE INDEX IF NOT EXISTS idx_legal_sections_ref
  ON legal_sections (section_ref);

-- Platform rules / workflows that depend on specific legal sections.
-- When a new instrument version supersedes a section, rows referencing the
-- superseded section surface as legal-change alerts (regIntel.legalChangeAlerts).
CREATE TABLE IF NOT EXISTS rule_legal_references (
  id            BIGSERIAL PRIMARY KEY,
  rule_type     TEXT NOT NULL
                CHECK (rule_type IN ('platform_rule', 'workflow', 'compliance_check', 'penalty_basis')),
  rule_ref      TEXT NOT NULL,                 -- e.g. 'dsar.deadlineTracker', 'temporal:breach-notification'
  instrument_id BIGINT NOT NULL REFERENCES legal_instruments (id) ON DELETE CASCADE,
  section_ref   TEXT NOT NULL,                 -- e.g. 'Section 40'
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  UNIQUE (rule_type, rule_ref, instrument_id, section_ref)
);

CREATE INDEX IF NOT EXISTS idx_rule_legal_refs_instrument_section
  ON rule_legal_references (instrument_id, section_ref);
CREATE INDEX IF NOT EXISTS idx_rule_legal_refs_rule
  ON rule_legal_references (rule_type, rule_ref);

-- askLegal provenance: every answered question, the retrieval mode actually
-- used ('kgqa' or 'degraded_keyword_fallback'), and the exact citations the
-- answer relied on (instrument, section, version, effective date).
CREATE TABLE IF NOT EXISTS legal_queries (
  id             BIGSERIAL PRIMARY KEY,
  question       TEXT NOT NULL,
  mode           TEXT NOT NULL
                 CHECK (mode IN ('kgqa', 'degraded_keyword_fallback')),
  answer         TEXT NOT NULL,
  citations      JSONB NOT NULL DEFAULT '[]',  -- [{instrument, section_ref, version_label, effective_date}]
  retrieval_meta JSONB NOT NULL DEFAULT '{}',  -- {top_k, kgqa_status, embed_status, degraded_reason}
  asked_by       TEXT,                         -- user id/email when authenticated; NULL for anonymous
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_queries_created_at
  ON legal_queries (created_at DESC);
