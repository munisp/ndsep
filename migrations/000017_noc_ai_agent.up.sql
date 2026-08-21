-- ============================================================================
-- NDSEP NOC AI Agent Schema
-- ============================================================================
-- Tables for the autonomous AI agent system that proactively detects,
-- diagnoses, and remediates infrastructure issues in real-time.
--
-- Architecture:
--   Perception (Rust) → Reasoning (Python/LLM) → Action (Go) → Learning
-- ============================================================================

-- ── Agent Memory: long-term knowledge store ──────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_agent_memory (
    id SERIAL PRIMARY KEY,
    memory_id VARCHAR(64) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    memory_type VARCHAR(30) NOT NULL CHECK (memory_type IN (
        'incident_pattern', 'root_cause', 'remediation_outcome',
        'service_baseline', 'topology_change', 'threshold_adjustment',
        'correlation_rule', 'runbook_improvement', 'false_positive', 'insight'
    )),
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    source_incident_id VARCHAR(64),
    tags TEXT[] DEFAULT '{}',
    embedding_vector JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Incident Knowledge Graph ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_incident_knowledge (
    id SERIAL PRIMARY KEY,
    knowledge_id VARCHAR(64) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    incident_type VARCHAR(50) NOT NULL,
    symptom_signature JSONB NOT NULL DEFAULT '{}',
    root_cause TEXT NOT NULL,
    root_cause_category VARCHAR(50) NOT NULL CHECK (root_cause_category IN (
        'hardware_failure', 'software_bug', 'configuration_error',
        'capacity_exhaustion', 'network_issue', 'security_incident',
        'dependency_failure', 'human_error', 'environmental', 'unknown'
    )),
    affected_services TEXT[] DEFAULT '{}',
    affected_devices TEXT[] DEFAULT '{}',
    remediation_steps JSONB NOT NULL DEFAULT '[]',
    prevention_measures JSONB DEFAULT '[]',
    avg_detection_time_seconds INTEGER,
    avg_resolution_time_seconds INTEGER,
    occurrence_count INTEGER DEFAULT 1,
    last_occurrence TIMESTAMPTZ,
    success_rate NUMERIC(5,4) DEFAULT 0.0,
    severity_distribution JSONB DEFAULT '{"critical":0,"high":0,"medium":0,"low":0}',
    related_knowledge_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Agent Actions: autonomous remediation log ────────────────────────────────
CREATE TABLE IF NOT EXISTS noc_agent_actions (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(64) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    agent_type VARCHAR(30) NOT NULL CHECK (agent_type IN (
        'perception', 'reasoning', 'action', 'orchestrator'
    )),
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN (
        'anomaly_detected', 'root_cause_analyzed', 'remediation_planned',
        'remediation_executed', 'remediation_verified', 'escalated_to_human',
        'threshold_adjusted', 'runbook_updated', 'knowledge_created',
        'false_positive_marked', 'service_restarted', 'config_rolled_back',
        'traffic_rerouted', 'capacity_scaled', 'alert_suppressed',
        'correlation_discovered', 'prediction_made', 'baseline_updated'
    )),
    alert_id VARCHAR(64),
    correlation_id VARCHAR(64),
    device_id VARCHAR(64),
    affected_service VARCHAR(100),
    description TEXT NOT NULL,
    input_data JSONB DEFAULT '{}',
    output_data JSONB DEFAULT '{}',
    confidence_score NUMERIC(5,4) NOT NULL DEFAULT 0.5,
    was_auto_executed BOOLEAN DEFAULT false,
    human_approved BOOLEAN,
    execution_time_ms INTEGER,
    outcome VARCHAR(20) CHECK (outcome IN (
        'success', 'partial_success', 'failure', 'pending', 'skipped', 'rolled_back'
    )),
    outcome_details TEXT,
    knowledge_id VARCHAR(64),
    parent_action_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Remediation History: detailed execution records ──────────────────────────
CREATE TABLE IF NOT EXISTS noc_remediation_history (
    id SERIAL PRIMARY KEY,
    remediation_id VARCHAR(64) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    alert_id VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64),
    incident_type VARCHAR(50) NOT NULL,
    severity VARCHAR(10) NOT NULL,
    detection_method VARCHAR(30) NOT NULL CHECK (detection_method IN (
        'anomaly_ml', 'threshold_breach', 'pattern_match', 'predictive',
        'correlation', 'user_reported', 'health_check'
    )),
    diagnosis JSONB NOT NULL DEFAULT '{}',
    root_cause_hypothesis TEXT,
    confidence_score NUMERIC(5,4) NOT NULL,
    remediation_plan JSONB NOT NULL DEFAULT '[]',
    steps_executed INTEGER DEFAULT 0,
    steps_total INTEGER DEFAULT 0,
    steps_succeeded INTEGER DEFAULT 0,
    was_autonomous BOOLEAN DEFAULT false,
    human_intervention_required BOOLEAN DEFAULT false,
    human_intervention_reason TEXT,
    time_to_detect_seconds INTEGER,
    time_to_diagnose_seconds INTEGER,
    time_to_remediate_seconds INTEGER,
    time_to_verify_seconds INTEGER,
    total_resolution_seconds INTEGER,
    outcome VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (outcome IN (
        'resolved', 'partially_resolved', 'failed', 'escalated', 'pending', 'rolled_back'
    )),
    lessons_learned TEXT,
    knowledge_updates JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Service Baselines: learned normal behavior per service ───────────────────
CREATE TABLE IF NOT EXISTS noc_service_baselines (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    baseline_period VARCHAR(20) DEFAULT '7d',
    mean_value NUMERIC(12,4) NOT NULL,
    std_deviation NUMERIC(12,4) NOT NULL,
    p50_value NUMERIC(12,4),
    p95_value NUMERIC(12,4),
    p99_value NUMERIC(12,4),
    min_value NUMERIC(12,4),
    max_value NUMERIC(12,4),
    sample_count INTEGER NOT NULL DEFAULT 0,
    anomaly_threshold_sigma NUMERIC(4,2) DEFAULT 3.0,
    last_anomaly_at TIMESTAMPTZ,
    anomaly_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_name, metric_name, baseline_period)
);

-- ── Agent Predictions: proactive issue forecasting ───────────────────────────
CREATE TABLE IF NOT EXISTS noc_agent_predictions (
    id SERIAL PRIMARY KEY,
    prediction_id VARCHAR(64) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
    prediction_type VARCHAR(30) NOT NULL CHECK (prediction_type IN (
        'capacity_exhaustion', 'service_degradation', 'security_threat',
        'sla_breach', 'hardware_failure', 'network_congestion',
        'dependency_failure', 'performance_regression'
    )),
    affected_service VARCHAR(100),
    affected_device VARCHAR(64),
    predicted_event TEXT NOT NULL,
    predicted_time TIMESTAMPTZ,
    confidence_score NUMERIC(5,4) NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    recommended_actions JSONB DEFAULT '[]',
    was_accurate BOOLEAN,
    actual_event_time TIMESTAMPTZ,
    preventive_action_taken BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON noc_agent_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_category ON noc_agent_memory(category);
CREATE INDEX IF NOT EXISTS idx_agent_memory_confidence ON noc_agent_memory(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_tags ON noc_agent_memory USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_incident_knowledge_type ON noc_incident_knowledge(incident_type);
CREATE INDEX IF NOT EXISTS idx_incident_knowledge_category ON noc_incident_knowledge(root_cause_category);
CREATE INDEX IF NOT EXISTS idx_incident_knowledge_success ON noc_incident_knowledge(success_rate DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_type ON noc_agent_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent ON noc_agent_actions(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_actions_alert ON noc_agent_actions(alert_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_auto ON noc_agent_actions(was_auto_executed);
CREATE INDEX IF NOT EXISTS idx_agent_actions_created ON noc_agent_actions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remediation_alert ON noc_remediation_history(alert_id);
CREATE INDEX IF NOT EXISTS idx_remediation_outcome ON noc_remediation_history(outcome);
CREATE INDEX IF NOT EXISTS idx_remediation_autonomous ON noc_remediation_history(was_autonomous);
CREATE INDEX IF NOT EXISTS idx_remediation_created ON noc_remediation_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_baselines_service ON noc_service_baselines(service_name);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON noc_agent_predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_predictions_confidence ON noc_agent_predictions(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_time ON noc_agent_predictions(predicted_time);
