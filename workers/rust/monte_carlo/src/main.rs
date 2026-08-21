/// NDSEP Monte Carlo Simulation Engine
///
/// High-performance stochastic simulation for the Digital Twin.
/// Runs 1,000+ iterations in parallel using Rayon, producing confidence
/// intervals (p5/p25/p50/p75/p95) for compliance, breach, and penalty metrics.
///
/// Port: 8177
/// Integration: Called by Go Digital Twin (8175) via Dapr service invocation
use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
use rand::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

#[derive(Debug, Clone, Deserialize)]
struct SectorInput {
    sector: String,
    jurisdiction: String,
    organizations: i32,
    avg_compliance: f64,
    breach_rate: f64,
    avg_penalty_local: f64,
    avg_budget_usd: f64,
    staff_count_avg: i32,
    tech_maturity: f64,
}

#[derive(Debug, Deserialize)]
struct MonteCarloRequest {
    sectors: Vec<SectorInput>,
    iterations: usize,
    duration_months: usize,
    breach_sla_hours: f64,
    penalty_multiplier: f64,
    compliance_threshold: f64,
}

#[derive(Debug, Serialize)]
struct MonteCarloResponse {
    iterations: usize,
    duration_months: usize,
    compliance: ConfidenceInterval,
    breach_delta: ConfidenceInterval,
    penalty_delta: ConfidenceInterval,
    gdp_impact: ConfidenceInterval,
    per_sector: Vec<SectorMCResult>,
    timeline: Vec<TimelineCI>,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Clone)]
struct ConfidenceInterval {
    p5: f64,
    p25: f64,
    p50: f64,
    p75: f64,
    p95: f64,
    mean: f64,
    std_dev: f64,
}

#[derive(Debug, Serialize)]
struct SectorMCResult {
    sector: String,
    jurisdiction: String,
    compliance: ConfidenceInterval,
    breach_delta: ConfidenceInterval,
    penalty_delta: ConfidenceInterval,
}

#[derive(Debug, Serialize)]
struct TimelineCI {
    month: usize,
    compliance: ConfidenceInterval,
    breach_count: ConfidenceInterval,
    penalties: ConfidenceInterval,
}

#[derive(Debug, Clone)]
struct IterationResult {
    compliance_delta: f64,
    breach_delta: f64,
    penalty_delta: f64,
    gdp_impact: f64,
    sector_results: Vec<SectorIterResult>,
    monthly_compliance: Vec<f64>,
    monthly_breaches: Vec<f64>,
    monthly_penalties: Vec<f64>,
}

#[derive(Debug, Clone)]
struct SectorIterResult {
    sector: String,
    jurisdiction: String,
    compliance_delta: f64,
    breach_delta: f64,
    penalty_delta: f64,
}

