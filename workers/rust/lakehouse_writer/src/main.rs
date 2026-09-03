//! NDSEP Lakehouse Feature Store Writer.
//!
//! PostgreSQL is the source of truth for online ML feature, prediction, and lineage
//! records. Each successful write is committed in the same transaction as a durable
//! Lakehouse delivery-ledger record. The separate lakehouse_ingest worker claims that
//! ledger and delivers it downstream; this process has no in-memory write queue and
//! does not report a successful write when either durable operation fails.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use native_tls::{Certificate, Protocol, TlsConnector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tokio_postgres::{Client, NoTls, Transaction};
use uuid::Uuid;

const MAX_LABEL_LENGTH: usize = 256;
const MAX_JSON_BYTES: usize = 1_000_000;
const OUTBOX_SCHEMA_VERSION: &str = "1.0";
const OUTBOX_SOURCE_SYSTEM: &str = "lakehouse-writer";

// ── Configuration ──────────────────────────────────────────────────────────────

fn is_production() -> bool {
    env::var("NODE_ENV")
        .map(|value| value.eq_ignore_ascii_case("production"))
        .unwrap_or(false)
}

fn required_postgres_url() -> Result<String, String> {
    for key in [
        "LAKEHOUSE_DATABASE_URL",
        "WORKER_DATABASE_URL",
        "DATABASE_URL",
    ] {
        if let Ok(value) = env::var(key) {
            let value = value.trim().to_string();
            if value.starts_with("postgresql://") || value.starts_with("postgres://") {
                return Ok(value);
            }
            return Err(format!("{key} must be a PostgreSQL connection URL"));
        }
    }
    Err("LAKEHOUSE_DATABASE_URL, WORKER_DATABASE_URL, or DATABASE_URL is required; Lakehouse writer has no database fallback".to_string())
}

fn configured_port() -> String {
    env::var("LAKEHOUSE_WRITER_PORT")
        .or_else(|_| env::var("PORT"))
        .unwrap_or_else(|_| "8215".to_string())
}

fn verified_tls_connector() -> Result<postgres_native_tls::MakeTlsConnector, String> {
    let ca_file = env::var("POSTGRES_TLS_CA_FILE").map_err(|_| {
        "POSTGRES_TLS_CA_FILE is required in production for verified PostgreSQL TLS".to_string()
    })?;
    let ca_pem =
        fs::read(&ca_file).map_err(|error| format!("cannot read POSTGRES_TLS_CA_FILE: {error}"))?;
    let certificate = Certificate::from_pem(&ca_pem)
        .map_err(|error| format!("POSTGRES_TLS_CA_FILE is not a valid PEM certificate: {error}"))?;
    let mut builder = TlsConnector::builder();
    builder.add_root_certificate(certificate);
    builder.min_protocol_version(Some(Protocol::Tlsv12));
    let connector = builder
        .build()
        .map_err(|error| format!("cannot build PostgreSQL TLS connector: {error}"))?;
    Ok(postgres_native_tls::MakeTlsConnector::new(connector))
}

// ── State ──────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db_url: String,
    start_time: Instant,
    writes_total: Arc<AtomicU64>,
    writes_failed: Arc<AtomicU64>,
    feature_writes: Arc<AtomicU64>,
    prediction_writes: Arc<AtomicU64>,
    lineage_writes: Arc<AtomicU64>,
    lakehouse_enqueues: Arc<AtomicU64>,
}

impl AppState {
    fn new(db_url: String) -> Self {
        Self {
            db_url,
            start_time: Instant::now(),
            writes_total: Arc::new(AtomicU64::new(0)),
            writes_failed: Arc::new(AtomicU64::new(0)),
            feature_writes: Arc::new(AtomicU64::new(0)),
            prediction_writes: Arc::new(AtomicU64::new(0)),
            lineage_writes: Arc::new(AtomicU64::new(0)),
            lakehouse_enqueues: Arc::new(AtomicU64::new(0)),
        }
    }
}

