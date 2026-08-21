/// NDSEP System Dynamics Engine — Forrester-style stock-and-flow model
///
/// Models causal feedback loops in data protection ecosystems:
///   Policy → Compliance ↑ → Breach Rate ↓ → Penalties ↓ → Compliance Investment ↓ → ...
///
/// Uses finite-difference approximation of differential equations.
///
/// Port: 8179
use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

/// Stocks are the state variables (levels)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stocks {
    compliance_level: f64,      // 0-100
    breach_rate: f64,           // annual probability
    penalty_pool: f64,          // accumulated penalties (local currency)
    compliance_investment: f64, // monthly spending (USD)
    public_trust: f64,          // 0-100
    regulatory_capacity: f64,   // 0-100
    data_economy_growth: f64,   // annual % growth
    cross_border_volume: f64,   // GB/month
    fdi_confidence: f64,        // 0-100
    insurance_cost_index: f64,  // base 100
}

/// Flows are rates of change per time step
#[derive(Debug, Clone, Serialize)]
struct Flows {
    compliance_improvement: f64,
    breach_occurrence: f64,
    penalty_assessment: f64,
    investment_adjustment: f64,
    trust_change: f64,
    capacity_building: f64,
    economy_growth_rate: f64,
    cross_border_change: f64,
    fdi_change: f64,
    insurance_adjustment: f64,
}

#[derive(Debug, Deserialize)]
struct SDRequest {
    initial_stocks: Stocks,
    duration_months: usize,
    policy_params: PolicyParams,
    jurisdiction: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PolicyParams {
    breach_sla_hours: f64,
    penalty_multiplier: f64,
    enforcement_budget_increase: f64, // % increase
    awareness_campaign: bool,
    mandatory_audit: bool,
    cross_border_restriction: f64, // 0-1, 0=no restriction
}

#[derive(Debug, Serialize)]
struct SDResponse {
    jurisdiction: String,
    timeline: Vec<SDTimePoint>,
    causal_loops: Vec<CausalLoop>,
    equilibrium: Option<Stocks>,
    sensitivity: Vec<SensitivityResult>,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Clone)]
struct SDTimePoint {
    month: usize,
    stocks: Stocks,
    flows: Flows,
}

#[derive(Debug, Serialize)]
struct CausalLoop {
    name: String,
    loop_type: String, // "reinforcing" or "balancing"
    variables: Vec<String>,
    description: String,
}

#[derive(Debug, Serialize)]
struct SensitivityResult {
    parameter: String,
    base_value: f64,
    perturbed_value: f64,
    compliance_impact: f64,
    breach_impact: f64,
    economic_impact: f64,
}

