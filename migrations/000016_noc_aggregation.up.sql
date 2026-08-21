-- NDSEP NOC Aggregation Layer — Database Schema
-- Network Operations Center: devices, alerts, topology, uptime, escalations

-- ── NOC Devices (network infrastructure inventory) ───────────────────────────
CREATE TABLE IF NOT EXISTS noc_devices (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL UNIQUE,
  hostname VARCHAR(255) NOT NULL,
  ip_address INET NOT NULL,
  mac_address MACADDR,
  device_type VARCHAR(50) NOT NULL CHECK (device_type IN (
    'router', 'switch', 'firewall', 'load_balancer', 'server',
    'access_point', 'iot_gateway', 'storage', 'ups', 'pdu', 'other'
  )),
  vendor VARCHAR(100),
  model VARCHAR(100),
  firmware_version VARCHAR(50),
  location VARCHAR(255),
  rack_unit VARCHAR(20),
  snmp_community VARCHAR(100),
  snmp_version VARCHAR(5) DEFAULT 'v3',
  syslog_enabled BOOLEAN DEFAULT false,
  netflow_enabled BOOLEAN DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (status IN (
    'up', 'down', 'degraded', 'maintenance', 'unknown'
  )),
  last_seen TIMESTAMPTZ,
  cpu_utilization NUMERIC(5,2),
  memory_utilization NUMERIC(5,2),
  bandwidth_in_mbps NUMERIC(12,2),
  bandwidth_out_mbps NUMERIC(12,2),
  uptime_seconds BIGINT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOC Topology Links (device-to-device connections) ────────────────────────
CREATE TABLE IF NOT EXISTS noc_topology_links (
  id SERIAL PRIMARY KEY,
  source_device_id VARCHAR(64) NOT NULL REFERENCES noc_devices(device_id) ON DELETE CASCADE,
  target_device_id VARCHAR(64) NOT NULL REFERENCES noc_devices(device_id) ON DELETE CASCADE,
  link_type VARCHAR(30) NOT NULL CHECK (link_type IN (
    'ethernet', 'fiber', 'wireless', 'vpn', 'vlan', 'bgp_peer', 'ospf', 'virtual'
  )),
  source_interface VARCHAR(50),
  target_interface VARCHAR(50),
  bandwidth_mbps NUMERIC(12,2),
  latency_ms NUMERIC(8,2),
  packet_loss_pct NUMERIC(5,3) DEFAULT 0,
  status VARCHAR(15) DEFAULT 'up' CHECK (status IN ('up', 'down', 'degraded', 'unknown')),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(source_device_id, target_device_id, source_interface)
);

-- ── NOC Alerts (unified cross-domain alerts) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_alerts (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(64) NOT NULL UNIQUE,
  source VARCHAR(30) NOT NULL CHECK (source IN (
    'snmp', 'syslog', 'netflow', 'wiredigg', 'siem', 'sla_tracker',
    'health_check', 'anomaly', 'bgp', 'apisix', 'openappsec',
    'tigerbeetle', 'temporal', 'custom'
  )),
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  category VARCHAR(50) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  device_id VARCHAR(64) REFERENCES noc_devices(device_id) ON DELETE SET NULL,
  source_ip INET,
  affected_service VARCHAR(100),
  correlation_id VARCHAR(64),
  is_correlated BOOLEAN DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'acknowledged', 'investigating', 'escalated', 'resolved', 'suppressed'
  )),
  assigned_to VARCHAR(255),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  escalation_level INTEGER DEFAULT 0,
  suppressed_until TIMESTAMPTZ,
  repeat_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL
);

-- ── NOC Uptime Records (per-service availability tracking) ───────────────────
CREATE TABLE IF NOT EXISTS noc_uptime_records (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  service_port INTEGER,
  check_type VARCHAR(20) DEFAULT 'http' CHECK (check_type IN ('http', 'tcp', 'icmp', 'snmp', 'custom')),
  is_up BOOLEAN NOT NULL,
  response_time_ms NUMERIC(10,2),
  status_code INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOC Uptime SLA (aggregated availability per service per period) ──────────
CREATE TABLE IF NOT EXISTS noc_uptime_sla (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_checks INTEGER NOT NULL DEFAULT 0,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  availability_pct NUMERIC(7,4) NOT NULL DEFAULT 0,
  avg_response_ms NUMERIC(10,2),
  p95_response_ms NUMERIC(10,2),
  p99_response_ms NUMERIC(10,2),
  max_downtime_seconds INTEGER DEFAULT 0,
  sla_target_pct NUMERIC(7,4) DEFAULT 99.9000,
  sla_met BOOLEAN GENERATED ALWAYS AS (availability_pct >= sla_target_pct) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_name, period_start)
);