fn run_single_iteration(
    sectors: &[SectorInput],
    duration: usize,
    sla: f64,
    pen_mult: f64,
    seed: u64,
) -> IterationResult {
    let mut rng = StdRng::seed_from_u64(seed);

    let mut total_comp_weighted = 0.0;
    let mut total_breach = 0.0;
    let mut total_pen = 0.0;
    let mut total_orgs: i32 = 0;
    let mut sector_results = Vec::new();
    let mut monthly_comp = vec![0.0; duration];
    let mut monthly_breach = vec![0.0; duration];
    let mut monthly_pen = vec![0.0; duration];

    for sector in sectors {
        let budget_factor = (sector.avg_budget_usd / 10000.0).max(1.0).log10() * 0.1;
        let staff_factor = (sector.staff_count_avg as f64 * 0.02).min(0.3);
        let tech_factor = sector.tech_maturity * 0.05;
        let base_improvement = (100.0 - sector.avg_compliance) * 0.02 * pen_mult;

        // Stochastic factors
        let budget_shock: f64 = rng.gen::<f64>() * 0.3 - 0.15;
        let regulatory_shock: f64 = if rng.gen::<f64>() < 0.05 {
            rng.gen::<f64>() * 10.0 - 5.0
        } else {
            0.0
        };
        let tech_disruption: f64 = if rng.gen::<f64>() < 0.03 {
            -rng.gen::<f64>() * 8.0
        } else {
            0.0
        };

        let improvement = base_improvement
            * (1.0 + budget_factor + staff_factor + tech_factor + budget_shock)
            * duration as f64
            + regulatory_shock
            + tech_disruption;
        let noise: f64 = rng.gen::<f64>() * 4.0 - 2.0;
        let comp_delta = (improvement + noise).min(100.0 - sector.avg_compliance);

        let sla_factor = 72.0 / sla;
        let breach_base = -sector.breach_rate * 0.1 * duration as f64 * sla_factor;
        let breach_noise: f64 =
            rng.gen::<f64>() * sector.breach_rate * 0.6 - sector.breach_rate * 0.3;
        let breach_delta = breach_base + breach_noise + tech_disruption * 0.01;

        let pen_delta = sector.avg_penalty_local
            * (pen_mult - 1.0)
            * sector.organizations as f64
            * (sector.breach_rate + breach_delta).max(0.0);

        total_comp_weighted += comp_delta * sector.organizations as f64;
        total_breach += breach_delta;
        total_pen += pen_delta;
        total_orgs += sector.organizations;

        // Monthly trajectory
        for m in 0..duration {
            let month = m + 1;
            let m_imp = base_improvement * (1.0 + budget_factor + budget_shock) * month as f64;
            let m_noise: f64 = rng.gen::<f64>() * 3.0 - 1.5;
            let score = (sector.avg_compliance + m_imp + m_noise).min(100.0);
            monthly_comp[m] += score * sector.organizations as f64;

            let m_breach_red = (1.0 - sector.breach_rate) * 0.01 * sla_factor * month as f64;
            let m_breaches =
                (sector.organizations as f64 * sector.breach_rate * (1.0 - m_breach_red)).max(0.0);
            monthly_breach[m] += m_breaches;
            monthly_pen[m] += sector.avg_penalty_local * pen_mult * m_breaches;
        }

        sector_results.push(SectorIterResult {
            sector: sector.sector.clone(),
            jurisdiction: sector.jurisdiction.clone(),
            compliance_delta: comp_delta,
            breach_delta: breach_delta * 100.0,
            penalty_delta: pen_delta,
        });
    }

    let avg_comp = if total_orgs > 0 {
        total_comp_weighted / total_orgs as f64
    } else {
        0.0
    };

    for m in 0..duration {
        if total_orgs > 0 {
            monthly_comp[m] /= total_orgs as f64;
        }
    }

    let gdp_impact = (total_pen.abs() * 0.000001) - (avg_comp * 0.01);

    IterationResult {
        compliance_delta: avg_comp,
        breach_delta: total_breach / sectors.len().max(1) as f64 * 100.0,
        penalty_delta: total_pen,
        gdp_impact,
        sector_results,
        monthly_compliance: monthly_comp,
        monthly_breaches: monthly_breach,
        monthly_penalties: monthly_pen,
    }
}

