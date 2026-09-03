-- APISIX route configuration is an operational control plane, not application memory.
-- No route records are seeded here; route creation requires an authorized workflow.

CREATE TYPE gateway_route_sync_status AS ENUM ('succeeded', 'failed');

CREATE TABLE gateway_routes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  uri VARCHAR(512) NOT NULL UNIQUE,
  methods TEXT[] NOT NULL,
  upstream VARCHAR(512) NOT NULL,
  plugins JSONB NOT NULL DEFAULT '{}'::jsonb,
  journey_id VARCHAR(32),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gateway_routes_id_shape CHECK (id ~ '^[A-Za-z0-9._:-]+$' AND char_length(id) <= 64),
  CONSTRAINT gateway_routes_uri_shape CHECK (uri ~ '^/[A-Za-z0-9._/*:.-]+$' AND char_length(uri) <= 512),
  CONSTRAINT gateway_routes_methods_not_empty CHECK (cardinality(methods) > 0),
  CONSTRAINT gateway_routes_upstream_shape CHECK (upstream ~ '^https?://[^[:space:]]+$' AND char_length(upstream) <= 512)
);

CREATE TABLE gateway_route_sync_attempts (
  id UUID PRIMARY KEY,
  route_id VARCHAR(64) NOT NULL REFERENCES gateway_routes(id) ON DELETE CASCADE,
  route_version INTEGER NOT NULL,
  status gateway_route_sync_status NOT NULL,
  http_status INTEGER,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gateway_route_sync_attempts_outcome CHECK (
    (status = 'succeeded' AND http_status BETWEEN 200 AND 299 AND error_message IS NULL)
    OR (status = 'failed' AND (http_status IS NULL OR http_status NOT BETWEEN 200 AND 299))
  )
);

CREATE INDEX gateway_routes_active_idx ON gateway_routes (is_active, id);
CREATE INDEX gateway_route_sync_attempts_route_time_idx ON gateway_route_sync_attempts (route_id, attempted_at DESC);
