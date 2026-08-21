// NDSEP Lakehouse Feature Store Writer (Rust)
// =============================================
// High-throughput writer for the NDSEP data lakehouse.
// Writes ML features, model predictions, and audit lineage to:
//   - PostgreSQL feature tables (online store)
//   - Delta Lake / Iceberg-compatible Parquet files (offline store)
//   - Model prediction log (for drift detection)
//   - Feature lineage graph (for auditability)
//
// Feature groups written:
//   - compliance_features    : org compliance metrics (hourly)
//   - risk_features          : sector risk scores (daily)
//   - behavioral_features    : login/API usage patterns (hourly)
//   - prediction_log         : model inference results (real-time)
//   - drift_metrics          : feature distribution drift (daily)
//
// Technology: Rust · Axum · Tokio · tokio-postgres
// Port: 8215

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tokio_postgres::NoTls;
use uuid::Uuid;

// ── Configuration ──────────────────────────────────────────────────────────────
fn get_env(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

// ── State ──────────────────────────────────────────────────────────────────────
#[derive(Clone)]
struct AppState {
    db_url: String,
    lakehouse_analytics_url: String,
    start_time: Instant,
    writes_total: Arc<AtomicU64>,
    writes_failed: Arc<AtomicU64>,
    feature_writes: Arc<AtomicU64>,
    prediction_writes: Arc<AtomicU64>,
    lineage_writes: Arc<AtomicU64>,
    parquet_forwards: Arc<AtomicU64>,
}

impl AppState {
    fn new(db_url: String, lakehouse_analytics_url: String) -> Self {
        AppState {
            db_url,
            lakehouse_analytics_url,
            start_time: Instant::now(),
            writes_total: Arc::new(AtomicU64::new(0)),
            writes_failed: Arc::new(AtomicU64::new(0)),
            feature_writes: Arc::new(AtomicU64::new(0)),
            prediction_writes: Arc::new(AtomicU64::new(0)),
            lineage_writes: Arc::new(AtomicU64::new(0)),
            parquet_forwards: Arc::new(AtomicU64::new(0)),
        }
    }
}

/// Forward a record to the Lakehouse Analytics Engine for Parquet (offline) storage.
async fn forward_to_parquet(state: &AppState, table: &str, record: &serde_json::Value) {
    if state.lakehouse_analytics_url.is_empty() {
        return;
    }
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "namespace": "ndsep",
        "table": table,
        "records": [record],
    });
    match client
        .post(format!("{}/ingest", state.lakehouse_analytics_url))
        .json(&payload)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            state.parquet_forwards.fetch_add(1, Ordering::Relaxed);
            log::debug!("[Lakehouse] Forwarded to Parquet offline store: {table}");
        }
        Ok(resp) => {
            log::debug!(
                "[Lakehouse] Parquet forward to {table}: HTTP {}",
                resp.status()
            );
        }
        Err(e) => {
            log::debug!("[Lakehouse] Parquet forward unavailable: {e}");
        }
    }
}

// ── Request types ──────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct FeatureWriteRequest {
    feature_group: String,
    entity_id: String,
    entity_type: String,
    features: HashMap<String, serde_json::Value>,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct PredictionLogRequest {
    model_name: String,
    model_version: String,
    entity_id: String,
    input_features: HashMap<String, serde_json::Value>,
    prediction: serde_json::Value,
    confidence: f64,
    latency_ms: u64,
}

#[derive(Deserialize)]
struct LineageRequest {
    source_table: String,
    target_table: String,
    transformation: String,
    record_count: u64,
    pipeline_run_id: String,
}

#[derive(Serialize)]
struct WriteResponse {
    status: String,
    record_id: String,
    timestamp: String,
    feature_group: Option<String>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    worker: String,
    writes_total: u64,
    writes_failed: u64,
    feature_writes: u64,
    prediction_writes: u64,
    lineage_writes: u64,
    uptime_seconds: f64,
}

// ── Database helpers ───────────────────────────────────────────────────────────
async fn get_db_client(db_url: &str) -> Result<tokio_postgres::Client, tokio_postgres::Error> {
    let (client, connection) = tokio_postgres::connect(db_url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            log::error!("[Lakehouse] DB connection error: {}", e);
        }
    });
    Ok(client)
}

