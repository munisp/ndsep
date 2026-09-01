-- Durable PostgreSQL source of truth for Lakehouse ingestion and feature-store metadata.
-- This migration contains DDL only. It intentionally creates no business, fixture,
-- release, or compliance evidence records.

CREATE TABLE IF NOT EXISTS lakehouse_ingest_records (
  id UUID PRIMARY KEY,
  table_name TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  data JSONB NOT NULL,
  schema_version TEXT NOT NULL,
  source_system TEXT NOT NULL,
  record_hash CHAR(64) NOT NULL UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'retry', 'sending', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((delivery_status <> 'sending') OR lease_expires_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lakehouse_ingest_pending_claim
  ON lakehouse_ingest_records (next_attempt_at, created_at)
  WHERE delivery_status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_lakehouse_ingest_table_partition
  ON lakehouse_ingest_records (table_name, partition_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lakehouse_ingest_sending_lease
  ON lakehouse_ingest_records (lease_expires_at)
  WHERE delivery_status = 'sending';

CREATE TABLE IF NOT EXISTS ml_feature_store (
  id UUID PRIMARY KEY,
  feature_group TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'organization',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ml_feature_store_feature_group_entity_key UNIQUE (feature_group, entity_id)
);

CREATE TABLE IF NOT EXISTS ml_prediction_log (
  id UUID PRIMARY KEY,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  input_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  prediction JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms BIGINT NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ml_lineage (
  id UUID PRIMARY KEY,
  source_table TEXT NOT NULL,
  target_table TEXT NOT NULL,
  transformation TEXT NOT NULL,
  record_count BIGINT NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  pipeline_run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_store_group_entity
  ON ml_feature_store (feature_group, entity_id);
CREATE INDEX IF NOT EXISTS idx_prediction_log_model
  ON ml_prediction_log (model_name, predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_lineage_pipeline
  ON ml_lineage (pipeline_run_id, created_at DESC);
