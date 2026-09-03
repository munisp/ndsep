-- Durable source-of-truth storage for the DPCO analytics Python microservice.
-- This migration is schema-only. It does not seed demo data or create compliance evidence.

CREATE TABLE IF NOT EXISTS dpco_analytics_events (
    id UUID PRIMARY KEY,
    event_type VARCHAR(128) NOT NULL,
    dpco_id VARCHAR(128) NOT NULL,
    source VARCHAR(32) NOT NULL CHECK (source IN ('api', 'kafka', 'dapr')),
    occurred_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    compliance_score NUMERIC(6,2),
    to_stage VARCHAR(128),
    payload JSONB NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dpco_analytics_events_score_range CHECK (
        compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpco_analytics_events_source_payload
    ON dpco_analytics_events (source, payload_sha256);
CREATE INDEX IF NOT EXISTS idx_dpco_analytics_events_dpco_occurred
    ON dpco_analytics_events (dpco_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dpco_analytics_events_type_occurred
    ON dpco_analytics_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dpco_analytics_events_occurred
    ON dpco_analytics_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dpco_analytics_events_payload_gin
    ON dpco_analytics_events USING gin (payload);

CREATE TABLE IF NOT EXISTS dpco_analytics_dpco_stats (
    dpco_id VARCHAR(128) PRIMARY KEY,
    audits_initiated INTEGER NOT NULL DEFAULT 0 CHECK (audits_initiated >= 0),
    audits_completed INTEGER NOT NULL DEFAULT 0 CHECK (audits_completed >= 0),
    statements_issued INTEGER NOT NULL DEFAULT 0 CHECK (statements_issued >= 0),
    score_total NUMERIC(18,4) NOT NULL DEFAULT 0,
    score_count INTEGER NOT NULL DEFAULT 0 CHECK (score_count >= 0),
    sla_breaches INTEGER NOT NULL DEFAULT 0 CHECK (sla_breaches >= 0),
    last_activity TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpco_analytics_dpco_stats_last_activity
    ON dpco_analytics_dpco_stats (last_activity DESC NULLS LAST);

-- Transactional outbox for durable Kafka/Dapr delivery from server domain mutations.
CREATE TABLE IF NOT EXISTS domain_event_outbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(128) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}',
    user_id INTEGER,
    correlation_id VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_due
    ON domain_event_outbox (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_lease
    ON domain_event_outbox (status, lease_expires_at)
    WHERE status = 'publishing';
CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_aggregate
    ON domain_event_outbox (aggregate_type, aggregate_id, created_at DESC);