fn calc_ci(values: &[f64]) -> ConfidenceInterval {
    if values.is_empty() {
        return ConfidenceInterval {
            p5: 0.0,
            p25: 0.0,
            p50: 0.0,
            p75: 0.0,
            p95: 0.0,
            mean: 0.0,
            std_dev: 0.0,
        };
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let n = sorted.len();
    let mean_val = sorted.iter().sum::<f64>() / n as f64;
    let variance = sorted.iter().map(|v| (v - mean_val).powi(2)).sum::<f64>() / n as f64;

    ConfidenceInterval {
        p5: percentile_sorted(&sorted, 5.0),
        p25: percentile_sorted(&sorted, 25.0),
        p50: percentile_sorted(&sorted, 50.0),
        p75: percentile_sorted(&sorted, 75.0),
        p95: percentile_sorted(&sorted, 95.0),
        mean: round2(mean_val),
        std_dev: round2(variance.sqrt()),
    }
}

fn percentile_sorted(sorted: &[f64], p: f64) -> f64 {
    let idx = p / 100.0 * (sorted.len() as f64 - 1.0);
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    if lo == hi || hi >= sorted.len() {
        return round2(sorted[lo]);
    }
    let frac = idx - lo as f64;
    round2(sorted[lo] * (1.0 - frac) + sorted[hi] * frac)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

async fn run_monte_carlo(Json(req): Json<MonteCarloRequest>) -> Json<MonteCarloResponse> {
    let start = std::time::Instant::now();
    let iterations = req.iterations.max(100);

    let results: Vec<IterationResult> = (0..iterations)
        .into_par_iter()
        .map(|i| {
            let seed = 42 + i as u64 * 7919;
            run_single_iteration(
                &req.sectors,
                req.duration_months,
                req.breach_sla_hours,
                req.penalty_multiplier,
                seed,
            )
        })
        .collect();

    let comp_values: Vec<f64> = results.iter().map(|r| r.compliance_delta).collect();
    let breach_values: Vec<f64> = results.iter().map(|r| r.breach_delta).collect();
    let pen_values: Vec<f64> = results.iter().map(|r| r.penalty_delta).collect();
    let gdp_values: Vec<f64> = results.iter().map(|r| r.gdp_impact).collect();

    // Per-sector aggregation
    let sector_count = req.sectors.len();
    let mut per_sector = Vec::new();
    for s_idx in 0..sector_count {
        let s_comp: Vec<f64> = results
            .iter()
            .map(|r| r.sector_results[s_idx].compliance_delta)
            .collect();
        let s_breach: Vec<f64> = results
            .iter()
            .map(|r| r.sector_results[s_idx].breach_delta)
            .collect();
        let s_pen: Vec<f64> = results
            .iter()
            .map(|r| r.sector_results[s_idx].penalty_delta)
            .collect();
        per_sector.push(SectorMCResult {
            sector: req.sectors[s_idx].sector.clone(),
            jurisdiction: req.sectors[s_idx].jurisdiction.clone(),
            compliance: calc_ci(&s_comp),
            breach_delta: calc_ci(&s_breach),
            penalty_delta: calc_ci(&s_pen),
        });
    }

    // Timeline CIs
    let mut timeline = Vec::new();
    for m in 0..req.duration_months {
        let m_comp: Vec<f64> = results.iter().map(|r| r.monthly_compliance[m]).collect();
        let m_breach: Vec<f64> = results.iter().map(|r| r.monthly_breaches[m]).collect();
        let m_pen: Vec<f64> = results.iter().map(|r| r.monthly_penalties[m]).collect();
        timeline.push(TimelineCI {
            month: m + 1,
            compliance: calc_ci(&m_comp),
            breach_count: calc_ci(&m_breach),
            penalties: calc_ci(&m_pen),
        });
    }

    Json(MonteCarloResponse {
        iterations,
        duration_months: req.duration_months,
        compliance: calc_ci(&comp_values),
        breach_delta: calc_ci(&breach_values),
        penalty_delta: calc_ci(&pen_values),
        gdp_impact: calc_ci(&gdp_values),
        per_sector,
        timeline,
        duration_ms: start.elapsed().as_millis(),
    })
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "monte-carlo-sim",
        "version": "1.0.0",
        "capabilities": ["parallel_simulation", "confidence_intervals", "per_sector_analysis", "timeline_ci"]
    }))
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let port: u16 = std::env::var("MONTE_CARLO_PORT")
        .unwrap_or_else(|_| "8177".to_string())
        .parse()
        .unwrap_or(8177);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/monte-carlo/run", post(run_monte_carlo));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("Monte Carlo engine listening on {}", addr);
    println!("Monte Carlo engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
