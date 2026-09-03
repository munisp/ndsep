//! NDSEP Lakehouse ingest worker.
//!
//! This service persists every accepted record to PostgreSQL before it is made
//! available for downstream Lakehouse delivery. PostgreSQL is the source of
//! truth for ingestion, retry, query, and delivery state; the process keeps no
//! authoritative event queue or business-record cache.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use lazy_static::lazy_static;
use native_tls::{Certificate, Protocol, TlsConnector};
use prometheus::{Counter, Encoder, Gauge, Registry, TextEncoder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, env, fs, sync::Arc, time::Duration};
use tokio_postgres::Client;
use uuid::Uuid;

const CLAIM_LIMIT: i64 = 500;
const MAX_INGEST_RECORDS: usize = 1_000;
const MAX_RECORD_BYTES: usize = 1_000_000;
const DELIVERY_LEASE_SECONDS: i64 = 60;

lazy_static! {
    static ref REGISTRY: Registry = Registry::new();
    static ref INGEST_COUNTER: Counter = Counter::new(
        "ndsep_lakehouse_records_ingested_total",
        "Total unique records durably accepted into PostgreSQL"
    )
    .expect("valid ingest counter");
    static ref BATCH_COUNTER: Counter = Counter::new(
        "ndsep_lakehouse_batches_total",
        "Total durable Lakehouse delivery batches claimed"
    )
    .expect("valid batch counter");
    static ref ERROR_COUNTER: Counter = Counter::new(
        "ndsep_lakehouse_errors_total",
        "Total failed Lakehouse ingestion or delivery operations"
    )
    .expect("valid error counter");
    static ref QUEUE_GAUGE: Gauge = Gauge::new(
        "ndsep_lakehouse_queue_depth",
        "Persisted Lakehouse records awaiting delivery"
    )
    .expect("valid queue gauge");
}

fn init_metrics() {
    REGISTRY.register(Box::new(INGEST_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(BATCH_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(ERROR_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(QUEUE_GAUGE.clone())).ok();
}

const LAKEHOUSE_TABLES: &[(&str, &str, &str)] = &[
    (
        "compliance_events",
        "sector,event_date",
        "Compliance events from all sectors",
    ),
    (
        "aml_cases",
        "status,created_date",
        "AML case lifecycle events",
    ),
    (
        "kyc_records",
        "nationality,created_date",
        "KYC verification records",
    ),
    (
        "fines_and_penalties",
        "sector,status",
        "Regulatory fines and penalties",
    ),
    (
        "accreditation_history",
        "state,sector",
        "Accreditation state machine transitions",
    ),
    (
        "watchlist_hits",
        "list_type,hit_date",
        "Watchlist screening results",
    ),
    (
        "audit_trail",
        "action,entity_type",
        "Full platform audit trail",
    ),
    (
        "breach_notifications",
        "severity,status",
        "Data breach notification events",
    ),
    (
        "cross_agency_alerts",
        "priority,sector",
        "Cross-agency regulatory alerts",
    ),
    (
        "financial_transactions",
        "transfer_type,date",
        "TigerBeetle ledger transactions",
    ),
    (
        "sector_metrics",
        "sector,metric_date",
        "Sector compliance metrics",
    ),
    (
        "regulatory_reports",
        "report_type,period",
        "Generated regulatory reports",
    ),
    (
        "ml_features",
        "feature_group,recorded_at",
        "Durable ML feature-store updates",
    ),
    (
        "ml_predictions",
        "model_name,predicted_at",
        "Durable ML prediction-log records",
    ),
    (
        "ml_lineage",
        "pipeline_run_id,created_at",
        "Durable ML lineage records",
    ),
];

#[derive(Debug, Clone, Serialize)]
struct LakehouseRecord {
    id: String,
    table: String,
    partition_key: String,
    data: serde_json::Value,
    schema_version: String,
    ingested_at: String,
    source_system: String,
}

#[derive(Debug, Deserialize)]
struct IngestRequest {
    table: String,
    records: Vec<serde_json::Value>,
    partition_key: Option<String>,
    schema_version: Option<String>,
    source_system: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QueryRequest {
    table: String,
    filters: Option<serde_json::Value>,
    limit: Option<u32>,
    offset: Option<u32>,
    partition: Option<String>,
}

#[derive(Clone)]
struct AppState {
    db: Arc<Client>,
    http: reqwest::Client,
    lakehouse_url: String,
    start_time: std::time::Instant,
}

fn configured_database_url() -> Result<String, String> {
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
    Err("LAKEHOUSE_DATABASE_URL, WORKER_DATABASE_URL, or DATABASE_URL is required; Lakehouse ingestion has no in-memory fallback".to_string())
}

fn required_lakehouse_url() -> Result<String, String> {
    let value = env::var("LAKEHOUSE_URL")
        .map_err(|_| {
            "LAKEHOUSE_URL is required; durable records cannot be silently dropped".to_string()
        })?
        .trim()
        .trim_end_matches('/')
        .to_string();
    if !(value.starts_with("https://")
        || (env::var("NODE_ENV").unwrap_or_default() != "production"
            && value.starts_with("http://")))
    {
        return Err(
            "LAKEHOUSE_URL must use HTTPS in production and be an absolute HTTP(S) URL".to_string(),
        );
    }
    Ok(value)
}

fn configured_port() -> String {
    env::var("LAKEHOUSE_INGEST_PORT").unwrap_or_else(|_| "8163".to_string())
}

fn is_production() -> bool {
    env::var("NODE_ENV")
        .map(|value| value.eq_ignore_ascii_case("production"))
        .unwrap_or(false)
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

async fn connect_database(database_url: &str) -> Result<Client, String> {
    let config: tokio_postgres::Config = database_url
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
                tracing::error!("Lakehouse PostgreSQL TLS connection terminated: {error}");
            }
        });
        return Ok(client);
    }

    let (client, connection) = config
        .connect(tokio_postgres::NoTls)
        .await
        .map_err(|error| format!("Lakehouse PostgreSQL connection failed: {error}"))?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            tracing::error!("Lakehouse PostgreSQL connection terminated: {error}");
        }
    });
    Ok(client)
}

