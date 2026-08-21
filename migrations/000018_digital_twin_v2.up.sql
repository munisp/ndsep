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
CREATE INDEX idx_dt_policies_jurisdiction ON dt_policies(jurisdiction_id);
CREATE INDEX idx_dt_policies_category ON dt_policies(category);
CREATE INDEX idx_dt_policies_status ON dt_policies(status);

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
CREATE INDEX idx_dt_sector_models_jurisdiction ON dt_sector_models(jurisdiction_id);

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
CREATE INDEX idx_dt_org_agents_jurisdiction ON dt_org_agents(jurisdiction_id);
CREATE INDEX idx_dt_org_agents_sector ON dt_org_agents(sector);

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
CREATE INDEX idx_dt_simulations_type ON dt_simulations(type);
CREATE INDEX idx_dt_simulations_status ON dt_simulations(status);

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
CREATE INDEX idx_dt_sim_results_sim ON dt_simulation_results(simulation_id);
CREATE INDEX idx_dt_sim_results_jurisdiction ON dt_simulation_results(jurisdiction);

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
CREATE INDEX idx_dt_mc_stats_sim ON dt_monte_carlo_stats(simulation_id);

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
CREATE INDEX idx_dt_policy_impacts_sim ON dt_policy_impacts(simulation_id);
CREATE INDEX idx_dt_policy_impacts_policy ON dt_policy_impacts(policy_id);

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
CREATE INDEX idx_dt_econ_jurisdiction ON dt_economic_indicators(jurisdiction);

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

-- ── Seed jurisdictions ─────────────────────────────────────────────────────
INSERT INTO dt_jurisdictions (code, name, region, data_protection_act, regulator, adequacy_status, population_millions, gdp_usd_billions, digital_economy_pct) VALUES
('NG', 'Nigeria', 'West Africa', 'Nigeria Data Protection Act 2023', 'NDPC', 'none', 223.80, 477.39, 17.3),
('GH', 'Ghana', 'West Africa', 'Data Protection Act 2012', 'Data Protection Commission', 'none', 33.48, 72.84, 12.1),
('KE', 'Kenya', 'East Africa', 'Data Protection Act 2019', 'ODPC', 'none', 54.03, 110.35, 9.8),
('ZA', 'South Africa', 'Southern Africa', 'POPIA 2013', 'Information Regulator', 'partial', 60.41, 399.02, 15.7),
('EU', 'European Union', 'Europe', 'GDPR 2016/679', 'EDPB', 'full', 448.40, 16800.00, 35.2),
('RW', 'Rwanda', 'East Africa', 'Law N° 058/2021', 'NCSA', 'none', 13.46, 13.31, 8.5),
('SN', 'Senegal', 'West Africa', 'Loi 2008-12', 'CDP', 'none', 17.76, 28.04, 7.2),
('TZ', 'Tanzania', 'East Africa', 'Personal Data Protection Act 2022', 'PDPA', 'none', 65.50, 75.71, 6.9)
ON CONFLICT (code) DO NOTHING;

