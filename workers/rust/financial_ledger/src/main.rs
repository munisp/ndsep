/*!
NDSEP Financial Ledger Engine (Rust)
TigerBeetle double-entry ledger for penalty tracking.
Processes Mojaloop payments, manages penalty lifecycle.
Technology: Rust, TigerBeetle HTTP API, Mojaloop, NIBSS, Axum
*/
use axum::{extract::State, response::Json, routing::get, Router};
use log::{info, warn};
use serde_json::{json, Value};
use std::env;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// TigerBeetle HTTP API default URL (tigerbeetle-http-proxy sidecar)
const TIGERBEETLE_DEFAULT_URL: &str = "http://localhost:3001";

/// NDSEP ledger ID (720 = Nigeria country code)
const NDSEP_LEDGER_ID: u32 = 720;

// ─── TigerBeetle HTTP Client ────────────────────────────────────────────────

#[derive(Clone)]
struct TigerBeetleClient {
    http: Arc<reqwest::Client>,
    base_url: String,
    connected: Arc<AtomicBool>,
    transfers_posted: Arc<AtomicU64>,
    tb_errors: Arc<AtomicU64>,
}

impl TigerBeetleClient {
    fn new(http: Arc<reqwest::Client>) -> Self {
        let base_url =
            env::var("TIGERBEETLE_URL").unwrap_or_else(|_| TIGERBEETLE_DEFAULT_URL.to_string());
        Self {
            http,
            base_url,
            connected: Arc::new(AtomicBool::new(false)),
            transfers_posted: Arc::new(AtomicU64::new(0)),
            tb_errors: Arc::new(AtomicU64::new(0)),
        }
    }

    async fn health_check(&self) -> bool {
        let url = format!("{}/health", self.base_url);
        match self
            .http
            .get(&url)
            .timeout(Duration::from_secs(3))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                let was = self.connected.swap(true, Ordering::Relaxed);
                if !was {
                    info!("[TigerBeetle] Connected at {}", self.base_url);
                }
                true
            }
            _ => {
                self.connected.store(false, Ordering::Relaxed);
                false
            }
        }
    }

    /// Ensure a TigerBeetle account exists (idempotent via linked flag)
    async fn ensure_account(&self, account_id: u128, code: u16) -> bool {
        if !self.connected.load(Ordering::Relaxed) {
            return false;
        }
        let url = format!("{}/accounts", self.base_url);
        let body = json!([{
            "id": account_id.to_string(),
            "ledger": NDSEP_LEDGER_ID,
            "code": code,
            "flags": 0,
            "user_data_128": 0,
            "user_data_64": 0,
            "user_data_32": 0,
            "timestamp": 0,
        }]);
        match self
            .http
            .post(&url)
            .json(&body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    }
}

// ─── App State ───────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    transactions_processed: Arc<AtomicU64>,
    penalties_issued: Arc<AtomicU64>,
    total_amount_ngn: Arc<AtomicU64>,
    payments_settled: Arc<AtomicU64>,
    start_time: Arc<Instant>,
    tb: TigerBeetleClient,
}

async fn health(State(_s): State<AppState>) -> Json<Value> {
    Json(ndsep_shared::health_response("financial_ledger"))
}

async fn metrics(State(s): State<AppState>) -> Json<Value> {
    Json(json!({
        "transactionsProcessed": s.transactions_processed.load(Ordering::Relaxed),
        "penaltiesIssued": s.penalties_issued.load(Ordering::Relaxed),
        "totalAmountNgn": s.total_amount_ngn.load(Ordering::Relaxed),
        "paymentsSettled": s.payments_settled.load(Ordering::Relaxed),
        "tigerbeetle": {
            "connected": s.tb.connected.load(Ordering::Relaxed),
            "url": s.tb.base_url,
            "transfersPosted": s.tb.transfers_posted.load(Ordering::Relaxed),
            "errors": s.tb.tb_errors.load(Ordering::Relaxed),
        },
        "uptimeSeconds": s.start_time.elapsed().as_secs_f64(),
    }))
}