fn allowed_table(table: &str) -> bool {
    LAKEHOUSE_TABLES.iter().any(|(name, _, _)| *name == table)
}

fn is_safe_label(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.contains("..")
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'=' | b'/')
        })
}

fn canonical_record_hash(
    table: &str,
    partition_key: &str,
    schema_version: &str,
    source_system: &str,
    data: &serde_json::Value,
) -> Result<String, String> {
    let encoded = serde_json::to_vec(data)
        .map_err(|error| format!("record serialization failed: {error}"))?;
    if encoded.len() > MAX_RECORD_BYTES {
        return Err(format!("record exceeds {MAX_RECORD_BYTES} byte limit"));
    }
    let mut hash = Sha256::new();
    for value in [
        table.as_bytes(),
        partition_key.as_bytes(),
        schema_version.as_bytes(),
        source_system.as_bytes(),
        &encoded,
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn error_response(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({"success": false, "error": message.into()})),
    )
}

async fn pending_depth(db: &Client) -> Result<i64, tokio_postgres::Error> {
    let row = db
        .query_one(
            "SELECT COUNT(*) FROM lakehouse_ingest_records WHERE delivery_status IN ('pending', 'retry') AND next_attempt_at <= NOW()",
            &[],
        )
        .await?;
    Ok(row.get(0))
}

