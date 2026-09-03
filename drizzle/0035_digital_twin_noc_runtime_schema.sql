-- Active Drizzle reconciliation for digital-twin and NOC runtime tables.
-- Derived from legacy migrations but intentionally contains schema/index DDL only.
-- No synthetic data, release evidence, or production operational records are inserted here.

-- NOC runtime schema
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

-- Digital-twin runtime schema
-- Digital Twin V2: Production-grade multi-government policy simulation
-- Persistence, jurisdictions, policies, agent-based models, economic indicators

-- ── Jurisdictions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_jurisdictions (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(10) NOT NULL UNIQUE,        -- NG, GH, KE, ZA, EU
    name            VARCHAR(100) NOT NULL,
    region          VARCHAR(50) NOT NULL,               -- West Africa, East Africa, Southern Africa, Europe
    data_protection_act VARCHAR(100),                   -- NDPA, DPA 2012, DPA 2019, POPIA, GDPR
    regulator       VARCHAR(100),                       -- NDPC, DPC Ghana, ODPC Kenya, InfoReg, EDPB
    adequacy_status VARCHAR(20) DEFAULT 'none',         -- none, partial, full, mutual
    population_millions NUMERIC(10,2),
    gdp_usd_billions NUMERIC(12,2),
    digital_economy_pct NUMERIC(5,2),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Policy Definitions (PDL) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_policies (
    id              SERIAL PRIMARY KEY,
    jurisdiction_id INTEGER REFERENCES dt_jurisdictions(id),
    code            VARCHAR(50) NOT NULL,                -- e.g., NDPA-BREACH-SLA-2025
    name            VARCHAR(200) NOT NULL,
    category        VARCHAR(50) NOT NULL,                -- breach_notification, penalties, data_transfer, consent, children_data
    status          VARCHAR(20) DEFAULT 'draft',         -- draft, proposed, enacted, enforced, repealed
    effective_date  DATE,
    expiry_date     DATE,
    rules           JSONB NOT NULL DEFAULT '[]',         -- [{target_sector, metric, operator, threshold, penalty_formula}]
    parameters      JSONB NOT NULL DEFAULT '{}',         -- adjustable params for simulation
    dependencies    JSONB DEFAULT '[]',                  -- policy IDs this depends on
    conflicts_with  JSONB DEFAULT '[]',                  -- policy IDs this conflicts with
    created_by      VARCHAR(100) DEFAULT 'system',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_policies_jurisdiction ON dt_policies(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_dt_policies_category ON dt_policies(category);
CREATE INDEX IF NOT EXISTS idx_dt_policies_status ON dt_policies(status);

-- ── Sector Models (per-jurisdiction) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_sector_models (
    id              SERIAL PRIMARY KEY,
    jurisdiction_id INTEGER REFERENCES dt_jurisdictions(id),
    sector          VARCHAR(50) NOT NULL,
    organizations   INTEGER NOT NULL DEFAULT 0,
    avg_compliance  NUMERIC(5,2) NOT NULL DEFAULT 50.0,
    breach_rate     NUMERIC(5,4) NOT NULL DEFAULT 0.10,
    avg_penalty_local NUMERIC(15,2) DEFAULT 0,
    avg_budget_usd  NUMERIC(12,2) DEFAULT 0,            -- avg security budget per org
    staff_count_avg INTEGER DEFAULT 0,                   -- avg infosec staff per org
    tech_maturity   NUMERIC(3,1) DEFAULT 5.0,            -- 1-10 scale
    data_volume_gb  NUMERIC(12,2) DEFAULT 0,
    cross_border_pct NUMERIC(5,2) DEFAULT 0,
    risk_factors    JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(jurisdiction_id, sector)
);
CREATE INDEX IF NOT EXISTS idx_dt_sector_models_jurisdiction ON dt_sector_models(jurisdiction_id);

-- ── Organization Agents (ABM) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_org_agents (
    id              SERIAL PRIMARY KEY,
    jurisdiction_id INTEGER REFERENCES dt_jurisdictions(id),
    org_name        VARCHAR(200) NOT NULL,
    sector          VARCHAR(50) NOT NULL,
    compliance_score NUMERIC(5,2) DEFAULT 50.0,
    security_budget_usd NUMERIC(12,2) DEFAULT 0,
    infosec_staff   INTEGER DEFAULT 0,
    tech_maturity   NUMERIC(3,1) DEFAULT 5.0,
    risk_appetite   NUMERIC(3,1) DEFAULT 5.0,            -- 1=risk-averse, 10=risk-seeking
    breach_history  INTEGER DEFAULT 0,                    -- past breach count
    penalty_history NUMERIC(15,2) DEFAULT 0,              -- total penalties paid
    data_volume_gb  NUMERIC(12,2) DEFAULT 0,
    cross_border    BOOLEAN DEFAULT FALSE,
    last_audit_date DATE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_org_agents_jurisdiction ON dt_org_agents(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_dt_org_agents_sector ON dt_org_agents(sector);

-- ── Simulation Runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_simulations (
    id              SERIAL PRIMARY KEY,
    simulation_id   VARCHAR(100) NOT NULL UNIQUE,
    name            VARCHAR(200),
    type            VARCHAR(30) NOT NULL,                -- scenario, monte_carlo, counterfactual, sandbox, policy_test
    jurisdictions   JSONB NOT NULL DEFAULT '["NG"]',
    policies        JSONB NOT NULL DEFAULT '[]',         -- policy IDs applied
    parameters      JSONB NOT NULL DEFAULT '{}',
    duration_months INTEGER DEFAULT 12,
    iterations      INTEGER DEFAULT 1,                    -- for Monte Carlo
    status          VARCHAR(20) DEFAULT 'pending',       -- pending, running, completed, failed
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_by      VARCHAR(100) DEFAULT 'system',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_simulations_type ON dt_simulations(type);
CREATE INDEX IF NOT EXISTS idx_dt_simulations_status ON dt_simulations(status);

-- ── Simulation Results (time series) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_simulation_results (
    id              SERIAL PRIMARY KEY,
    simulation_id   VARCHAR(100) REFERENCES dt_simulations(simulation_id),
    jurisdiction    VARCHAR(10) NOT NULL,
    month           INTEGER NOT NULL,
    iteration       INTEGER DEFAULT 1,                    -- for Monte Carlo
    avg_compliance  NUMERIC(5,2),
    breach_count    INTEGER,
    total_penalties_local NUMERIC(15,2),
    cross_border_flows INTEGER,
    gdp_impact_pct  NUMERIC(5,3),
    fdi_confidence  NUMERIC(5,2),                        -- 0-100
    insurance_cost_idx NUMERIC(5,2),                     -- index vs baseline
    sector_data     JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_sim_results_sim ON dt_simulation_results(simulation_id);
CREATE INDEX IF NOT EXISTS idx_dt_sim_results_jurisdiction ON dt_simulation_results(jurisdiction);

-- ── Monte Carlo Aggregates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_monte_carlo_stats (
    id              SERIAL PRIMARY KEY,
    simulation_id   VARCHAR(100) REFERENCES dt_simulations(simulation_id),
    jurisdiction    VARCHAR(10) NOT NULL,
    month           INTEGER NOT NULL,
    metric          VARCHAR(50) NOT NULL,                -- compliance, breaches, penalties, gdp_impact
    p5              NUMERIC(15,4),
    p25             NUMERIC(15,4),
    p50             NUMERIC(15,4),
    p75             NUMERIC(15,4),
    p95             NUMERIC(15,4),
    mean            NUMERIC(15,4),
    std_dev         NUMERIC(15,4),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_mc_stats_sim ON dt_monte_carlo_stats(simulation_id);

-- ── Policy Impact Analysis ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_policy_impacts (
    id              SERIAL PRIMARY KEY,
    simulation_id   VARCHAR(100) REFERENCES dt_simulations(simulation_id),
    policy_id       INTEGER REFERENCES dt_policies(id),
    jurisdiction    VARCHAR(10) NOT NULL,
    sector          VARCHAR(50),                          -- NULL = all sectors
    compliance_delta NUMERIC(5,2),
    breach_delta_pct NUMERIC(5,2),
    penalty_delta_local NUMERIC(15,2),
    cost_benefit_ratio NUMERIC(8,4),                     -- benefit per unit cost
    effectiveness_score NUMERIC(5,2),                    -- 0-100
    sensitivity_rank INTEGER,                            -- which param matters most
    recommendations JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dt_policy_impacts_sim ON dt_policy_impacts(simulation_id);
CREATE INDEX IF NOT EXISTS idx_dt_policy_impacts_policy ON dt_policy_impacts(policy_id);

-- ── Economic Indicators ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_economic_indicators (
    id              SERIAL PRIMARY KEY,
    jurisdiction    VARCHAR(10) NOT NULL,
    year            INTEGER NOT NULL,
    quarter         INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    gdp_usd_billions NUMERIC(12,2),
    digital_economy_usd_billions NUMERIC(12,2),
    fdi_inflow_usd_billions NUMERIC(12,2),
    cyber_insurance_premium_idx NUMERIC(5,2),            -- index 100 = baseline
    data_breach_cost_avg_usd NUMERIC(12,2),
    compliance_spending_usd_millions NUMERIC(12,2),
    data_localization_cost_usd_millions NUMERIC(12,2),
    cross_border_trade_volume_usd_billions NUMERIC(12,2),
    source          VARCHAR(50) DEFAULT 'synthetic',     -- synthetic, cbn, nbs, worldbank
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(jurisdiction, year, quarter)
);
CREATE INDEX IF NOT EXISTS idx_dt_econ_jurisdiction ON dt_economic_indicators(jurisdiction);

-- ── Regulatory Sandbox ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_sandboxes (
    id              SERIAL PRIMARY KEY,
    sandbox_id      VARCHAR(100) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    base_snapshot   JSONB NOT NULL,                      -- frozen state at fork time
    policies_applied JSONB DEFAULT '[]',
    status          VARCHAR(20) DEFAULT 'active',        -- active, completed, archived
    created_by      VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

-- ── Cross-Border Policy Agreements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dt_bilateral_agreements (
    id              SERIAL PRIMARY KEY,
    jurisdiction_a  VARCHAR(10) NOT NULL,
    jurisdiction_b  VARCHAR(10) NOT NULL,
    agreement_type  VARCHAR(50) NOT NULL,                -- adequacy, mutual_recognition, data_sharing, joint_enforcement
    status          VARCHAR(20) DEFAULT 'active',
    signed_date     DATE,
    provisions      JSONB DEFAULT '{}',
    impact_on_flows NUMERIC(5,2) DEFAULT 0,              -- % change in cross-border volume
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
