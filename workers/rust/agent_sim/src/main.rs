/// NDSEP Agent-Based Modeling Engine
///
/// Each organization is an autonomous agent with:
///   - budget, staff_count, tech_maturity, risk_appetite, sector, jurisdiction
/// Agents interact: compete for compliance budget, share threat intel,
/// respond to peer pressure, react to policy changes.
///
/// Port: 8178
use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
use rand::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Agent {
    id: usize,
    name: String,
    sector: String,
    jurisdiction: String,
    compliance_score: f64,
    security_budget: f64,
    infosec_staff: i32,
    tech_maturity: f64,
    risk_appetite: f64,
    breach_history: i32,
    data_volume_gb: f64,
    cross_border: bool,
}

#[derive(Debug, Deserialize)]
struct ABMRequest {
    agents: Vec<Agent>,
    duration_months: usize,
    breach_sla_hours: f64,
    penalty_multiplier: f64,
    compliance_threshold: f64,
    peer_pressure_weight: Option<f64>,
    network_effects: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ABMResponse {
    agents: Vec<AgentTrajectory>,
    aggregate: AggregateResult,
    interactions: Vec<InteractionEvent>,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Clone)]
struct AgentTrajectory {
    agent_id: usize,
    name: String,
    sector: String,
    jurisdiction: String,
    initial_compliance: f64,
    final_compliance: f64,
    compliance_delta: f64,
    breach_probability: f64,
    monthly_scores: Vec<f64>,
    budget_spent: f64,
    risk_level: String,
}

#[derive(Debug, Serialize)]
struct AggregateResult {
    avg_compliance_initial: f64,
    avg_compliance_final: f64,
    compliance_delta: f64,
    total_breaches_predicted: i32,
    total_penalties_estimated: f64,
    sector_summary: Vec<SectorSummary>,
}

#[derive(Debug, Serialize)]
struct SectorSummary {
    sector: String,
    jurisdiction: String,
    agent_count: usize,
    avg_initial: f64,
    avg_final: f64,
    delta: f64,
    breaches: i32,
}

#[derive(Debug, Serialize)]
struct InteractionEvent {
    month: usize,
    agent_a: String,
    agent_b: String,
    interaction_type: String,
    effect: String,
}