async fn ingest_records(
    State(state): State<AppState>,
    Json(req): Json<IngestRequest>,
) -> impl IntoResponse {
    if !allowed_table(&req.table) {
        return error_response(StatusCode::BAD_REQUEST, "unsupported Lakehouse table");
    }
    if req.records.is_empty() || req.records.len() > MAX_INGEST_RECORDS {
        return error_response(
            StatusCode::BAD_REQUEST,
            format!("records must contain between 1 and {MAX_INGEST_RECORDS} values"),
        );
    }

    let partition_key = req
        .partition_key
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let schema_version = req.schema_version.unwrap_or_else(|| "1.0".to_string());
    let source_system = req
        .source_system
        .unwrap_or_else(|| "ndsep-platform".to_string());
    if !is_safe_label(&partition_key, 128)
        || !is_safe_label(&schema_version, 64)
        || !is_safe_label(&source_system, 128)
    {
        return error_response(
            StatusCode::BAD_REQUEST,
            "partition_key, schema_version, or source_system is invalid",
        );
    }

    let mut accepted = 0_u64;
    let mut duplicates = 0_u64;
    for data in req.records {
        let record_hash = match canonical_record_hash(
            &req.table,
            &partition_key,
            &schema_version,
            &source_system,
            &data,
        ) {
            Ok(hash) => hash,
            Err(error) => return error_response(StatusCode::BAD_REQUEST, error),
        };
        let data_json = data.to_string();
        let id = Uuid::new_v4().to_string();
        match state
            .db
            .execute(
                "INSERT INTO lakehouse_ingest_records (id, table_name, partition_key, data, schema_version, source_system, record_hash, delivery_status, next_attempt_at)
                 VALUES ($1::text::uuid, $2, $3, $4::text::jsonb, $5, $6, $7, 'pending', NOW())
                 ON CONFLICT (record_hash) DO NOTHING",
                &[&id, &req.table, &partition_key, &data_json, &schema_version, &source_system, &record_hash],
            )
            .await
        {
            Ok(1) => accepted += 1,
            Ok(_) => duplicates += 1,
            Err(error) => {
                ERROR_COUNTER.inc();
                return error_response(StatusCode::SERVICE_UNAVAILABLE, format!("durable Lakehouse insert failed: {error}"));
            }
        }
    }

    INGEST_COUNTER.inc_by(accepted as f64);
    match pending_depth(&state.db).await {
        Ok(depth) => QUEUE_GAUGE.set(depth as f64),
        Err(_) => ERROR_COUNTER.inc(),
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "success": true,
            "table": req.table,
            "accepted": accepted,
            "duplicates": duplicates,
            "partitionKey": partition_key,
            "schemaVersion": schema_version,
            "timestamp": Utc::now().to_rfc3339(),
        })),
    )
}

async fn claim_records(db: &Client) -> Result<Vec<LakehouseRecord>, tokio_postgres::Error> {
    let rows = db
        .query(
            "WITH claimable AS (
                SELECT id FROM lakehouse_ingest_records
                WHERE delivery_status IN ('pending', 'retry') AND next_attempt_at <= NOW()
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $1
             ), claimed AS (
                UPDATE lakehouse_ingest_records record
                SET delivery_status = 'sending', attempts = attempts + 1,
                    leased_at = NOW(), lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
                    updated_at = NOW()
                FROM claimable
                WHERE record.id = claimable.id
                RETURNING record.id::text, record.table_name, record.partition_key, record.data,
                          record.schema_version, record.created_at::text, record.source_system
             ) SELECT * FROM claimed",
            &[&CLAIM_LIMIT, &DELIVERY_LEASE_SECONDS.to_string()],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|row| LakehouseRecord {
            id: row.get(0),
            table: row.get(1),
            partition_key: row.get(2),
            data: row.get(3),
            schema_version: row.get(4),
            ingested_at: row.get(5),
            source_system: row.get(6),
        })
        .collect())
}

async fn mark_delivery_success(
    db: &Client,
    records: &[LakehouseRecord],
) -> Result<(), tokio_postgres::Error> {
    for record in records {
        db.execute(
            "UPDATE lakehouse_ingest_records
             SET delivery_status = 'delivered', delivered_at = NOW(), leased_at = NULL,
                 lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
             WHERE id = $1::text::uuid AND delivery_status = 'sending'",
            &[&record.id],
        )
        .await?;
    }
    Ok(())
}

