// NDSEP Rust Shared Library
use chrono::Utc;
use log::{error, info};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::time::Duration;
use tokio_postgres::{Client, NoTls};

pub mod grpc_interceptors;

pub fn get_db_url() -> String {
    env::var("WORKER_DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db".to_string()
    })
}

pub fn get_relay_url() -> String {
    env::var("WORKER_RELAY_URL")
        .unwrap_or_else(|_| "http://localhost:3000/api/workers/event".to_string())
}

pub async fn connect_db() -> Result<Client, tokio_postgres::Error> {
    let url = get_db_url();
    let (client, connection) = tokio_postgres::connect(&url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            error!("[DB] Connection error: {}", e);
        }
    });
    info!("[DB] Connected to PostgreSQL");
    Ok(client)
}

#[derive(Serialize)]
pub struct RelayPayload {
    pub event: String,
    pub data: Value,
}

pub async fn broadcast(client: &reqwest::Client, event: &str, data: Value) {
    let relay_url = get_relay_url();
    let payload = RelayPayload {
        event: event.to_string(),
        data,
    };
    let _ = client
        .post(&relay_url)
        .json(&payload)
        .timeout(Duration::from_secs(3))
        .send()
        .await;
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkerStatus {
    pub id: String,
    pub name: String,
    pub layer: String,
    pub language: String,
    pub status: String,
    pub description: String,
    pub technology: String,
    pub events_processed: u64,
    pub uptime_seconds: f64,
}

pub fn random_between(min: i64, max: i64) -> i64 {
    rand::thread_rng().gen_range(min..=max)
}

pub fn random_float(min: f64, max: f64) -> f64 {
    rand::thread_rng().gen_range(min..=max)
}

pub fn random_ip() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "{}.{}.{}.{}",
        rng.gen_range(1u8..254),
        rng.gen_range(0u8..255),
        rng.gen_range(0u8..255),
        rng.gen_range(1u8..254)
    )
}

pub fn random_choice<'a>(items: &'a [&str]) -> &'a str {
    items[rand::thread_rng().gen_range(0..items.len())]
}

pub fn now_utc() -> String {
    Utc::now().to_rfc3339()
}

pub fn random_asn() -> u32 {
    rand::thread_rng().gen_range(1000u32..65000)
}

pub fn random_prefix() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "{}.{}.0.0/{}",
        rng.gen_range(10u8..200),
        rng.gen_range(0u8..255),
        rng.gen_range(16u8..28)
    )
}

pub fn health_response(worker: &str) -> Value {
    json!({ "status": "ok", "worker": worker })
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Shutdown — tokio signal handler
// ─────────────────────────────────────────────────────────────────────────────

/// Wait for SIGTERM or SIGINT and return. Use in main() alongside server tasks.
pub async fn wait_for_shutdown(worker_id: &str) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = sigterm.recv() => info!("[{}] Received SIGTERM — shutting down", worker_id),
            _ = sigint.recv()  => info!("[{}] Received SIGINT — shutting down", worker_id),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.expect("ctrl-c handler");
        info!("[{}] Received Ctrl-C — shutting down", worker_id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenTelemetry Tracing — lightweight HTTP OTLP span exporter
// ─────────────────────────────────────────────────────────────────────────────

/// Export a single span to the OTLP HTTP endpoint (non-blocking, best-effort).
pub async fn export_span(
    http_client: &reqwest::Client,
    service_name: &str,
    span_name: &str,
    start_ns: u128,
    end_ns: u128,
    status: &str,
) {
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4318/v1/traces".to_string());

    let payload = json!({
        "resourceSpans": [{
            "resource": {
                "attributes": [
                    {"key": "service.name", "value": {"stringValue": service_name}},
                    {"key": "service.version", "value": {"stringValue": "3.0.0"}}
                ]
            },
            "scopeSpans": [{
                "spans": [{
                    "traceId": format!("{:032x}", rand::thread_rng().gen::<u128>()),
                    "spanId":  format!("{:016x}", rand::thread_rng().gen::<u64>()),
                    "name": span_name,
                    "startTimeUnixNano": start_ns.to_string(),
                    "endTimeUnixNano":   end_ns.to_string(),
                    "status": {"code": if status == "OK" { 1 } else { 2 }}
                }]
            }]
        }]
    });

    let _ = http_client
        .post(&endpoint)
        .json(&payload)
        .timeout(Duration::from_secs(2))
        .send()
        .await;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter — in-memory token bucket (per-IP, thread-safe)
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<Mutex<HashMap<String, (f64, Instant)>>>,
    rate_per_min: f64,
    burst: f64,
}

impl RateLimiter {
    pub fn new(rate_per_min: f64, burst: f64) -> Self {
        Self {
            buckets: Arc::new(Mutex::new(HashMap::new())),
            rate_per_min,
            burst,
        }
    }

    /// Returns true if the request is allowed, false if rate-limited.
    pub fn check(&self, ip: &str) -> bool {
        let mut buckets = self.buckets.lock().unwrap();
        let entry = buckets
            .entry(ip.to_string())
            .or_insert((self.burst, Instant::now()));
        let elapsed_mins = entry.1.elapsed().as_secs_f64() / 60.0;
        entry.0 = (entry.0 + elapsed_mins * self.rate_per_min).min(self.burst);
        entry.1 = Instant::now();
        if entry.0 >= 1.0 {
            entry.0 -= 1.0;
            true
        } else {
            false
        }
    }
}