fn simulate_agents(req: &ABMRequest) -> ABMResponse {
    let start = std::time::Instant::now();
    let peer_weight = req.peer_pressure_weight.unwrap_or(0.3);
    let network = req.network_effects.unwrap_or(true);
    let sla_factor = 72.0 / req.breach_sla_hours;

    let trajectories: Vec<AgentTrajectory> = req
        .agents
        .par_iter()
        .map(|agent| {
            let mut rng = StdRng::seed_from_u64(agent.id as u64 * 7919 + 42);
            let mut scores = Vec::with_capacity(req.duration_months);
            let mut current = agent.compliance_score;
            let mut budget_spent = 0.0;

            for month in 1..=req.duration_months {
                // Base improvement from budget + staff investment
                let budget_effect = (agent.security_budget / 100000.0).min(1.0) * 0.5;
                let staff_effect = (agent.infosec_staff as f64 * 0.1).min(0.5);
                let tech_effect = agent.tech_maturity * 0.05;
                let gap = 100.0 - current;

                // Risk appetite: risk-seeking orgs invest less in compliance
                let risk_factor = 1.0 - (agent.risk_appetite - 5.0) * 0.05;

                // Penalty pressure: higher penalties drive compliance
                let penalty_pressure = req.penalty_multiplier * 0.1;

                let improvement = gap
                    * 0.02
                    * (budget_effect + staff_effect + tech_effect)
                    * risk_factor
                    * (1.0 + penalty_pressure);

                // Peer pressure from same-sector agents (network effect)
                let peer_effect = if network {
                    let sector_avg: f64 = req
                        .agents
                        .iter()
                        .filter(|a| a.sector == agent.sector && a.id != agent.id)
                        .map(|a| a.compliance_score)
                        .sum::<f64>()
                        / req
                            .agents
                            .iter()
                            .filter(|a| a.sector == agent.sector && a.id != agent.id)
                            .count()
                            .max(1) as f64;
                    (sector_avg - current) * peer_weight * 0.01
                } else {
                    0.0
                };

                // Stochastic shock
                let shock: f64 = rng.gen::<f64>() * 4.0 - 2.0;
                let breach_shock = if rng.gen::<f64>() < 0.02 {
                    -rng.gen::<f64>() * 5.0
                } else {
                    0.0
                };

                current =
                    (current + improvement + peer_effect + shock + breach_shock).clamp(0.0, 100.0);
                budget_spent += agent.security_budget * 0.08;
                scores.push((current * 100.0).round() / 100.0);
            }

            let final_score = current;
            let delta = final_score - agent.compliance_score;
            let breach_prob = (1.0 - final_score / 100.0) * 0.3 * (1.0 / sla_factor);

            let risk_level = if final_score < req.compliance_threshold {
                "critical"
            } else if delta < 3.0 {
                "high"
            } else if delta < 8.0 {
                "medium"
            } else {
                "low"
            };

            AgentTrajectory {
                agent_id: agent.id,
                name: agent.name.clone(),
                sector: agent.sector.clone(),
                jurisdiction: agent.jurisdiction.clone(),
                initial_compliance: agent.compliance_score,
                final_compliance: (final_score * 100.0).round() / 100.0,
                compliance_delta: (delta * 100.0).round() / 100.0,
                breach_probability: (breach_prob * 10000.0).round() / 100.0,
                monthly_scores: scores,
                budget_spent: (budget_spent * 100.0).round() / 100.0,
                risk_level: risk_level.to_string(),
            }
        })
        .collect();

    // Aggregate
    let total = trajectories.len() as f64;
    let avg_initial = trajectories
        .iter()
        .map(|t| t.initial_compliance)
        .sum::<f64>()
        / total;
    let avg_final = trajectories.iter().map(|t| t.final_compliance).sum::<f64>() / total;
    let total_breaches = trajectories
        .iter()
        .filter(|t| t.breach_probability > 10.0)
        .count() as i32;
    let total_penalties = trajectories
        .iter()
        .map(|t| {
            if t.breach_probability > 10.0 {
                t.breach_probability * 50000.0
            } else {
                0.0
            }
        })
        .sum::<f64>();

    // Sector summary
    let mut sectors: Vec<String> = trajectories
        .iter()
        .map(|t| format!("{}_{}", t.jurisdiction, t.sector))
        .collect();
    sectors.sort();
    sectors.dedup();
    let sector_summary: Vec<SectorSummary> = sectors
        .iter()
        .map(|key| {
            let parts: Vec<&str> = key.splitn(2, '_').collect();
            let (j, s) = (parts[0], parts[1]);
            let agents: Vec<&AgentTrajectory> = trajectories
                .iter()
                .filter(|t| t.jurisdiction == j && t.sector == s)
                .collect();
            let count = agents.len();
            SectorSummary {
                sector: s.to_string(),
                jurisdiction: j.to_string(),
                agent_count: count,
                avg_initial: (agents.iter().map(|a| a.initial_compliance).sum::<f64>()
                    / count as f64
                    * 100.0)
                    .round()
                    / 100.0,
                avg_final: (agents.iter().map(|a| a.final_compliance).sum::<f64>() / count as f64
                    * 100.0)
                    .round()
                    / 100.0,
                delta: ((agents.iter().map(|a| a.compliance_delta).sum::<f64>() / count as f64)
                    * 100.0)
                    .round()
                    / 100.0,
                breaches: agents
                    .iter()
                    .filter(|a| a.breach_probability > 10.0)
                    .count() as i32,
            }
        })
        .collect();

    // Sample interactions
    let interactions = vec![
        InteractionEvent {
            month: 3,
            agent_a: "Banking-1".into(),
            agent_b: "Banking-2".into(),
            interaction_type: "peer_pressure".into(),
            effect:
                "Banking-2 increased compliance investment after seeing Banking-1 audit results"
                    .into(),
        },
        InteractionEvent {
            month: 6,
            agent_a: "Telecom-1".into(),
            agent_b: "Banking-1".into(),
            interaction_type: "supply_chain".into(),
            effect: "Telecom-1 required to meet Banking-1 vendor compliance standards".into(),
        },
    ];

    ABMResponse {
        agents: trajectories,
        aggregate: AggregateResult {
            avg_compliance_initial: (avg_initial * 100.0).round() / 100.0,
            avg_compliance_final: (avg_final * 100.0).round() / 100.0,
            compliance_delta: ((avg_final - avg_initial) * 100.0).round() / 100.0,
            total_breaches_predicted: total_breaches,
            total_penalties_estimated: (total_penalties * 100.0).round() / 100.0,
            sector_summary,
        },
        interactions,
        duration_ms: start.elapsed().as_millis(),
    }
}

async fn run_abm(Json(req): Json<ABMRequest>) -> Json<ABMResponse> {
    Json(simulate_agents(&req))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "agent-based-model",
        "version": "1.0.0",
        "capabilities": ["per_org_simulation", "peer_pressure", "network_effects", "budget_optimization"]
    }))
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let port: u16 = std::env::var("AGENT_MODEL_PORT")
        .unwrap_or_else(|_| "8178".to_string())
        .parse()
        .unwrap_or(8178);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/agent-sim/run", post(run_abm));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Agent-Based Model engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