// ── Request and response types ─────────────────────────────────────────────────

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
    lakehouse_enqueues: u64,
    uptime_seconds: f64,
}

#[derive(Debug)]
enum WriteFailure {
    BadRequest(String),
    Unavailable(String),
}

// ── Input and database helpers ─────────────────────────────────────────────────

fn valid_label(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value == value.trim()
        && !value.contains("..")
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
        })
}

fn checked_json(value: &serde_json::Value, field: &str) -> Result<String, WriteFailure> {
    let encoded = serde_json::to_vec(value).map_err(|error| {
        WriteFailure::BadRequest(format!("{field} cannot be serialized as JSON: {error}"))
    })?;
    if encoded.len() > MAX_JSON_BYTES {
        return Err(WriteFailure::BadRequest(format!(
            "{field} exceeds the {MAX_JSON_BYTES}-byte limit"
        )));
    }
    String::from_utf8(encoded)
        .map_err(|error| WriteFailure::BadRequest(format!("{field} JSON is not UTF-8: {error}")))
}

fn normalized_timestamp(timestamp: Option<String>) -> Result<String, WriteFailure> {
    match timestamp {
        Some(value) => DateTime::parse_from_rfc3339(&value)
            .map(|parsed| parsed.with_timezone(&Utc).to_rfc3339())
            .map_err(|_| WriteFailure::BadRequest("timestamp must be RFC 3339".to_string())),
        None => Ok(Utc::now().to_rfc3339()),
    }
}

fn canonical_outbox_hash(
    table: &str,
    partition_key: &str,
    data: &serde_json::Value,
) -> Result<String, WriteFailure> {
    let encoded = serde_json::to_vec(data).map_err(|error| {
        WriteFailure::BadRequest(format!(
            "Lakehouse outbox record cannot be serialized: {error}"
        ))
    })?;
    if encoded.len() > MAX_JSON_BYTES {
        return Err(WriteFailure::BadRequest(format!(
            "Lakehouse outbox record exceeds the {MAX_JSON_BYTES}-byte limit"
        )));
    }
    let mut hash = Sha256::new();
    for value in [
        table.as_bytes(),
        partition_key.as_bytes(),
        OUTBOX_SCHEMA_VERSION.as_bytes(),
        OUTBOX_SOURCE_SYSTEM.as_bytes(),
        &encoded,
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value);
    }
    Ok(format!("{:x}", hash.finalize()))
}

async fn get_db_client(db_url: &str) -> Result<Client, String> {
    let config: tokio_postgres::Config = db_url
        .parse()
        .map_err(|error| format!("invalid PostgreSQL connection URL: {error}"))?;
    if is_production() {
        let tls = verified_tls_connector()?;
        let (client, connection) = config
            .connect(tls)
            .await
            .map_err(|error| format!("verified PostgreSQL TLS connection failed: {error}"))?;
        tokio::spawn(async move {
            if let Err(error) = connection.await {
                log::error!("[Lakehouse] PostgreSQL TLS connection error: {error}");
            }
        });
        return Ok(client);
    }

    let (client, connection) = config
        .connect(NoTls)
        .await
        .map_err(|error| format!("PostgreSQL connection failed: {error}"))?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            log::error!("[Lakehouse] PostgreSQL connection error: {error}");
        }
    });
    Ok(client)
}

async fn ensure_migration_tables(client: &Client) -> Result<(), String> {
    let row = client
        .query_one(
            "SELECT to_regclass('public.lakehouse_ingest_records') IS NOT NULL
                    AND to_regclass('public.ml_feature_store') IS NOT NULL
                    AND to_regclass('public.ml_prediction_log') IS NOT NULL
                    AND to_regclass('public.ml_lineage') IS NOT NULL",
            &[],
        )
        .await
        .map_err(|error| format!("cannot verify migration-owned Lakehouse tables: {error}"))?;
    if row.get::<_, bool>(0) {
        Ok(())
    } else {
        Err(
            "Lakehouse migration 0039 has not been applied; refusing to use runtime DDL"
                .to_string(),
        )
    }
}

