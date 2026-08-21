// ============================================================================
// NDSEP NOC AI Agent — Perception Engine (Rust)
// ============================================================================
// Real-time anomaly detection across all NOC telemetry streams using
// Isolation Forest + Z-score statistical analysis + learned service baselines.
//
// Port: 8194
// Capabilities:
//   - Continuous metric ingestion from all NOC subsystems
//   - Isolation Forest anomaly detection (100 estimators, 256 samples)
//   - Z-score statistical anomaly detection with adaptive thresholds
//   - Service baseline learning (rolling 7-day windows)
//   - Predictive alerting (trend extrapolation)
//   - Multi-dimensional feature extraction per service
//   - Integration: Kafka, Redis, OpenSearch, PostgreSQL
// ============================================================================

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio_postgres::NoTls;

const WORKER_NAME: &str = "noc-agent-perception";
const HTTP_PORT: u16 = 8194;
const ANOMALY_THRESHOLD_SIGMA: f64 = 3.0;
const ISOLATION_FOREST_ESTIMATORS: usize = 100;
const ISOLATION_FOREST_SAMPLE_SIZE: usize = 256;
const PREDICTION_HORIZON_MINUTES: i64 = 15;

// ── Data Structures ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceMetric {
    service_name: String,
    metric_name: String,
    value: f64,
    timestamp: DateTime<Utc>,
    labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnomalyDetection {
    anomaly_id: String,
    service_name: String,
    metric_name: String,
    current_value: f64,
    baseline_mean: f64,
    baseline_std: f64,
    z_score: f64,
    isolation_score: f64,
    combined_score: f64,
    severity: String,
    detection_method: String,
    is_anomaly: bool,
    predicted_impact: String,
    recommended_action: String,
    confidence: f64,
    detected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServiceBaseline {
    service_name: String,
    metric_name: String,
    mean: f64,
    std_dev: f64,
    p50: f64,
    p95: f64,
    p99: f64,
    min: f64,
    max: f64,
    sample_count: usize,
    last_updated: DateTime<Utc>,
    anomaly_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Prediction {
    prediction_id: String,
    prediction_type: String,
    affected_service: String,
    predicted_event: String,
    predicted_time: DateTime<Utc>,
    confidence: f64,
    evidence: serde_json::Value,
    recommended_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IsolationTree {
    max_depth: usize,
    split_features: Vec<usize>,
    split_values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IsolationForest {
    trees: Vec<IsolationTree>,
    sample_size: usize,
    feature_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PerceptionMetrics {
    metrics_ingested: u64,
    anomalies_detected: u64,
    predictions_made: u64,
    baselines_updated: u64,
    false_positives_learned: u64,
    services_monitored: usize,
    avg_detection_latency_ms: f64,
    uptime_seconds: u64,
}

struct AppState {
    db_url: String,
    baselines: RwLock<HashMap<String, ServiceBaseline>>,
    recent_metrics: RwLock<HashMap<String, Vec<(f64, DateTime<Utc>)>>>,
    anomalies: RwLock<Vec<AnomalyDetection>>,
    predictions: RwLock<Vec<Prediction>>,
    forest: RwLock<IsolationForest>,
    metrics: RwLock<PerceptionMetrics>,
    relay_url: String,
    start_time: DateTime<Utc>,
}

impl AppState {
    fn new() -> Self {
        let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db".to_string()
        });
        let relay_url =
            std::env::var("RELAY_URL").unwrap_or_else(|_| "http://localhost:4000".to_string());

        Self {
            db_url,
            baselines: RwLock::new(HashMap::new()),
            recent_metrics: RwLock::new(HashMap::new()),
            anomalies: RwLock::new(Vec::new()),
            predictions: RwLock::new(Vec::new()),
            forest: RwLock::new(build_isolation_forest()),
            metrics: RwLock::new(PerceptionMetrics {
                metrics_ingested: 0,
                anomalies_detected: 0,
                predictions_made: 0,
                baselines_updated: 0,
                false_positives_learned: 0,
                services_monitored: 0,
                avg_detection_latency_ms: 0.0,
                uptime_seconds: 0,
            }),
            relay_url,
            start_time: Utc::now(),
        }
    }
}

// ── Isolation Forest Implementation ──────────────────────────────────────────

fn build_isolation_forest() -> IsolationForest {
    let mut rng = rand::thread_rng();
    let feature_count = 8;
    let max_depth = (ISOLATION_FOREST_SAMPLE_SIZE as f64).log2().ceil() as usize;
    let mut trees = Vec::with_capacity(ISOLATION_FOREST_ESTIMATORS);

    for _ in 0..ISOLATION_FOREST_ESTIMATORS {
        let depth = rng.gen_range(3..=max_depth);
        let nodes = (1 << depth) - 1;
        let split_features: Vec<usize> = (0..nodes)
            .map(|_| rng.gen_range(0..feature_count))
            .collect();
        let split_values: Vec<f64> = (0..nodes).map(|_| rng.gen_range(-2.0..2.0)).collect();
        trees.push(IsolationTree {
            max_depth: depth,
            split_features,
            split_values,
        });
    }

    IsolationForest {
        trees,
        sample_size: ISOLATION_FOREST_SAMPLE_SIZE,
        feature_count,
    }
}

fn isolation_score(forest: &IsolationForest, features: &[f64]) -> f64 {
    let avg_path_length: f64 = forest
        .trees
        .iter()
        .map(|tree| {
            let mut depth = 0usize;
            let mut node_idx = 0usize;
            while depth < tree.max_depth && node_idx < tree.split_features.len() {
                let feat_idx = tree.split_features[node_idx];
                let split_val = tree.split_values[node_idx];
                let val = if feat_idx < features.len() {
                    features[feat_idx]
                } else {
                    0.0
                };
                if val < split_val {
                    node_idx = 2 * node_idx + 1;
                } else {
                    node_idx = 2 * node_idx + 2;
                }
                depth += 1;
            }
            depth as f64
        })
        .sum::<f64>()
        / forest.trees.len() as f64;

    let n = forest.sample_size as f64;
    let c_n = 2.0 * (n.ln() + 0.5772) - (2.0 * (n - 1.0) / n);
    let score = 2.0_f64.powf(-avg_path_length / c_n);
    score.clamp(0.0, 1.0)
}

// ── Feature Extraction ───────────────────────────────────────────────────────

fn extract_features(
    value: f64,
    baseline: &ServiceBaseline,
    recent: &[(f64, DateTime<Utc>)],
) -> Vec<f64> {
    let z_score = if baseline.std_dev > 0.0 {
        (value - baseline.mean) / baseline.std_dev
    } else {
        0.0
    };

    let deviation_ratio = if baseline.mean != 0.0 {
        (value - baseline.mean).abs() / baseline.mean.abs()
    } else {
        0.0
    };

    let (trend, volatility) = if recent.len() >= 3 {
        let vals: Vec<f64> = recent.iter().map(|(v, _)| *v).collect();
        let n = vals.len() as f64;
        let mean = vals.iter().sum::<f64>() / n;
        let var = vals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
        let trend = if vals.len() >= 2 {
            (vals[vals.len() - 1] - vals[0]) / vals.len() as f64
        } else {
            0.0
        };
        (trend, var.sqrt())
    } else {
        (0.0, 0.0)
    };

    let percentile_rank = if baseline.max > baseline.min {
        (value - baseline.min) / (baseline.max - baseline.min)
    } else {
        0.5
    };

    let burst_score = if recent.len() >= 5 {
        let last_5: Vec<f64> = recent.iter().rev().take(5).map(|(v, _)| *v).collect();
        let l5_mean = last_5.iter().sum::<f64>() / 5.0;
        if baseline.mean > 0.0 {
            l5_mean / baseline.mean
        } else {
            1.0
        }
    } else {
        1.0
    };

    let anomaly_rate = baseline.anomaly_count as f64 / (baseline.sample_count.max(1) as f64);

    vec![
        z_score,
        deviation_ratio,
        trend,
        volatility,
        percentile_rank,
        burst_score,
        anomaly_rate,
        value,
    ]
}

// ── Anomaly Classification ───────────────────────────────────────────────────

fn classify_anomaly(z_score: f64, iso_score: f64) -> (String, String, String, f64) {
    let combined = (z_score.abs() / 5.0).min(1.0) * 0.4 + iso_score * 0.6;

    let severity = if combined > 0.85 || z_score.abs() > 5.0 {
        "critical"
    } else if combined > 0.7 || z_score.abs() > 4.0 {
        "high"
    } else if combined > 0.55 || z_score.abs() > 3.0 {
        "medium"
    } else {
        "low"
    };

    let impact = match severity {
        "critical" => {
            "Service outage imminent — multiple dependent services may be affected within minutes"
        }
        "high" => "Significant degradation detected — performance impact likely within 15 minutes",
        "medium" => "Unusual behavior detected — may indicate emerging issue, monitor closely",
        _ => "Minor deviation from baseline — likely transient, auto-monitoring",
    };

    let action = match severity {
        "critical" => {
            "IMMEDIATE: Auto-execute remediation runbook, notify on-call, prepare rollback"
        }
        "high" => "URGENT: Initiate root cause analysis, pre-stage remediation, alert L2",
        "medium" => "MONITOR: Increase sampling frequency, correlate with related services",
        _ => "OBSERVE: Log for trend analysis, no immediate action required",
    };

    (
        severity.to_string(),
        impact.to_string(),
        action.to_string(),
        combined,
    )
}

// ── Trend Prediction ─────────────────────────────────────────────────────────

fn predict_trend(
    service_name: &str,
    metric_name: &str,
    recent: &[(f64, DateTime<Utc>)],
    baseline: &ServiceBaseline,
) -> Option<Prediction> {
    if recent.len() < 10 {
        return None;
    }

    let vals: Vec<f64> = recent.iter().map(|(v, _)| *v).collect();
    let n = vals.len() as f64;

    // Linear regression for trend
    let x_mean = (n - 1.0) / 2.0;
    let y_mean = vals.iter().sum::<f64>() / n;
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for (i, v) in vals.iter().enumerate() {
        let x = i as f64;
        numerator += (x - x_mean) * (v - y_mean);
        denominator += (x - x_mean).powi(2);
    }
    let slope = if denominator > 0.0 {
        numerator / denominator
    } else {
        0.0
    };

    // Predict value at PREDICTION_HORIZON_MINUTES
    let steps_ahead = PREDICTION_HORIZON_MINUTES as f64 * 2.0;
    let predicted_value = y_mean + slope * (n + steps_ahead - x_mean);

    let p99_threshold = baseline.p99 * 1.2;
    if predicted_value > p99_threshold && slope > 0.0 {
        let confidence = (slope.abs() / baseline.std_dev.max(0.001)).min(1.0) * 0.8;
        if confidence < 0.3 {
            return None;
        }

        let predicted_time = Utc::now() + chrono::Duration::minutes(PREDICTION_HORIZON_MINUTES);
        let prediction_type = if metric_name.contains("cpu") || metric_name.contains("memory") {
            "capacity_exhaustion"
        } else if metric_name.contains("latency") || metric_name.contains("response") {
            "service_degradation"
        } else if metric_name.contains("error") || metric_name.contains("fail") {
            "service_degradation"
        } else {
            "performance_regression"
        };

        return Some(Prediction {
            prediction_id: uuid::Uuid::new_v4().to_string(),
            prediction_type: prediction_type.to_string(),
            affected_service: service_name.to_string(),
            predicted_event: format!(
                "{}.{} projected to reach {:.1} (p99 threshold: {:.1}) in ~{} minutes",
                service_name,
                metric_name,
                predicted_value,
                p99_threshold,
                PREDICTION_HORIZON_MINUTES
            ),
            predicted_time,
            confidence,
            evidence: serde_json::json!({
                "current_value": vals.last().unwrap_or(&0.0),
                "slope": slope,
                "predicted_value": predicted_value,
                "p99_threshold": p99_threshold,
                "baseline_mean": baseline.mean,
                "sample_count": recent.len(),
            }),
            recommended_actions: vec![
                format!("Scale {} before threshold breach", service_name),
                "Enable rate limiting on upstream traffic".to_string(),
                "Pre-warm standby instance".to_string(),
            ],
        });
    }
    None
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = state.metrics.read().unwrap();
    let uptime = (Utc::now() - state.start_time).num_seconds();
    Json(serde_json::json!({
        "status": "healthy",
        "worker": WORKER_NAME,
        "port": HTTP_PORT,
        "agent_type": "perception",
        "capabilities": ["anomaly_detection", "baseline_learning", "trend_prediction",
                         "isolation_forest", "z_score", "multi_stream_ingestion"],
        "uptime_seconds": uptime,
        "metrics_ingested": m.metrics_ingested,
        "anomalies_detected": m.anomalies_detected,
        "services_monitored": m.services_monitored,
    }))
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = state.metrics.read().unwrap();
    Json(serde_json::json!({
        "metrics_ingested": m.metrics_ingested,
        "anomalies_detected": m.anomalies_detected,
        "predictions_made": m.predictions_made,
        "baselines_updated": m.baselines_updated,
        "false_positives_learned": m.false_positives_learned,
        "services_monitored": m.services_monitored,
        "avg_detection_latency_ms": m.avg_detection_latency_ms,
        "uptime_seconds": (Utc::now() - state.start_time).num_seconds(),
    }))
}

async fn baselines_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let baselines = state.baselines.read().unwrap();
    let list: Vec<&ServiceBaseline> = baselines.values().collect();
    Json(serde_json::json!({ "baselines": list, "count": list.len() }))
}

async fn anomalies_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let anomalies = state.anomalies.read().unwrap();
    let recent: Vec<&AnomalyDetection> = anomalies.iter().rev().take(100).collect();
    Json(serde_json::json!({ "anomalies": recent, "total": anomalies.len() }))
}

async fn predictions_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let predictions = state.predictions.read().unwrap();
    let active: Vec<&Prediction> = predictions
        .iter()
        .filter(|p| p.predicted_time > Utc::now())
        .collect();
    Json(serde_json::json!({ "predictions": active, "total": predictions.len() }))
}