// ── Handlers ───────────────────────────────────────────────────────────────────
async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        worker: "lakehouse_writer".to_string(),
        writes_total: state.writes_total.load(Ordering::Relaxed),
        writes_failed: state.writes_failed.load(Ordering::Relaxed),
        feature_writes: state.feature_writes.load(Ordering::Relaxed),
        prediction_writes: state.prediction_writes.load(Ordering::Relaxed),
        lineage_writes: state.lineage_writes.load(Ordering::Relaxed),
        uptime_seconds: state.start_time.elapsed().as_secs_f64(),
    })
}

async fn write_features(
    State(state): State<AppState>,
    Json(req): Json<FeatureWriteRequest>,
) -> Json<WriteResponse> {
    let record_id = Uuid::new_v4().to_string();
    let ts = req
        .timestamp
        .clone()
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    state.writes_total.fetch_add(1, Ordering::Relaxed);

    // Write to PostgreSQL feature store
    match get_db_client(&state.db_url).await {
        Ok(client) => {
            let features_json = serde_json::to_string(&req.features).unwrap_or_default();
            let result = client.execute(
                "INSERT INTO ml_feature_store (id, feature_group, entity_id, entity_type, features, recorded_at)
                 VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::timestamptz)
                 ON CONFLICT (feature_group, entity_id) DO UPDATE
                 SET features = EXCLUDED.features, recorded_at = EXCLUDED.recorded_at",
                &[&record_id, &req.feature_group, &req.entity_id, &req.entity_type, &features_json, &ts],
            ).await;

            match result {
                Ok(_) => {
                    state.feature_writes.fetch_add(1, Ordering::Relaxed);
                    log::debug!(
                        "[Lakehouse] Feature write: {} / {}",
                        req.feature_group,
                        req.entity_id
                    );
                }
                Err(e) => {
                    state.writes_failed.fetch_add(1, Ordering::Relaxed);
                    log::error!("[Lakehouse] Feature write failed: {}", e);
                }
            }
        }
        Err(e) => {
            state.writes_failed.fetch_add(1, Ordering::Relaxed);
            log::error!("[Lakehouse] DB connect failed: {}", e);
        }
    }

    // Forward to Lakehouse Analytics Engine for Parquet (offline store)
    let fwd_record = serde_json::json!({
        "feature_group": &req.feature_group,
        "entity_id": &req.entity_id,
        "entity_type": &req.entity_type,
        "features": &req.features,
        "recorded_at": &ts,
    });
    forward_to_parquet(&state, "ml_features", &fwd_record).await;

    Json(WriteResponse {
        status: "written".to_string(),
        record_id,
        timestamp: ts,
        feature_group: Some(req.feature_group),
    })
}

async fn log_prediction(
    State(state): State<AppState>,
    Json(req): Json<PredictionLogRequest>,
) -> Json<WriteResponse> {
    let record_id = Uuid::new_v4().to_string();
    let ts = Utc::now().to_rfc3339();
    state.writes_total.fetch_add(1, Ordering::Relaxed);

    match get_db_client(&state.db_url).await {
        Ok(client) => {
            let input_json = serde_json::to_string(&req.input_features).unwrap_or_default();
            let pred_json = serde_json::to_string(&req.prediction).unwrap_or_default();
            let result = client.execute(
                "INSERT INTO ml_prediction_log (id, model_name, model_version, entity_id, input_features, prediction, confidence, latency_ms, predicted_at)
                 VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::bigint, NOW())",
                &[&record_id, &req.model_name, &req.model_version, &req.entity_id,
                  &input_json, &pred_json, &req.confidence, &(req.latency_ms as i64)],
            ).await;

            match result {
                Ok(_) => {
                    state.prediction_writes.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    state.writes_failed.fetch_add(1, Ordering::Relaxed);
                    log::error!("[Lakehouse] Prediction log failed: {}", e);
                }
            }
        }
        Err(e) => {
            state.writes_failed.fetch_add(1, Ordering::Relaxed);
            log::error!("[Lakehouse] DB connect failed: {}", e);
        }
    }

    // Forward prediction to Lakehouse Analytics Engine for Parquet (offline store)
    let fwd_record = serde_json::json!({
        "model_name": &req.model_name,
        "model_version": &req.model_version,
        "entity_id": &req.entity_id,
        "confidence": req.confidence,
        "latency_ms": req.latency_ms,
        "predicted_at": &ts,
    });
    forward_to_parquet(&state, "ml_predictions", &fwd_record).await;

    Json(WriteResponse {
        status: "logged".to_string(),
        record_id,
        timestamp: ts,
        feature_group: Some(format!("prediction:{}", req.model_name)),
    })
}