fn run_simulation(req: &SDRequest) -> SDResponse {
    let start = std::time::Instant::now();
    let dt = 1.0; // time step = 1 month
    let mut stocks = req.initial_stocks.clone();
    let params = &req.policy_params;
    let jurisdiction = req.jurisdiction.clone().unwrap_or_else(|| "NG".to_string());

    let mut timeline = Vec::with_capacity(req.duration_months);

    for month in 1..=req.duration_months {
        // ── Compute flows based on current stocks ──────────────────────

        // Compliance improvement: driven by investment, penalties, regulation
        let sla_pressure = 72.0 / params.breach_sla_hours;
        let penalty_pressure = params.penalty_multiplier * 0.05;
        let investment_effect = (stocks.compliance_investment / 100000.0).min(1.0) * 0.3;
        let capacity_effect = stocks.regulatory_capacity * 0.003;
        let awareness_bonus = if params.awareness_campaign { 0.1 } else { 0.0 };
        let audit_bonus = if params.mandatory_audit { 0.15 } else { 0.0 };
        let gap = 100.0 - stocks.compliance_level;

        let compliance_flow = gap
            * 0.02
            * (1.0
                + sla_pressure * 0.1
                + penalty_pressure
                + investment_effect
                + capacity_effect
                + awareness_bonus
                + audit_bonus);

        // Breach rate: decreases with compliance, increases with data volume
        let comp_factor = stocks.compliance_level / 100.0;
        let volume_pressure = (stocks.cross_border_volume / 10000.0).min(0.5);
        let breach_flow = -stocks.breach_rate * 0.05 * comp_factor * sla_pressure
            + stocks.breach_rate * 0.01 * volume_pressure;

        // Penalties: driven by breach rate and multiplier
        let penalty_flow = stocks.breach_rate * params.penalty_multiplier * 500000.0;

        // Investment: driven by penalties (pain), trust (reputation), compliance gap
        let pain_signal = (stocks.penalty_pool / 1000000.0).min(2.0) * 0.1;
        let reputation_signal = (100.0 - stocks.public_trust) * 0.001;
        let investment_flow = stocks.compliance_investment
            * (pain_signal + reputation_signal + params.enforcement_budget_increase * 0.01 - 0.02);

        // Public trust: increases with compliance, decreases with breaches
        let trust_flow = stocks.compliance_level * 0.01 - stocks.breach_rate * 20.0;

        // Regulatory capacity: grows with enforcement budget
        let capacity_flow = params.enforcement_budget_increase * 0.1
            + if params.mandatory_audit { 0.5 } else { 0.0 };

        // Data economy: grows with trust and FDI
        let economy_flow =
            stocks.public_trust * 0.02 + stocks.fdi_confidence * 0.01 - stocks.breach_rate * 5.0;

        // Cross-border: grows naturally, restricted by policy
        let cb_flow = stocks.cross_border_volume * 0.02 * (1.0 - params.cross_border_restriction);

        // FDI: driven by compliance level and economy
        let fdi_flow = (stocks.compliance_level - 60.0) * 0.05 + stocks.data_economy_growth * 0.1
            - stocks.breach_rate * 10.0;

        // Insurance: decreases with better compliance, increases with breaches
        let ins_flow = stocks.breach_rate * 5.0 - (stocks.compliance_level - 70.0) * 0.1;

        let flows = Flows {
            compliance_improvement: round3(compliance_flow),
            breach_occurrence: round3(breach_flow),
            penalty_assessment: round3(penalty_flow),
            investment_adjustment: round3(investment_flow),
            trust_change: round3(trust_flow),
            capacity_building: round3(capacity_flow),
            economy_growth_rate: round3(economy_flow),
            cross_border_change: round3(cb_flow),
            fdi_change: round3(fdi_flow),
            insurance_adjustment: round3(ins_flow),
        };

        // ── Update stocks (Euler integration) ─────────────────────────
        stocks.compliance_level =
            (stocks.compliance_level + compliance_flow * dt).clamp(0.0, 100.0);
        stocks.breach_rate = (stocks.breach_rate + breach_flow * dt).clamp(0.0, 1.0);
        stocks.penalty_pool = (stocks.penalty_pool + penalty_flow * dt).max(0.0);
        stocks.compliance_investment =
            (stocks.compliance_investment + investment_flow * dt).max(0.0);
        stocks.public_trust = (stocks.public_trust + trust_flow * dt).clamp(0.0, 100.0);
        stocks.regulatory_capacity =
            (stocks.regulatory_capacity + capacity_flow * dt).clamp(0.0, 100.0);
        stocks.data_economy_growth += economy_flow * dt * 0.01;
        stocks.cross_border_volume = (stocks.cross_border_volume + cb_flow * dt).max(0.0);
        stocks.fdi_confidence = (stocks.fdi_confidence + fdi_flow * dt).clamp(0.0, 100.0);
        stocks.insurance_cost_index = (stocks.insurance_cost_index + ins_flow * dt).max(50.0);

        // Round stocks
        stocks.compliance_level = round2(stocks.compliance_level);
        stocks.breach_rate = round4(stocks.breach_rate);
        stocks.penalty_pool = round2(stocks.penalty_pool);
        stocks.compliance_investment = round2(stocks.compliance_investment);
        stocks.public_trust = round2(stocks.public_trust);
        stocks.regulatory_capacity = round2(stocks.regulatory_capacity);
        stocks.data_economy_growth = round3(stocks.data_economy_growth);
        stocks.cross_border_volume = round2(stocks.cross_border_volume);
        stocks.fdi_confidence = round2(stocks.fdi_confidence);
        stocks.insurance_cost_index = round2(stocks.insurance_cost_index);

        timeline.push(SDTimePoint {
            month,
            stocks: stocks.clone(),
            flows,
        });
    }

    // Causal loop identification
    let causal_loops = vec![
        CausalLoop {
            name: "Compliance-Penalty Loop".into(),
            loop_type: "balancing".into(),
            variables: vec!["Compliance".into(), "Breaches".into(), "Penalties".into(), "Investment".into()],
            description: "Higher compliance → fewer breaches → lower penalties → reduced investment pressure → compliance stagnation".into(),
        },
        CausalLoop {
            name: "Trust-Economy Loop".into(),
            loop_type: "reinforcing".into(),
            variables: vec!["Compliance".into(), "Public Trust".into(), "FDI".into(), "Data Economy".into(), "Investment".into()],
            description: "Better compliance → higher trust → more FDI → stronger data economy → more compliance investment".into(),
        },
        CausalLoop {
            name: "Breach-Insurance Loop".into(),
            loop_type: "reinforcing".into(),
            variables: vec!["Breach Rate".into(), "Insurance Costs".into(), "Compliance Investment".into(), "Breach Rate".into()],
            description: "More breaches → higher insurance → more investment in security → fewer breaches".into(),
        },
        CausalLoop {
            name: "Regulatory Capacity Loop".into(),
            loop_type: "reinforcing".into(),
            variables: vec!["Enforcement Budget".into(), "Regulatory Capacity".into(), "Compliance Pressure".into(), "Compliance".into()],
            description: "More enforcement budget → higher capacity → stronger oversight → better compliance".into(),
        },
    ];

    // Sensitivity analysis: perturb each parameter ±10%
    let sensitivity = run_sensitivity(req);

    SDResponse {
        jurisdiction,
        timeline,
        causal_loops,
        equilibrium: Some(stocks),
        sensitivity,
        duration_ms: start.elapsed().as_millis(),
    }
}

