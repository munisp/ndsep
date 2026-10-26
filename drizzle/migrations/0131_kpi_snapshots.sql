-- Round-12 §8: KPI time-series snapshots.
--
-- kpi_snapshots stores point-in-time captures of the productivity KPI
-- baseline metrics (server/analytics/productivityKpis.ts) so the KPI
-- dashboard can render trends instead of only the current value.
--
--   metric       stable metric key, e.g. 'time_to_triage_hours'
--   value        primary numeric value (unit carried in dimensions.unit)
--   dimensions   breakdown/sample metadata (JSONB), e.g.
--                {"unit":"hours","sampleSize":42,"staffEvents":317}
--   captured_at  capture timestamp (default now())

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric      TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  dimensions  JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_metric_time
  ON kpi_snapshots (metric, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_captured_at
  ON kpi_snapshots (captured_at DESC);