async fn reschedule_delivery(
    db: &Client,
    records: &[LakehouseRecord],
    error: &str,
) -> Result<(), tokio_postgres::Error> {
    let sanitized = error.chars().take(512).collect::<String>();
    for record in records {
        db.execute(
            "UPDATE lakehouse_ingest_records
             SET delivery_status = 'retry', leased_at = NULL, lease_expires_at = NULL,
                 last_error = $2,
                 next_attempt_at = NOW() + make_interval(secs => LEAST(900, GREATEST(30, attempts * 30))),
                 updated_at = NOW()
             WHERE id = $1::text::uuid AND delivery_status = 'sending'",
            &[&record.id, &sanitized],
        )
        .await?;
    }
    Ok(())
}

async fn recover_expired_leases(db: &Client) -> Result<u64, tokio_postgres::Error> {
    db.execute(
        "UPDATE lakehouse_ingest_records
         SET delivery_status = 'retry', leased_at = NULL, lease_expires_at = NULL,
             next_attempt_at = NOW(), last_error = COALESCE(last_error, 'delivery lease expired'), updated_at = NOW()
         WHERE delivery_status = 'sending' AND lease_expires_at < NOW()",
        &[],
    )
    .await
}

async fn flush_buffer(State(state): State<AppState>) -> axum::response::Response {
    if let Err(error) = recover_expired_leases(&state.db).await {
        ERROR_COUNTER.inc();
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("lease recovery failed: {error}"),
        )
        .into_response();
    }
    let records = match claim_records(&state.db).await {
        Ok(records) => records,
        Err(error) => {
            ERROR_COUNTER.inc();
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("durable Lakehouse claim failed: {error}"),
            )
            .into_response();
        }
    };
    if records.is_empty() {
        return (
            StatusCode::OK,
            Json(serde_json::json!({"success": true, "flushed": 0, "tables": []})),
        )
            .into_response();
    }

    BATCH_COUNTER.inc();
    let mut grouped: HashMap<String, Vec<LakehouseRecord>> = HashMap::new();
    for record in records {
        grouped
            .entry(record.table.clone())
            .or_default()
            .push(record);
    }

    let mut succeeded = 0_usize;
    let mut failed = 0_usize;
    let mut table_summary = Vec::new();
    for (table, table_records) in grouped {
        let payload = serde_json::json!({
            "namespace": "ndsep",
            "table": table,
            "records": table_records.iter().map(|record| &record.data).collect::<Vec<_>>(),
        });
        let result = state
            .http
            .post(format!("{}/ingest", state.lakehouse_url))
            .json(&payload)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
        let (status, outcome) = match result {
            Ok(response) if response.status().is_success() => {
                match mark_delivery_success(&state.db, &table_records).await {
                    Ok(()) => {
                        succeeded += table_records.len();
                        ("delivered", None)
                    }
                    Err(error) => {
                        ERROR_COUNTER.inc();
                        let detail =
                            format!("delivery acknowledgement could not be persisted: {error}");
                        let _ = reschedule_delivery(&state.db, &table_records, &detail).await;
                        failed += table_records.len();
                        ("persistence_failed", Some(detail))
                    }
                }
            }
            Ok(response) => {
                let detail = format!("Lakehouse endpoint returned HTTP {}", response.status());
                let _ = reschedule_delivery(&state.db, &table_records, &detail).await;
                failed += table_records.len();
                ("retry_scheduled", Some(detail))
            }
            Err(error) => {
                let detail = format!("Lakehouse endpoint request failed: {error}");
                let _ = reschedule_delivery(&state.db, &table_records, &detail).await;
                failed += table_records.len();
                ("retry_scheduled", Some(detail))
            }
        };
        table_summary.push(serde_json::json!({
            "table": table,
            "records": table_records.len(),
            "delivery_status": status,
            "error": outcome,
        }));
    }

    let depth = pending_depth(&state.db).await.unwrap_or(-1);
    if depth >= 0 {
        QUEUE_GAUGE.set(depth as f64);
    }
    if failed > 0 {
        ERROR_COUNTER.inc_by(failed as f64);
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "success": false,
                "delivered": succeeded,
                "retry_scheduled": failed,
                "tables": table_summary,
                "timestamp": Utc::now().to_rfc3339(),
            })),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "delivered": succeeded,
            "tables": table_summary,
            "timestamp": Utc::now().to_rfc3339(),
        })),
    )
        .into_response()
}