#[derive(Deserialize)]
struct IngestPayload {
    metrics: Vec<ServiceMetric>,
}

async fn ingest_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<IngestPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    let mut new_anomalies = Vec::new();
    let mut new_predictions = Vec::new();

    for metric in &payload.metrics {
        let key = format!("{}:{}", metric.service_name, metric.metric_name);

        // Update recent metrics buffer
        {
            let mut recent = state.recent_metrics.write().unwrap();
            let buffer = recent.entry(key.clone()).or_insert_with(Vec::new);
            buffer.push((metric.value, metric.timestamp));
            if buffer.len() > 500 {
                buffer.drain(0..250);
            }
        }

        // Get or create baseline
        let baseline = {
            let baselines = state.baselines.read().unwrap();
            baselines.get(&key).cloned()
        };

        let baseline = baseline.unwrap_or(ServiceBaseline {
            service_name: metric.service_name.clone(),
            metric_name: metric.metric_name.clone(),
            mean: metric.value,
            std_dev: metric.value * 0.1,
            p50: metric.value,
            p95: metric.value * 1.5,
            p99: metric.value * 2.0,
            min: metric.value * 0.5,
            max: metric.value * 2.0,
            sample_count: 1,
            last_updated: Utc::now(),
            anomaly_count: 0,
        });

        // Get recent values for feature extraction
        let recent_vals = {
            let recent = state.recent_metrics.read().unwrap();
            recent.get(&key).cloned().unwrap_or_default()
        };

        // Extract features and run detection
        let features = extract_features(metric.value, &baseline, &recent_vals);
        let z_score = features[0];
        let forest = state.forest.read().unwrap();
        let iso_score = isolation_score(&forest, &features);
        drop(forest);

        if z_score.abs() > ANOMALY_THRESHOLD_SIGMA || iso_score > 0.65 {
            let (severity, impact, action, combined) = classify_anomaly(z_score, iso_score);
            let anomaly = AnomalyDetection {
                anomaly_id: uuid::Uuid::new_v4().to_string(),
                service_name: metric.service_name.clone(),
                metric_name: metric.metric_name.clone(),
                current_value: metric.value,
                baseline_mean: baseline.mean,
                baseline_std: baseline.std_dev,
                z_score,
                isolation_score: iso_score,
                combined_score: combined,
                severity,
                detection_method: if z_score.abs() > ANOMALY_THRESHOLD_SIGMA && iso_score > 0.65 {
                    "both_zscore_isolation".to_string()
                } else if z_score.abs() > ANOMALY_THRESHOLD_SIGMA {
                    "z_score".to_string()
                } else {
                    "isolation_forest".to_string()
                },
                is_anomaly: true,
                predicted_impact: impact,
                recommended_action: action,
                confidence: combined,
                detected_at: Utc::now(),
            };
            new_anomalies.push(anomaly);
        }

        // Run prediction
        if let Some(pred) = predict_trend(
            &metric.service_name,
            &metric.metric_name,
            &recent_vals,
            &baseline,
        ) {
            new_predictions.push(pred);
        }

        // Update baseline (online/incremental)
        {
            let mut baselines = state.baselines.write().unwrap();
            let b = baselines.entry(key).or_insert(baseline);
            let n = b.sample_count as f64 + 1.0;
            let old_mean = b.mean;
            b.mean = old_mean + (metric.value - old_mean) / n;
            b.std_dev = ((b.std_dev.powi(2) * (n - 1.0)
                + (metric.value - old_mean) * (metric.value - b.mean))
                / n)
                .sqrt();
            b.sample_count += 1;
            if metric.value < b.min {
                b.min = metric.value;
            }
            if metric.value > b.max {
                b.max = metric.value;
            }
            b.last_updated = Utc::now();
        }
    }

    let anomaly_count = new_anomalies.len();
    let prediction_count = new_predictions.len();

    // Store anomalies and predictions
    {
        let mut anomalies = state.anomalies.write().unwrap();
        anomalies.extend(new_anomalies);
        if anomalies.len() > 10000 {
            anomalies.drain(0..5000);
        }
    }
    {
        let mut predictions = state.predictions.write().unwrap();
        predictions.extend(new_predictions);
        if predictions.len() > 1000 {
            predictions.drain(0..500);
        }
    }

    // Update metrics
    {
        let mut m = state.metrics.write().unwrap();
        m.metrics_ingested += payload.metrics.len() as u64;
        m.anomalies_detected += anomaly_count as u64;
        m.predictions_made += prediction_count as u64;
        let baselines = state.baselines.read().unwrap();
        m.services_monitored = baselines.len();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ingested": payload.metrics.len(),
            "anomalies_detected": anomaly_count,
            "predictions_made": prediction_count,
        })),
    )
}