async fn enqueue_lakehouse_delivery(
    transaction: &Transaction<'_>,
    table: &str,
    data: &serde_json::Value,
) -> Result<(), WriteFailure> {
    let partition_key = Utc::now().format("%Y-%m-%d").to_string();
    let record_hash = canonical_outbox_hash(table, &partition_key, data)?;
    let data_json = checked_json(data, "Lakehouse outbox record")?;
    let outbox_id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO lakehouse_ingest_records
                 (id, table_name, partition_key, data, schema_version, source_system, record_hash, delivery_status, next_attempt_at)
             VALUES
                 ($1::text::uuid, $2, $3, $4::text::jsonb, $5, $6, $7, 'pending', NOW())
             ON CONFLICT (record_hash) DO NOTHING",
            &[
                &outbox_id,
                &table,
                &partition_key,
                &data_json,
                &OUTBOX_SCHEMA_VERSION,
                &OUTBOX_SOURCE_SYSTEM,
                &record_hash,
            ],
        )
        .await
        .map_err(|error| WriteFailure::Unavailable(format!("durable Lakehouse enqueue failed: {error}")))?;
    Ok(())
}

fn unavailable(error: impl Into<String>) -> WriteFailure {
    WriteFailure::Unavailable(error.into())
}

fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(serde_json::json!({"success": false, "error": message.into()})),
    )
        .into_response()
}

fn failed_write_response(state: &AppState, failure: WriteFailure) -> Response {
    state.writes_failed.fetch_add(1, Ordering::Relaxed);
    match failure {
        WriteFailure::BadRequest(message) => error_response(StatusCode::BAD_REQUEST, message),
        WriteFailure::Unavailable(error) => {
            log::error!("[Lakehouse] Durable writer operation failed: {error}");
            error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "durable Lakehouse write is unavailable",
            )
        }
    }
}

fn successful_write_response(response: WriteResponse) -> Response {
    (StatusCode::CREATED, Json(response)).into_response()
}

// ── Durable write operations ───────────────────────────────────────────────────

async fn persist_feature(
    state: &AppState,
    req: FeatureWriteRequest,
) -> Result<WriteResponse, WriteFailure> {
    if !valid_label(&req.feature_group, MAX_LABEL_LENGTH)
        || !valid_label(&req.entity_id, MAX_LABEL_LENGTH)
        || !valid_label(&req.entity_type, MAX_LABEL_LENGTH)
    {
        return Err(WriteFailure::BadRequest(
            "feature_group, entity_id, and entity_type must be bounded non-empty labels"
                .to_string(),
        ));
    }
    if req.features.is_empty() {
        return Err(WriteFailure::BadRequest(
            "features must contain at least one value".to_string(),
        ));
    }

    let timestamp = normalized_timestamp(req.timestamp)?;
    let features = serde_json::to_value(&req.features)
        .map_err(|error| WriteFailure::BadRequest(format!("features are invalid: {error}")))?;
    let features_json = checked_json(&features, "features")?;
    let record_id = Uuid::new_v4().to_string();
    let durable_event = serde_json::json!({
        "record_id": &record_id,
        "feature_group": &req.feature_group,
        "entity_id": &req.entity_id,
        "entity_type": &req.entity_type,
        "features": &features,
        "recorded_at": &timestamp,
    });

    let mut client = get_db_client(&state.db_url).await.map_err(unavailable)?;
    let transaction = client.transaction().await.map_err(|error| {
        unavailable(format!(
            "cannot begin Lakehouse feature transaction: {error}"
        ))
    })?;
    transaction
        .execute(
            "INSERT INTO ml_feature_store (id, feature_group, entity_id, entity_type, features, recorded_at)
             VALUES ($1::text::uuid, $2, $3, $4, $5::text::jsonb, $6::text::timestamptz)
             ON CONFLICT (feature_group, entity_id) DO UPDATE
             SET features = EXCLUDED.features, entity_type = EXCLUDED.entity_type,
                 recorded_at = EXCLUDED.recorded_at",
            &[
                &record_id,
                &req.feature_group,
                &req.entity_id,
                &req.entity_type,
                &features_json,
                &timestamp,
            ],
        )
        .await
        .map_err(|error| unavailable(format!("durable feature write failed: {error}")))?;
    enqueue_lakehouse_delivery(&transaction, "ml_features", &durable_event).await?;
    transaction.commit().await.map_err(|error| {
        unavailable(format!(
            "Lakehouse feature transaction commit failed: {error}"
        ))
    })?;

    state.writes_total.fetch_add(1, Ordering::Relaxed);
    state.feature_writes.fetch_add(1, Ordering::Relaxed);
    state.lakehouse_enqueues.fetch_add(1, Ordering::Relaxed);
    Ok(WriteResponse {
        status: "written".to_string(),
        record_id,
        timestamp,
        feature_group: Some(req.feature_group),
    })
}