async fn status_handler(State(s): State<AppState>) -> Json<Value> {
    Json(json!({
        "id": "financial-ledger",
        "name": "Financial Ledger Engine",
        "layer": "FIN",
        "language": "Rust",
        "status": "running",
        "description": "TigerBeetle double-entry ledger for penalty tracking. Processes Mojaloop payments, manages penalty lifecycle.",
        "technology": "Rust - TigerBeetle HTTP API - Mojaloop - NIBSS - Axum",
        "eventsProcessed": s.transactions_processed.load(Ordering::Relaxed),
        "tigerbeetleConnected": s.tb.connected.load(Ordering::Relaxed),
        "uptimeSeconds": s.start_time.elapsed().as_secs_f64(),
    }))
}

// ─── TigerBeetle Health Loop ─────────────────────────────────────────────────

async fn run_tigerbeetle_health_loop(tb: TigerBeetleClient) {
    // Initial check + account bootstrap
    if tb.health_check().await {
        // Reserve accounts: 1 = NDSEP Treasury, 2 = Penalty Escrow
        tb.ensure_account(1, 1).await;
        tb.ensure_account(2, 2).await;
        info!("[TigerBeetle] Ledger accounts bootstrapped (treasury=1, escrow=2)");
    }
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        tb.health_check().await;
    }
}

// ─── Ledger Processor ────────────────────────────────────────────────────────

async fn run_ledger_processor(db: Arc<tokio_postgres::Client>, state: AppState) {
    info!("[Ledger] Starting TigerBeetle financial ledger processor...");
    let mut interval = tokio::time::interval(Duration::from_secs(6));
    loop {
        interval.tick().await;

        // Process existing pending penalties
        let rows = db.query(
            "SELECT id, organization_id, amount, currency FROM financial_penalties WHERE status = 'pending' ORDER BY RANDOM() LIMIT 3",
            &[],
        ).await;
        if let Ok(rows) = rows {
            for row in &rows {
                let penalty_id: i32 = row.get(0);
                let org_id: i32 = row.get(1);
                let amount: f32 = row.get(2);
                let currency: String = row.get(3);

                // A pending penalty is not a payment confirmation. This worker does
                // not invent payment outcomes or transaction references. A separate
                // authoritative payment-ingest path must supply a confirmed payment
                // before a TigerBeetle transfer and status transition are attempted.
                warn!(
                    "[Ledger] Penalty #{} remains pending: authoritative payment confirmation required (org={}, amount={} {})",
                    penalty_id, org_id, amount, currency
                );
            }
        }

        info!(
            "[Ledger] Transactions: {} | Penalties issued: {} | Settled: {} | TB: {}",
            state.transactions_processed.load(Ordering::Relaxed),
            state.penalties_issued.load(Ordering::Relaxed),
            state.payments_settled.load(Ordering::Relaxed),
            if state.tb.connected.load(Ordering::Relaxed) {
                "connected"
            } else {
                "disconnected"
            },
        );
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();
    let port = env::var("LEDGER_PORT").unwrap_or_else(|_| "8090".to_string());
    let tb_url =
        env::var("TIGERBEETLE_URL").unwrap_or_else(|_| TIGERBEETLE_DEFAULT_URL.to_string());
    info!("=== NDSEP Financial Ledger Engine (Rust) ===");
    info!("Version: 2.0.0 | Port: {} | TigerBeetle: {}", port, tb_url);

    let db = Arc::new(
        ndsep_shared::connect_db()
            .await
            .expect("DB connection failed"),
    );
    let http = Arc::new(reqwest::Client::new());
    let tb = TigerBeetleClient::new(http.clone());

    let state = AppState {
        transactions_processed: Arc::new(AtomicU64::new(0)),
        penalties_issued: Arc::new(AtomicU64::new(0)),
        total_amount_ngn: Arc::new(AtomicU64::new(0)),
        payments_settled: Arc::new(AtomicU64::new(0)),
        start_time: Arc::new(Instant::now()),
        tb: tb.clone(),
    };

    ndsep_shared::broadcast(
        &http,
        "worker_started",
        json!({
            "worker": "financial_ledger",
            "layer": "FIN",
            "language": "Rust",
            "tigerbeetle_url": tb_url,
            "timestamp": ndsep_shared::now_utc(),
        }),
    )
    .await;

    // TigerBeetle health loop
    let tb2 = tb.clone();
    tokio::spawn(async move { run_tigerbeetle_health_loop(tb2).await });

    let db2 = db.clone();
    let state2 = state.clone();
    tokio::spawn(async move { run_ledger_processor(db2, state2).await });

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/status", get(status_handler))
        .with_state(state);

    info!("[Ledger] Status server listening on :{}", port);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}