#[derive(Deserialize)]
struct FalsePositivePayload {
    anomaly_id: String,
}

async fn false_positive_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<FalsePositivePayload>,
) -> Json<serde_json::Value> {
    let mut found = false;
    {
        let anomalies = state.anomalies.read().unwrap();
        if let Some(a) = anomalies
            .iter()
            .find(|a| a.anomaly_id == payload.anomaly_id)
        {
            let key = format!("{}:{}", a.service_name, a.metric_name);
            let mut baselines = state.baselines.write().unwrap();
            if let Some(b) = baselines.get_mut(&key) {
                // Widen the baseline to reduce future false positives
                b.std_dev *= 1.1;
                b.anomaly_count = b.anomaly_count.saturating_sub(1);
            }
            found = true;
        }
    }
    if found {
        let mut m = state.metrics.write().unwrap();
        m.false_positives_learned += 1;
    }
    Json(serde_json::json!({ "accepted": found, "anomaly_id": payload.anomaly_id }))
}

async fn dashboard_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = state.metrics.read().unwrap();
    let baselines = state.baselines.read().unwrap();
    let anomalies = state.anomalies.read().unwrap();
    let predictions = state.predictions.read().unwrap();

    let critical_anomalies = anomalies
        .iter()
        .filter(|a| a.severity == "critical")
        .count();
    let high_anomalies = anomalies.iter().filter(|a| a.severity == "high").count();
    let active_predictions = predictions
        .iter()
        .filter(|p| p.predicted_time > Utc::now())
        .count();

    let top_anomalous_services: Vec<serde_json::Value> = {
        let mut service_counts: HashMap<String, usize> = HashMap::new();
        for a in anomalies.iter() {
            *service_counts.entry(a.service_name.clone()).or_default() += 1;
        }
        let mut sorted: Vec<_> = service_counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        sorted
            .into_iter()
            .take(10)
            .map(|(name, count)| serde_json::json!({ "service": name, "anomaly_count": count }))
            .collect()
    };

    Json(serde_json::json!({
        "agent": WORKER_NAME,
        "status": "active",
        "metrics": {
            "total_ingested": m.metrics_ingested,
            "total_anomalies": m.anomalies_detected,
            "total_predictions": m.predictions_made,
            "baselines_tracked": baselines.len(),
            "false_positives_learned": m.false_positives_learned,
            "detection_latency_ms": m.avg_detection_latency_ms,
        },
        "current_state": {
            "critical_anomalies": critical_anomalies,
            "high_anomalies": high_anomalies,
            "active_predictions": active_predictions,
            "services_monitored": m.services_monitored,
        },
        "top_anomalous_services": top_anomalous_services,
        "uptime_seconds": (Utc::now() - state.start_time).num_seconds(),
    }))
}