async fn persist_prediction(
    state: &AppState,
    req: PredictionLogRequest,
) -> Result<WriteResponse, WriteFailure> {
    if !valid_label(&req.model_name, MAX_LABEL_LENGTH)
        || !valid_label(&req.model_version, MAX_LABEL_LENGTH)
        || !valid_label(&req.entity_id, MAX_LABEL_LENGTH)
    {
        return Err(WriteFailure::BadRequest(
            "model_name, model_version, and entity_id must be bounded non-empty labels".to_string(),
        ));
    }
    if req.input_features.is_empty() {
        return Err(WriteFailure::BadRequest(
            "input_features must contain at least one value".to_string(),
        ));
    }
    if !req.confidence.is_finite() || !(0.0..=1.0).contains(&req.confidence) {
        return Err(WriteFailure::BadRequest(
            "confidence must be a finite value from 0 to 1".to_string(),
        ));
    }
    let latency_ms = i64::try_from(req.latency_ms)
        .map_err(|_| WriteFailure::BadRequest("latency_ms exceeds BIGINT".to_string()))?;
    let input_features = serde_json::to_value(&req.input_features).map_err(|error| {
        WriteFailure::BadRequest(format!("input_features are invalid: {error}"))
    })?;
    let input_json = checked_json(&input_features, "input_features")?;
    let prediction_json = checked_json(&req.prediction, "prediction")?;
    let timestamp = Utc::now().to_rfc3339();
    let record_id = Uuid::new_v4().to_string();
    let durable_event = serde_json::json!({
        "record_id": &record_id,
        "model_name": &req.model_name,
        "model_version": &req.model_version,
        "entity_id": &req.entity_id,
        "input_features": &input_features,
        "prediction": &req.prediction,
        "confidence": req.confidence,
        "latency_ms": req.latency_ms,
        "predicted_at": &timestamp,
    });

    let mut client = get_db_client(&state.db_url).await.map_err(unavailable)?;
    let transaction = client.transaction().await.map_err(|error| {
        unavailable(format!(
            "cannot begin Lakehouse prediction transaction: {error}"
        ))
    })?;
    transaction
        .execute(
            "INSERT INTO ml_prediction_log
                 (id, model_name, model_version, entity_id, input_features, prediction, confidence, latency_ms, predicted_at)
             VALUES ($1::text::uuid, $2, $3, $4, $5::text::jsonb, $6::text::jsonb, $7, $8::bigint, $9::text::timestamptz)",
            &[
                &record_id,
                &req.model_name,
                &req.model_version,
                &req.entity_id,
                &input_json,
                &prediction_json,
                &req.confidence,
                &latency_ms,
                &timestamp,
            ],
        )
        .await
        .map_err(|error| unavailable(format!("durable prediction write failed: {error}")))?;
    enqueue_lakehouse_delivery(&transaction, "ml_predictions", &durable_event).await?;
    transaction.commit().await.map_err(|error| {
        unavailable(format!(
            "Lakehouse prediction transaction commit failed: {error}"
        ))
    })?;

    state.writes_total.fetch_add(1, Ordering::Relaxed);
    state.prediction_writes.fetch_add(1, Ordering::Relaxed);
    state.lakehouse_enqueues.fetch_add(1, Ordering::Relaxed);
    Ok(WriteResponse {
        status: "logged".to_string(),
        record_id,
        timestamp,
        feature_group: Some(format!("prediction:{}", req.model_name)),
    })
}