async fn write_lineage(
    State(state): State<AppState>,
    Json(req): Json<LineageRequest>,
) -> Json<WriteResponse> {
    let record_id = Uuid::new_v4().to_string();
    let ts = Utc::now().to_rfc3339();
    state.writes_total.fetch_add(1, Ordering::Relaxed);

    match get_db_client(&state.db_url).await {
        Ok(client) => {
            let result = client.execute(
                "INSERT INTO ml_lineage (id, source_table, target_table, transformation, record_count, pipeline_run_id, created_at)
                 VALUES ($1::uuid, $2, $3, $4, $5::bigint, $6, NOW())",
                &[&record_id, &req.source_table, &req.target_table,
                  &req.transformation, &(req.record_count as i64), &req.pipeline_run_id],
            ).await;

            match result {
                Ok(_) => {
                    state.lineage_writes.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    state.writes_failed.fetch_add(1, Ordering::Relaxed);
                    log::error!("[Lakehouse] Lineage write failed: {}", e);
                }
            }
        }
        Err(e) => {
            state.writes_failed.fetch_add(1, Ordering::Relaxed);
            log::error!("[Lakehouse] DB connect failed: {}", e);
        }
    }

    Json(WriteResponse {
        status: "lineage_recorded".to_string(),
        record_id,
        timestamp: ts,
        feature_group: None,
    })
}

async fn get_features(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let feature_group = req
        .get("feature_group")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let entity_id = req.get("entity_id").and_then(|v| v.as_str()).unwrap_or("");

    match get_db_client(&state.db_url).await {
        Ok(client) => {
            let rows = client
                .query(
                    "SELECT id::text, feature_group, entity_id, entity_type, features, recorded_at
                 FROM ml_feature_store
                 WHERE feature_group = $1 AND entity_id = $2
                 ORDER BY recorded_at DESC LIMIT 1",
                    &[&feature_group, &entity_id],
                )
                .await;

            match rows {
                Ok(rows) if !rows.is_empty() => {
                    let row = &rows[0];
                    let features: serde_json::Value = row.get::<_, serde_json::Value>(4);
                    Json(serde_json::json!({
                        "found": true,
                        "feature_group": feature_group,
                        "entity_id": entity_id,
                        "features": features,
                        "recorded_at": row.get::<_, String>(5)
                    }))
                }
                _ => Json(serde_json::json!({
                    "found": false,
                    "feature_group": feature_group,
                    "entity_id": entity_id
                })),
            }
        }
        Err(e) => Json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────
#[tokio::main]
async fn main() {
    env_logger::init();
    let db_url = get_env(
        "DATABASE_URL",
        "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db",
    );
    let port = get_env("LAKEHOUSE_PORT", "8215");

    log::info!(
        "[Lakehouse] Starting NDSEP Lakehouse Feature Store Writer on port {}",
        port
    );

    // Ensure tables exist
    if let Ok(client) = get_db_client(&db_url).await {
        let _ = client.batch_execute("
            CREATE TABLE IF NOT EXISTS ml_feature_store (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                feature_group TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                entity_type TEXT NOT NULL DEFAULT 'organization',
                features JSONB NOT NULL DEFAULT '{}',
                recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (feature_group, entity_id)
            );
            CREATE TABLE IF NOT EXISTS ml_prediction_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                model_name TEXT NOT NULL,
                model_version TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                input_features JSONB NOT NULL DEFAULT '{}',
                prediction JSONB NOT NULL,
                confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                latency_ms BIGINT NOT NULL DEFAULT 0,
                predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ml_lineage (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                source_table TEXT NOT NULL,
                target_table TEXT NOT NULL,
                transformation TEXT NOT NULL,
                record_count BIGINT NOT NULL DEFAULT 0,
                pipeline_run_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_feature_store_group_entity ON ml_feature_store(feature_group, entity_id);
            CREATE INDEX IF NOT EXISTS idx_prediction_log_model ON ml_prediction_log(model_name, predicted_at DESC);
            CREATE INDEX IF NOT EXISTS idx_lineage_pipeline ON ml_lineage(pipeline_run_id, created_at DESC);
        ").await;
        log::info!("[Lakehouse] Tables ensured");
    }

    let lakehouse_url = get_env("LAKEHOUSE_ANALYTICS_URL", "http://localhost:8140");
    let state = AppState::new(db_url, lakehouse_url);

    let app = Router::new()
        .route("/health", get(health))
        .route("/features/write", post(write_features))
        .route("/features/get", post(get_features))
        .route("/predictions/log", post(log_prediction))
        .route("/lineage/write", post(write_lineage))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    log::info!("[Lakehouse] Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