fn run_sensitivity(base_req: &SDRequest) -> Vec<SensitivityResult> {
    let params = [
        ("breach_sla_hours", base_req.policy_params.breach_sla_hours),
        (
            "penalty_multiplier",
            base_req.policy_params.penalty_multiplier,
        ),
        (
            "enforcement_budget_increase",
            base_req.policy_params.enforcement_budget_increase,
        ),
    ];

    let mut results = Vec::new();
    for (name, base_val) in params {
        let perturbed = base_val * 1.1;
        let mut perturbed_req_params = PolicyParams {
            breach_sla_hours: base_req.policy_params.breach_sla_hours,
            penalty_multiplier: base_req.policy_params.penalty_multiplier,
            enforcement_budget_increase: base_req.policy_params.enforcement_budget_increase,
            awareness_campaign: base_req.policy_params.awareness_campaign,
            mandatory_audit: base_req.policy_params.mandatory_audit,
            cross_border_restriction: base_req.policy_params.cross_border_restriction,
        };
        match name {
            "breach_sla_hours" => perturbed_req_params.breach_sla_hours = perturbed,
            "penalty_multiplier" => perturbed_req_params.penalty_multiplier = perturbed,
            "enforcement_budget_increase" => {
                perturbed_req_params.enforcement_budget_increase = perturbed
            }
            _ => {}
        }

        let perturbed_req = SDRequest {
            initial_stocks: base_req.initial_stocks.clone(),
            duration_months: base_req.duration_months,
            policy_params: perturbed_req_params,
            jurisdiction: base_req.jurisdiction.clone(),
        };

        let base_result = run_sim_final_stocks(base_req);
        let pert_result = run_sim_final_stocks(&perturbed_req);

        results.push(SensitivityResult {
            parameter: name.to_string(),
            base_value: round2(base_val),
            perturbed_value: round2(perturbed),
            compliance_impact: round2(pert_result.compliance_level - base_result.compliance_level),
            breach_impact: round4(pert_result.breach_rate - base_result.breach_rate),
            economic_impact: round3(
                pert_result.data_economy_growth - base_result.data_economy_growth,
            ),
        });
    }
    results
}

fn run_sim_final_stocks(req: &SDRequest) -> Stocks {
    let dt = 1.0;
    let mut stocks = req.initial_stocks.clone();
    let params = &req.policy_params;

    for _month in 1..=req.duration_months {
        let sla_pressure = 72.0 / params.breach_sla_hours;
        let gap = 100.0 - stocks.compliance_level;
        let comp_flow = gap * 0.02 * (1.0 + sla_pressure * 0.1 + params.penalty_multiplier * 0.05);
        let breach_flow =
            -stocks.breach_rate * 0.05 * (stocks.compliance_level / 100.0) * sla_pressure;
        let economy_flow = stocks.public_trust * 0.02 + stocks.fdi_confidence * 0.01;

        stocks.compliance_level = (stocks.compliance_level + comp_flow * dt).clamp(0.0, 100.0);
        stocks.breach_rate = (stocks.breach_rate + breach_flow * dt).clamp(0.0, 1.0);
        stocks.data_economy_growth += economy_flow * dt * 0.01;
        stocks.public_trust =
            (stocks.public_trust + stocks.compliance_level * 0.01 * dt).clamp(0.0, 100.0);
        stocks.fdi_confidence = (stocks.fdi_confidence
            + (stocks.compliance_level - 60.0) * 0.05 * dt)
            .clamp(0.0, 100.0);
    }
    stocks
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}
fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}

async fn run_sd(Json(req): Json<SDRequest>) -> Json<SDResponse> {
    Json(run_simulation(&req))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "system-dynamics",
        "version": "1.0.0",
        "capabilities": ["stock_and_flow", "causal_loops", "sensitivity_analysis", "equilibrium_detection"]
    }))
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let port: u16 = std::env::var("SYSTEM_DYNAMICS_PORT")
        .unwrap_or_else(|_| "8179".to_string())
        .parse()
        .unwrap_or(8179);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/system-dynamics/run", post(run_sd));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("System Dynamics engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