async fn query_table(
    State(state): State<AppState>,
    Json(req): Json<QueryRequest>,
) -> impl IntoResponse {
    if !allowed_table(&req.table) {
        return error_response(StatusCode::BAD_REQUEST, "unsupported Lakehouse table")
            .into_response();
    }
    let limit = req.limit.unwrap_or(20).clamp(1, 500) as i64;
    let offset = req.offset.unwrap_or(0).min(100_000) as i64;
    if let Some(partition) = &req.partition {
        if !is_safe_label(partition, 128) {
            return error_response(StatusCode::BAD_REQUEST, "partition is invalid").into_response();
        }
    }
    let filters_json = match req.filters {
        Some(filters) if filters.is_object() => filters.to_string(),
        Some(_) => {
            return error_response(StatusCode::BAD_REQUEST, "filters must be a JSON object")
                .into_response()
        }
        None => "{}".to_string(),
    };
    let partition = req.partition.unwrap_or_default();

    let rows = match state
        .db
        .query(
            "SELECT id::text, table_name, partition_key, data, schema_version, created_at::text, source_system
             FROM lakehouse_ingest_records
             WHERE table_name = $1
               AND ($2 = '' OR partition_key LIKE $2 || '%')
               AND ($3::text::jsonb = '{}'::jsonb OR data @> $3::text::jsonb)
             ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5",
            &[&req.table, &partition, &filters_json, &limit, &offset],
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            ERROR_COUNTER.inc();
            return error_response(StatusCode::SERVICE_UNAVAILABLE, format!("durable Lakehouse query failed: {error}")).into_response();
        }
    };
    let records = rows
        .iter()
        .map(|row| LakehouseRecord {
            id: row.get(0),
            table: row.get(1),
            partition_key: row.get(2),
            data: row.get(3),
            schema_version: row.get(4),
            ingested_at: row.get(5),
            source_system: row.get(6),
        })
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "table": req.table,
            "records": records,
            "count": records.len(),
            "limit": limit,
            "offset": offset,
        })),
    )
        .into_response()
}

async fn list_tables() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "tables": LAKEHOUSE_TABLES.iter().map(|(name, partition, description)| serde_json::json!({
            "name": name,
            "partitionBy": partition,
            "description": description,
        })).collect::<Vec<_>>(),
        "count": LAKEHOUSE_TABLES.len(),
    }))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match pending_depth(&state.db).await {
        Ok(depth) => {
            QUEUE_GAUGE.set(depth as f64);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "healthy",
                    "service": "ndsep-lakehouse-ingest",
                    "uptime": state.start_time.elapsed().as_secs(),
                    "persisted_queue_depth": depth,
                    "tables": LAKEHOUSE_TABLES.len(),
                })),
            )
                .into_response()
        }
        Err(error) => error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("PostgreSQL health check failed: {error}"),
        )
        .into_response(),
    }
}