-- ── Seed sector models for Nigeria ─────────────────────────────────────────
INSERT INTO dt_sector_models (jurisdiction_id, sector, organizations, avg_compliance, breach_rate, avg_penalty_local, avg_budget_usd, staff_count_avg, tech_maturity, data_volume_gb, cross_border_pct, risk_factors) VALUES
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Banking', 45, 78.5, 0.12, 5200000, 850000, 12, 7.5, 45000, 35.0, '["high-value transactions","cross-border transfers","mobile banking growth"]'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Telecom', 12, 72.3, 0.08, 3800000, 1200000, 18, 7.0, 180000, 25.0, '["massive subscriber data","location tracking","USSD data"]'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Healthcare', 28, 65.1, 0.15, 4500000, 120000, 3, 4.5, 8000, 8.0, '["sensitive health data","legacy systems","interoperability gaps"]'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Insurance', 35, 70.8, 0.09, 2900000, 350000, 6, 5.5, 12000, 15.0, '["health data processing","third-party underwriters","claims fraud detection"]'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Energy', 18, 68.9, 0.06, 1500000, 200000, 4, 5.0, 6000, 5.0, '["smart meter data","SCADA systems","rural access gaps"]'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'Education', 60, 55.2, 0.18, 800000, 25000, 1, 3.0, 15000, 12.0, '["student records","edtech platforms","low security budgets"]'),
-- Ghana sectors
((SELECT id FROM dt_jurisdictions WHERE code='GH'), 'Banking', 23, 71.2, 0.14, 200000, 320000, 5, 6.0, 12000, 28.0, '["mobile money dominance","cross-border ECOWAS","fintech growth"]'),
((SELECT id FROM dt_jurisdictions WHERE code='GH'), 'Telecom', 6, 68.5, 0.10, 150000, 450000, 8, 6.5, 45000, 20.0, '["MTN/Vodafone duopoly","mobile money data","SIM registration"]'),
((SELECT id FROM dt_jurisdictions WHERE code='GH'), 'Healthcare', 15, 52.3, 0.20, 80000, 40000, 2, 3.5, 3000, 5.0, '["NHIS data","rural health posts","paper records digitization"]'),
-- Kenya sectors
((SELECT id FROM dt_jurisdictions WHERE code='KE'), 'Banking', 42, 74.8, 0.11, 5000000, 650000, 10, 7.0, 35000, 32.0, '["M-Pesa ecosystem","EAC cross-border","digital lending"]'),
((SELECT id FROM dt_jurisdictions WHERE code='KE'), 'Telecom', 4, 70.1, 0.09, 3500000, 900000, 15, 7.5, 120000, 22.0, '["Safaricom dominance","M-Pesa integration","fiber expansion"]'),
((SELECT id FROM dt_jurisdictions WHERE code='KE'), 'Healthcare', 20, 58.7, 0.17, 1200000, 80000, 2, 4.0, 5000, 6.0, '["NHIF digitization","telemedicine growth","county health systems"]'),
-- South Africa sectors
((SELECT id FROM dt_jurisdictions WHERE code='ZA'), 'Banking', 35, 82.1, 0.08, 25000000, 2500000, 25, 8.5, 85000, 40.0, '["JSE-listed banks","SWIFT integration","wealth management data"]'),
((SELECT id FROM dt_jurisdictions WHERE code='ZA'), 'Telecom', 8, 76.4, 0.07, 18000000, 1800000, 20, 8.0, 200000, 30.0, '["Vodacom/MTN SA","fiber-to-home","OTT regulation"]'),
((SELECT id FROM dt_jurisdictions WHERE code='ZA'), 'Healthcare', 30, 68.3, 0.12, 8000000, 300000, 5, 5.5, 25000, 10.0, '["NHI transition","medical schemes data","e-prescribing"]')
ON CONFLICT (jurisdiction_id, sector) DO NOTHING;

-- ── Seed economic indicators ───────────────────────────────────────────────
INSERT INTO dt_economic_indicators (jurisdiction, year, quarter, gdp_usd_billions, digital_economy_usd_billions, fdi_inflow_usd_billions, cyber_insurance_premium_idx, data_breach_cost_avg_usd, compliance_spending_usd_millions, cross_border_trade_volume_usd_billions) VALUES
('NG', 2025, 1, 119.35, 20.65, 1.23, 100.0, 2800000, 45.5, 8.2),
('NG', 2025, 2, 121.50, 21.30, 1.35, 102.5, 2900000, 48.2, 8.5),
('GH', 2025, 1, 18.21, 2.20, 0.45, 100.0, 850000, 8.3, 2.1),
('KE', 2025, 1, 27.59, 2.70, 0.52, 100.0, 1200000, 12.5, 3.4),
('ZA', 2025, 1, 99.76, 15.66, 2.10, 100.0, 4500000, 85.0, 18.5),
('EU', 2025, 1, 4200.00, 1470.00, 125.00, 100.0, 4350000, 12500.0, 850.0)
ON CONFLICT (jurisdiction, year, quarter) DO NOTHING;