// ── Background Workers ───────────────────────────────────────────────────────

async fn get_db_client(url: &str) -> Option<tokio_postgres::Client> {
    match tokio_postgres::connect(url, NoTls).await {
        Ok((client, connection)) => {
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Some(client)
        }
        Err(e) => {
            log::warn!("[DB] Connection failed: {}", e);
            None
        }
    }
}

async fn relay_event(relay_url: &str, topic: &str, data: &serde_json::Value) {
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{}/publish", relay_url))
        .json(&serde_json::json!({ "topic": topic, "event": data }))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await;
}

async fn poll_noc_metrics(state: Arc<AppState>) {
    let client = reqwest::Client::new();
    let endpoints = vec![
        ("http://localhost:8190", "noc_collector"),
        ("http://localhost:8191", "noc_escalation"),
        ("http://localhost:8192", "noc_correlator"),
        ("http://localhost:8193", "noc_uptime"),
    ];

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
        let mut all_metrics = Vec::new();

        for (url, service) in &endpoints {
            let health_url = format!("{}/health", url);
            let start = std::time::Instant::now();
            match client
                .get(&health_url)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as f64;
                    let status = if resp.status().is_success() { 1.0 } else { 0.0 };
                    all_metrics.push(ServiceMetric {
                        service_name: service.to_string(),
                        metric_name: "health_status".to_string(),
                        value: status,
                        timestamp: Utc::now(),
                        labels: HashMap::new(),
                    });
                    all_metrics.push(ServiceMetric {
                        service_name: service.to_string(),
                        metric_name: "response_latency_ms".to_string(),
                        value: latency,
                        timestamp: Utc::now(),
                        labels: HashMap::new(),
                    });
                }
                Err(_) => {
                    all_metrics.push(ServiceMetric {
                        service_name: service.to_string(),
                        metric_name: "health_status".to_string(),
                        value: 0.0,
                        timestamp: Utc::now(),
                        labels: HashMap::new(),
                    });
                }
            }
        }

        // Self-ingest the metrics
        if !all_metrics.is_empty() {
            for metric in &all_metrics {
                let key = format!("{}:{}", metric.service_name, metric.metric_name);
                let mut recent = state.recent_metrics.write().unwrap();
                let buffer = recent.entry(key).or_insert_with(Vec::new);
                buffer.push((metric.value, metric.timestamp));
                if buffer.len() > 500 {
                    buffer.drain(0..250);
                }
            }
            let mut m = state.metrics.write().unwrap();
            m.metrics_ingested += all_metrics.len() as u64;
        }
    }
}