async fn persist_lineage(
    state: &AppState,
    req: LineageRequest,
) -> Result<WriteResponse, WriteFailure> {
    if !valid_label(&req.source_table, MAX_LABEL_LENGTH)
        || !valid_label(&req.target_table, MAX_LABEL_LENGTH)
        || !valid_label(&req.transformation, MAX_LABEL_LENGTH)
        || !valid_label(&req.pipeline_run_id, MAX_LABEL_LENGTH)
    {
        return Err(WriteFailure::BadRequest(
            "lineage fields must be bounded non-empty labels".to_string(),
        ));
    }
    let record_count = i64::try_from(req.record_count)
        .map_err(|_| WriteFailure::BadRequest("record_count exceeds BIGINT".to_string()))?;
    let timestamp = Utc::now().to_rfc3339();
    let record_id = Uuid::new_v4().to_string();
    let durable_event = serde_json::json!({
        "record_id": &record_id,
        "source_table": &req.source_table,
        "target_table": &req.target_table,
        "transformation": &req.transformation,
        "record_count": req.record_count,
        "pipeline_run_id": &req.pipeline_run_id,
        "created_at": &timestamp,
    });

    let mut client = get_db_client(&state.db_url).await.map_err(unavailable)?;
    let transaction = client.transaction().await.map_err(|error| {
        unavailable(format!(
            "cannot begin Lakehouse lineage transaction: {error}"
        ))
    })?;
    transaction
        .execute(
            "INSERT INTO ml_lineage
                 (id, source_table, target_table, transformation, record_count, pipeline_run_id, created_at)
             VALUES ($1::text::uuid, $2, $3, $4, $5::bigint, $6, $7::text::timestamptz)",
            &[
                &record_id,
                &req.source_table,
                &req.target_table,
                &req.transformation,
                &record_count,
                &req.pipeline_run_id,
                &timestamp,
            ],
        )
        .await
        .map_err(|error| unavailable(format!("durable lineage write failed: {error}")))?;
    enqueue_lakehouse_delivery(&transaction, "ml_lineage", &durable_event).await?;
    transaction.commit().await.map_err(|error| {
        unavailable(format!(
            "Lakehouse lineage transaction commit failed: {error}"
        ))
    })?;

    state.writes_total.fetch_add(1, Ordering::Relaxed);
    state.lineage_writes.fetch_add(1, Ordering::Relaxed);
    state.lakehouse_enqueues.fetch_add(1, Ordering::Relaxed);
    Ok(WriteResponse {
        status: "lineage_recorded".to_string(),
        record_id,
        timestamp,
        feature_group: None,
    })
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Response {
    let status = match get_db_client(&state.db_url).await {
        Ok(client) => match ensure_migration_tables(&client).await {
            Ok(()) => (StatusCode::OK, "healthy".to_string()),
            Err(error) => {
                log::error!("[Lakehouse] health check migration validation failed: {error}");
                (StatusCode::SERVICE_UNAVAILABLE, "unavailable".to_string())
            }
        },
        Err(error) => {
            log::error!("[Lakehouse] health check database validation failed: {error}");
            (StatusCode::SERVICE_UNAVAILABLE, "unavailable".to_string())
        }
    };
    (
        status.0,
        Json(HealthResponse {
            status: status.1,
            worker: "lakehouse_writer".to_string(),
            writes_total: state.writes_total.load(Ordering::Relaxed),
            writes_failed: state.writes_failed.load(Ordering::Relaxed),
            feature_writes: state.feature_writes.load(Ordering::Relaxed),
            prediction_writes: state.prediction_writes.load(Ordering::Relaxed),
            lineage_writes: state.lineage_writes.load(Ordering::Relaxed),
            lakehouse_enqueues: state.lakehouse_enqueues.load(Ordering::Relaxed),
            uptime_seconds: state.start_time.elapsed().as_secs_f64(),
        }),
    )
        .into_response()
}

async fn write_features(
    State(state): State<AppState>,
    Json(req): Json<FeatureWriteRequest>,
) -> Response {
    match persist_feature(&state, req).await {
        Ok(response) => successful_write_response(response),
        Err(failure) => failed_write_response(&state, failure),
    }
}

async fn log_prediction(
    State(state): State<AppState>,
    Json(req): Json<PredictionLogRequest>,
) -> Response {
    match persist_prediction(&state, req).await {
        Ok(response) => successful_write_response(response),
        Err(failure) => failed_write_response(&state, failure),
    }
}

async fn write_lineage(State(state): State<AppState>, Json(req): Json<LineageRequest>) -> Response {
    match persist_lineage(&state, req).await {
        Ok(response) => successful_write_response(response),
        Err(failure) => failed_write_response(&state, failure),
    }
}

async fn get_features(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> Response {
    let feature_group = req
        .get("feature_group")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let entity_id = req
        .get("entity_id")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if !valid_label(feature_group, MAX_LABEL_LENGTH) || !valid_label(entity_id, MAX_LABEL_LENGTH) {
        return error_response(
            StatusCode::BAD_REQUEST,
            "feature_group and entity_id must be bounded non-empty labels",
        );
    }

    let client = match get_db_client(&state.db_url).await {
        Ok(client) => client,
        Err(error) => {
            log::error!("[Lakehouse] feature read database connection failed: {error}");
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "durable Lakehouse feature store is unavailable",
            );
        }
    };
    let rows = match client
        .query(
            "SELECT id::text, feature_group, entity_id, entity_type, features, recorded_at::text
             FROM ml_feature_store
             WHERE feature_group = $1 AND entity_id = $2
             ORDER BY recorded_at DESC
             LIMIT 1",
            &[&feature_group, &entity_id],
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            log::error!("[Lakehouse] feature read failed: {error}");
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "durable Lakehouse feature store is unavailable",
            );
        }
    };

    match rows.first() {
        Some(row) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "found": true,
                "record_id": row.get::<_, String>(0),
                "feature_group": row.get::<_, String>(1),
                "entity_id": row.get::<_, String>(2),
                "entity_type": row.get::<_, String>(3),
                "features": row.get::<_, serde_json::Value>(4),
                "recorded_at": row.get::<_, String>(5),
            })),
        )
            .into_response(),
        None => (
            StatusCode::OK,
            Json(serde_json::json!({
                "found": false,
                "feature_group": feature_group,
                "entity_id": entity_id,
            })),
        )
            .into_response(),
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    env_logger::init();
    let db_url = required_postgres_url().unwrap_or_else(|error| panic!("{error}"));
    let port = configured_port();

    let client = get_db_client(&db_url)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse writer PostgreSQL connection failed: {error}"));
    ensure_migration_tables(&client)
        .await
        .unwrap_or_else(|error| {
            panic!("Lakehouse writer migration-owned tables are not ready: {error}")
        });
    log::info!("[Lakehouse] PostgreSQL migration-owned tables are reachable");

    let state = AppState::new(db_url);
    let app = Router::new()
        .route("/health", get(health))
        .route("/features/write", post(write_features))
        .route("/features/get", post(get_features))
        .route("/predictions/log", post(log_prediction))
        .route("/lineage/write", post(write_lineage))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    log::info!("[Lakehouse] Lakehouse Feature Store Writer listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse writer cannot bind {addr}: {error}"));
    axum::serve(listener, app)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse writer server failed: {error}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disposable_database_url() -> Option<String> {
        let url = env::var("LAKEHOUSE_WRITER_TEST_DATABASE_URL")
            .or_else(|_| env::var("LAKEHOUSE_INGEST_TEST_DATABASE_URL"))
            .ok()?;
        if url
            .rsplit_once('@')
            .map(|(_, authority)| {
                authority.starts_with("127.0.0.1:") || authority.starts_with("localhost:")
            })
            .unwrap_or(false)
        {
            Some(url)
        } else {
            panic!("Lakehouse writer test database must target disposable localhost PostgreSQL")
        }
    }

    #[test]
    fn rejects_invalid_external_labels() {
        assert!(valid_label("risk-features/v1", MAX_LABEL_LENGTH));
        assert!(!valid_label("", MAX_LABEL_LENGTH));
        assert!(!valid_label("has space", MAX_LABEL_LENGTH));
        assert!(!valid_label("../traversal", MAX_LABEL_LENGTH));
    }

    #[tokio::test]
    async fn database_unavailability_is_an_error_not_a_success_response() {
        let state = AppState::new("not-a-postgres-url".to_string());
        let result = persist_feature(
            &state,
            FeatureWriteRequest {
                feature_group: "test-group".to_string(),
                entity_id: "entity-1".to_string(),
                entity_type: "organization".to_string(),
                features: HashMap::from([("score".to_string(), serde_json::json!(0.42))]),
                timestamp: None,
            },
        )
        .await;
        assert!(matches!(result, Err(WriteFailure::Unavailable(_))));
        assert_eq!(state.writes_total.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn feature_write_commits_primary_row_and_durable_lakehouse_ledger_together() {
        let Some(url) = disposable_database_url() else {
            return;
        };
        let (client, connection) = tokio_postgres::connect(&url, NoTls)
            .await
            .expect("connect disposable Lakehouse writer database");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
            .batch_execute(include_str!(
                "../../../../drizzle/0039_lakehouse_durable_postgres_storage.sql"
            ))
            .await
            .expect("apply active Lakehouse migration");

        let group = format!("writer-test-{}", Uuid::new_v4());
        let state = AppState::new(url);
        let response = persist_feature(
            &state,
            FeatureWriteRequest {
                feature_group: group.clone(),
                entity_id: "organization-1".to_string(),
                entity_type: "organization".to_string(),
                features: HashMap::from([("risk_score".to_string(), serde_json::json!(0.42))]),
                timestamp: Some("2026-09-01T12:00:00Z".to_string()),
            },
        )
        .await
        .expect("persist primary ML feature and durable Lakehouse event");

        let primary_count: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM ml_feature_store WHERE feature_group = $1",
                &[&group],
            )
            .await
            .expect("read primary row")
            .get(0);
        let ledger_count: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM lakehouse_ingest_records
                 WHERE table_name = 'ml_features' AND source_system = $1
                   AND data->>'record_id' = $2",
                &[&OUTBOX_SOURCE_SYSTEM, &response.record_id],
            )
            .await
            .expect("read durable Lakehouse ledger row")
            .get(0);
        assert_eq!(primary_count, 1);
        assert_eq!(ledger_count, 1);
        assert_eq!(state.writes_total.load(Ordering::Relaxed), 1);
        assert_eq!(state.lakehouse_enqueues.load(Ordering::Relaxed), 1);

        client
            .execute(
                "DELETE FROM ml_feature_store WHERE feature_group = $1",
                &[&group],
            )
            .await
            .expect("clean primary test row");
        client
            .execute(
                "DELETE FROM lakehouse_ingest_records WHERE data->>'record_id' = $1",
                &[&response.record_id],
            )
            .await
            .expect("clean durable ledger test row");
    }
}