-- ── NOC Escalation Policies ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_escalation_policies (
  id SERIAL PRIMARY KEY,
  policy_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  severity_filter VARCHAR(10)[] DEFAULT ARRAY['critical', 'high'],
  source_filter VARCHAR(30)[],
  escalation_levels JSONB NOT NULL DEFAULT '[]',
  -- escalation_levels: [{"level":1,"delay_minutes":5,"notify":["ops@example.com"],"channel":"slack"},
  --                      {"level":2,"delay_minutes":15,"notify":["oncall@example.com"],"channel":"pagerduty"}]
  auto_acknowledge_minutes INTEGER DEFAULT 30,
  auto_resolve_minutes INTEGER,
  runbook_id VARCHAR(64),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOC On-Call Schedules ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_oncall_schedules (
  id SERIAL PRIMARY KEY,
  schedule_name VARCHAR(100) NOT NULL,
  team_name VARCHAR(100) NOT NULL,
  rotation_type VARCHAR(20) DEFAULT 'weekly' CHECK (rotation_type IN ('daily', 'weekly', 'biweekly', 'custom')),
  members JSONB NOT NULL DEFAULT '[]',
  -- members: [{"name":"John","email":"john@x.com","phone":"+234...","order":1}]
  current_oncall VARCHAR(255),
  timezone VARCHAR(50) DEFAULT 'Africa/Lagos',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOC Runbooks (automated response procedures) ─────────────────────────────
CREATE TABLE IF NOT EXISTS noc_runbooks (
  id SERIAL PRIMARY KEY,
  runbook_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  trigger_conditions JSONB NOT NULL DEFAULT '{}',
  -- trigger_conditions: {"severity":"critical","source":"snmp","category":"link_down"}
  steps JSONB NOT NULL DEFAULT '[]',
  -- steps: [{"order":1,"action":"restart_service","target":"{{device_id}}","timeout_s":30},
  --         {"order":2,"action":"verify_health","target":"{{device_id}}","timeout_s":10}]
  auto_execute BOOLEAN DEFAULT false,
  last_executed TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0,
  avg_resolution_seconds INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOC Escalation History ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_escalation_history (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(64) NOT NULL REFERENCES noc_alerts(alert_id) ON DELETE CASCADE,
  policy_id INTEGER REFERENCES noc_escalation_policies(id) ON DELETE SET NULL,
  escalation_level INTEGER NOT NULL,
  notified_to VARCHAR(255) NOT NULL,
  notification_channel VARCHAR(30) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  response_time_seconds INTEGER
);

-- ── NOC Collector Metrics (SNMP/Syslog/NetFlow ingestion stats) ──────────────
CREATE TABLE IF NOT EXISTS noc_collector_metrics (
  id SERIAL PRIMARY KEY,
  collector_type VARCHAR(20) NOT NULL CHECK (collector_type IN ('snmp', 'syslog', 'netflow')),
  messages_received BIGINT DEFAULT 0,
  messages_processed BIGINT DEFAULT 0,
  messages_dropped BIGINT DEFAULT 0,
  bytes_ingested BIGINT DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_noc_devices_status ON noc_devices(status);
CREATE INDEX IF NOT EXISTS idx_noc_devices_type ON noc_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_noc_devices_ip ON noc_devices(ip_address);
CREATE INDEX IF NOT EXISTS idx_noc_topology_source ON noc_topology_links(source_device_id);
CREATE INDEX IF NOT EXISTS idx_noc_topology_target ON noc_topology_links(target_device_id);
CREATE INDEX IF NOT EXISTS idx_noc_alerts_severity ON noc_alerts(severity, status);
CREATE INDEX IF NOT EXISTS idx_noc_alerts_source ON noc_alerts(source);
CREATE INDEX IF NOT EXISTS idx_noc_alerts_status ON noc_alerts(status);
CREATE INDEX IF NOT EXISTS idx_noc_alerts_device ON noc_alerts(device_id);
CREATE INDEX IF NOT EXISTS idx_noc_alerts_correlation ON noc_alerts(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_noc_alerts_created ON noc_alerts(first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_noc_uptime_service ON noc_uptime_records(service_name, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_noc_uptime_sla_service ON noc_uptime_sla(service_name, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_noc_escalation_history_alert ON noc_escalation_history(alert_id);
CREATE INDEX IF NOT EXISTS idx_noc_collector_period ON noc_collector_metrics(collector_type, period_start);