async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    if encoder.encode(&metric_families, &mut buffer).is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "metric encoding failed").into_response();
    }
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        String::from_utf8(buffer).unwrap_or_default(),
    )
        .into_response()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    init_metrics();

    let database_url = configured_database_url().unwrap_or_else(|error| panic!("{error}"));
    let lakehouse_url = required_lakehouse_url().unwrap_or_else(|error| panic!("{error}"));
    let db = connect_database(&database_url)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse PostgreSQL connection failed: {error}"));

    let state = AppState {
        db: Arc::new(db),
        http: reqwest::Client::new(),
        lakehouse_url,
        start_time: std::time::Instant::now(),
    };
    let port = configured_port();
    let app = Router::new()
        .route("/ingest", post(ingest_records))
        .route("/flush", post(flush_buffer))
        .route("/query", post(query_table))
        .route("/tables", get(list_tables))
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .with_state(state);

    let address = format!("0.0.0.0:{port}");
    tracing::info!("NDSEP Lakehouse ingest worker starting on {address}");
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse ingest bind failed: {error}"));
    axum::serve(listener, app)
        .await
        .unwrap_or_else(|error| panic!("Lakehouse ingest server failed: {error}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_tables_and_invalid_labels() {
        assert!(!allowed_table("unknown_table"));
        assert!(!is_safe_label("../escape", 128));
        assert!(is_safe_label("2026-09-01", 128));
    }

    #[test]
    fn canonical_hash_is_stable_and_domain_bound() {
        let event = serde_json::json!({"event": "compliance.created", "id": "evt-1"});
        let first =
            canonical_record_hash("compliance_events", "2026-09-01", "1.0", "ndsep", &event)
                .unwrap();
        let second =
            canonical_record_hash("compliance_events", "2026-09-01", "1.0", "ndsep", &event)
                .unwrap();
        let different_table =
            canonical_record_hash("audit_trail", "2026-09-01", "1.0", "ndsep", &event).unwrap();
        assert_eq!(first, second);
        assert_ne!(first, different_table);
    }

    #[tokio::test]
    async fn postgres_ledger_is_idempotent_and_claimable_when_explicitly_configured() {
        let url = match env::var("LAKEHOUSE_INGEST_TEST_DATABASE_URL") {
            Ok(url)
                if url
                    .rsplit_once('@')
                    .map(|(_, authority)| {
                        authority.starts_with("127.0.0.1:") || authority.starts_with("localhost:")
                    })
                    .unwrap_or(false) =>
            {
                url
            }
            Ok(_) => panic!(
                "LAKEHOUSE_INGEST_TEST_DATABASE_URL must target disposable localhost PostgreSQL"
            ),
            Err(_) => return,
        };
        let (client, connection) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
            .await
            .expect("connect disposable Lakehouse test database");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
            .batch_execute(include_str!(
                "../../../../drizzle/0039_lakehouse_durable_postgres_storage.sql"
            ))
            .await
            .expect("apply active Lakehouse migration");

        let source_system = "rust-ci-lakehouse-test";
        client
            .execute(
                "DELETE FROM lakehouse_ingest_records WHERE source_system = $1",
                &[&source_system],
            )
            .await
            .expect("clear prior test rows");
        let data =
            serde_json::json!({"test_id": Uuid::new_v4().to_string(), "event": "durability"});
        let data_json = data.to_string();
        let record_hash = canonical_record_hash(
            "compliance_events",
            "2026-09-01",
            "1.0",
            source_system,
            &data,
        )
        .unwrap();
        let record_id = Uuid::new_v4().to_string();
        let insert = "INSERT INTO lakehouse_ingest_records (id, table_name, partition_key, data, schema_version, source_system, record_hash, delivery_status, next_attempt_at)
                      VALUES ($1::text::uuid, 'compliance_events', '2026-09-01', $2::text::jsonb, '1.0', $3, $4, 'pending', NOW())
                      ON CONFLICT (record_hash) DO NOTHING";
        assert_eq!(
            client
                .execute(
                    insert,
                    &[&record_id, &data_json, &source_system, &record_hash]
                )
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            client
                .execute(
                    insert,
                    &[
                        &Uuid::new_v4().to_string(),
                        &data_json,
                        &source_system,
                        &record_hash
                    ]
                )
                .await
                .unwrap(),
            0
        );

        let records = claim_records(&client)
            .await
            .expect("claim persisted records");
        let claimed = records
            .iter()
            .find(|record| record.id == record_id)
            .expect("test record is claimed");
        assert_eq!(claimed.data, data);
        mark_delivery_success(&client, std::slice::from_ref(claimed))
            .await
            .expect("persist acknowledgement");
        let status: String = client
            .query_one(
                "SELECT delivery_status FROM lakehouse_ingest_records WHERE id = $1::text::uuid",
                &[&record_id],
            )
            .await
            .expect("read persisted delivery state")
            .get(0);
        assert_eq!(status, "delivered");
        client
            .execute(
                "DELETE FROM lakehouse_ingest_records WHERE source_system = $1",
                &[&source_system],
            )
            .await
            .expect("clean test rows");
    }
}