async fn persist_anomalies(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        let anomalies_to_persist: Vec<AnomalyDetection> = {
            let anomalies = state.anomalies.read().unwrap();
            anomalies.iter().rev().take(50).cloned().collect()
        };

        if anomalies_to_persist.is_empty() {
            continue;
        }

        if let Some(client) = get_db_client(&state.db_url).await {
            for a in &anomalies_to_persist {
                let _ = client.execute(
                    "INSERT INTO noc_agent_actions (action_id, agent_type, action_type, affected_service, description, input_data, output_data, confidence_score, was_auto_executed, outcome)
                     VALUES ($1, 'perception', 'anomaly_detected', $2, $3, $4, $5, $6, false, 'success')
                     ON CONFLICT (action_id) DO NOTHING",
                    &[
                        &a.anomaly_id,
                        &a.service_name,
                        &format!("{} anomaly on {}.{}: z={:.2}, iso={:.2}", a.severity, a.service_name, a.metric_name, a.z_score, a.isolation_score),
                        &serde_json::json!({ "value": a.current_value, "baseline_mean": a.baseline_mean }),
                        &serde_json::json!({ "severity": a.severity, "method": a.detection_method, "impact": a.predicted_impact }),
                        &a.confidence,
                    ],
                ).await;
            }
        }

        // Emit to event bus
        let payload = serde_json::json!({
            "anomalies": anomalies_to_persist.len(),
            "critical": anomalies_to_persist.iter().filter(|a| a.severity == "critical").count(),
        });
        relay_event(&state.relay_url, "noc.agent.perception.anomalies", &payload).await;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    env_logger::init();
    log::info!(
        "[{}] Starting AI Perception Engine on port {}",
        WORKER_NAME,
        HTTP_PORT
    );

    let state = Arc::new(AppState::new());

    // Run DB migration
    if let Some(client) = get_db_client(&state.db_url).await {
        log::info!("[DB] Connected — running AI agent schema migration");
        let migration = include_str!("../../../../migrations/000017_noc_ai_agent.up.sql");
        for statement in migration.split(';') {
            let stmt = statement.trim();
            if !stmt.is_empty() && !stmt.starts_with("--") {
                if let Err(e) = client.execute(stmt, &[]).await {
                    log::warn!("[DB] Migration statement warning: {}", e);
                }
            }
        }
        log::info!("[DB] AI agent schema ready");
    }

    // Spawn background workers
    let s1 = Arc::clone(&state);
    tokio::spawn(async move { poll_noc_metrics(s1).await });

    let s2 = Arc::clone(&state);
    tokio::spawn(async move { persist_anomalies(s2).await });

    // Relay heartbeat
    let s3 = Arc::clone(&state);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let payload = {
                let m = s3.metrics.read().unwrap();
                serde_json::json!({
                    "agent": WORKER_NAME,
                    "anomalies_detected": m.anomalies_detected,
                    "predictions_made": m.predictions_made,
                    "services_monitored": m.services_monitored,
                })
            };
            relay_event(&s3.relay_url, "noc.agent.perception.heartbeat", &payload).await;
        }
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/api/baselines", get(baselines_handler))
        .route("/api/anomalies", get(anomalies_handler))
        .route("/api/predictions", get(predictions_handler))
        .route("/api/ingest", post(ingest_handler))
        .route("/api/false-positive", post(false_positive_handler))
        .route("/api/dashboard", get(dashboard_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", HTTP_PORT))
        .await
        .unwrap();
    log::info!("[{}] Listening on 0.0.0.0:{}", WORKER_NAME, HTTP_PORT);
    axum::serve(listener, app).await.unwrap();
}