-- ── Seed bilateral agreements ──────────────────────────────────────────────
INSERT INTO dt_bilateral_agreements (jurisdiction_a, jurisdiction_b, agreement_type, status, signed_date, provisions, impact_on_flows) VALUES
('NG', 'GH', 'data_sharing', 'active', '2024-03-15', '{"scope":"financial_data","encryption":"required","audit":"quarterly"}', 15.0),
('NG', 'KE', 'mutual_recognition', 'proposed', NULL, '{"scope":"compliance_certificates","recognition":"bilateral"}', 8.0),
('ZA', 'EU', 'adequacy', 'active', '2023-07-01', '{"scope":"full","review_period":"4_years","conditions":["POPIA_enforcement"]}', 25.0),
('KE', 'EU', 'adequacy', 'proposed', NULL, '{"scope":"partial","sectors":["banking","telecom"]}', 12.0),
('NG', 'EU', 'adequacy', 'draft', NULL, '{"scope":"partial","blockers":["enforcement_track_record","judicial_oversight"]}', 0.0),
('GH', 'KE', 'data_sharing', 'active', '2024-09-01', '{"scope":"health_data","purpose":"pandemic_response"}', 5.0)
ON CONFLICT DO NOTHING;

-- ── Seed sample policies ───────────────────────────────────────────────────
INSERT INTO dt_policies (jurisdiction_id, code, name, category, status, effective_date, rules, parameters) VALUES
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'NDPA-BREACH-72H', 'NDPA Breach Notification (72h)', 'breach_notification', 'enforced', '2024-01-01',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":72,"penalty_formula":"base * 1.0"}]',
 '{"breach_sla_hours":72,"penalty_multiplier":1.0}'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'NDPA-BREACH-24H', 'Proposed: Tighten to 24h', 'breach_notification', 'proposed', '2026-01-01',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":24,"penalty_formula":"base * 1.5"}]',
 '{"breach_sla_hours":24,"penalty_multiplier":1.5}'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'NDPA-PEN-DOUBLE', 'Proposed: Double Penalties', 'penalties', 'proposed', '2026-06-01',
 '[{"target_sector":"*","metric":"max_penalty","operator":"*","threshold":2.0,"penalty_formula":"base * 2.0"}]',
 '{"penalty_multiplier":2.0}'),
((SELECT id FROM dt_jurisdictions WHERE code='NG'), 'NDPA-EDU-CRACK', 'Education Sector Crackdown', 'children_data', 'proposed', '2026-03-01',
 '[{"target_sector":"Education","metric":"min_compliance","operator":">=","threshold":75,"penalty_formula":"base * 3.0 + license_suspension"}]',
 '{"compliance_threshold":75,"penalty_multiplier":3.0}'),
((SELECT id FROM dt_jurisdictions WHERE code='EU'), 'GDPR-BREACH-72H', 'GDPR Art.33 Breach Notification', 'breach_notification', 'enforced', '2018-05-25',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":72,"penalty_formula":"max(10M_EUR, 2pct_revenue)"}]',
 '{"breach_sla_hours":72,"penalty_multiplier":1.0}'),
((SELECT id FROM dt_jurisdictions WHERE code='GH'), 'GH-DPA-BREACH', 'Ghana DPA Breach Notification', 'breach_notification', 'enforced', '2012-10-01',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":168,"penalty_formula":"base * 0.5"}]',
 '{"breach_sla_hours":168,"penalty_multiplier":0.5}'),
((SELECT id FROM dt_jurisdictions WHERE code='KE'), 'KE-DPA-BREACH', 'Kenya DPA Breach Notification', 'breach_notification', 'enforced', '2021-11-25',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":72,"penalty_formula":"max(5M_KES, 1pct_revenue)"}]',
 '{"breach_sla_hours":72,"penalty_multiplier":1.0}'),
((SELECT id FROM dt_jurisdictions WHERE code='ZA'), 'POPIA-BREACH', 'POPIA Breach Notification', 'breach_notification', 'enforced', '2021-07-01',
 '[{"target_sector":"*","metric":"breach_notification_hours","operator":"<=","threshold":0,"penalty_formula":"10M_ZAR_or_imprisonment"}]',
 '{"breach_sla_hours":0,"penalty_multiplier":2.0}')
ON CONFLICT DO NOTHING;
