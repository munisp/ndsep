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

const PENALTY_TYPES: &[&str] = &[
    "data_breach_fine",
    "cross_border_violation",
    "non_compliance_penalty",
    "audit_failure_fee",
    "encryption_violation",
    "retention_breach",
    "consent_violation",
    "unauthorized_transfer",
];
const CURRENCIES: &[&str] = &["NGN", "KES", "ZAR", "GHS", "USD", "EUR"];
const MOJALOOP_SCHEMES: &[&str] = &[
    "NIBSS-Instant",
    "M-Pesa",
    "RTGS-ZA",
    "GhIPSS",
    "SWIFT",
    "SEPA",
];

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

    /// Post a double-entry transfer to TigerBeetle
    async fn post_transfer(
        &self,
        debit_account_id: u128,
        credit_account_id: u128,
        amount: u64,
        code: u16,
        user_data: u128,
    ) -> bool {
        if !self.connected.load(Ordering::Relaxed) {
            return false;
        }
        let url = format!("{}/transfers", self.base_url);
        let transfer_id = uuid::Uuid::new_v4().as_u128();
        let body = json!([{
            "id": transfer_id.to_string(),
            "debit_account_id": debit_account_id.to_string(),
            "credit_account_id": credit_account_id.to_string(),
            "amount": amount,
            "ledger": NDSEP_LEDGER_ID,
            "code": code,
            "user_data_128": user_data.to_string(),
            "flags": 0,
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
            Ok(r) if r.status().is_success() => {
                self.transfers_posted.fetch_add(1, Ordering::Relaxed);
                true
            }
            _ => {
                self.tb_errors.fetch_add(1, Ordering::Relaxed);
                false
            }
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

struct PenaltyUpdate {
    new_status: &'static str,
    scheme: &'static str,
    tx_ref: String,
}

fn pick_penalty_update(penalty_id: i32) -> PenaltyUpdate {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let new_status = if rng.gen_bool(0.3) {
        "paid"
    } else if rng.gen_bool(0.1) {
        "overdue"
    } else {
        "processing"
    };
    let scheme = MOJALOOP_SCHEMES[rng.gen_range(0..MOJALOOP_SCHEMES.len())];
    let tx_ref = format!(
        "TXN-{}-{}",
        penalty_id,
        ndsep_shared::random_between(100000, 999999)
    );
    PenaltyUpdate {
        new_status,
        scheme,
        tx_ref,
    }
}

struct NewPenaltyData {
    penalty_type: &'static str,
    currency: &'static str,
    amount: f32,
    ngn_equiv: u64,
    should_create: bool,
}

fn maybe_new_penalty() -> NewPenaltyData {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let should_create = rng.gen_bool(0.25);
    let penalty_type = PENALTY_TYPES[rng.gen_range(0..PENALTY_TYPES.len())];
    let currency = CURRENCIES[rng.gen_range(0..CURRENCIES.len())];
    let amount = ndsep_shared::random_float(50000.0, 50_000_000.0) as f32;
    let ngn_equiv = (amount
        * if currency == "USD" {
            1600.0
        } else if currency == "EUR" {
            1750.0
        } else {
            1.0
        }) as u64;
    NewPenaltyData {
        penalty_type,
        currency,
        amount,
        ngn_equiv,
        should_create,
    }
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

async fn run_ledger_processor(
    db: Arc<tokio_postgres::Client>,
    http: Arc<reqwest::Client>,
    state: AppState,
) {
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

        // Maybe issue new penalty
        let np = maybe_new_penalty();
        if np.should_create {
            let org_result = db
                .query_opt(
                    "SELECT id, name FROM organizations ORDER BY RANDOM() LIMIT 1",
                    &[],
                )
                .await;
            if let Ok(Some(row)) = org_result {
                let org_id: i32 = row.get(0);
                let org_name: String = row.get(1);
                let desc = format!(
                    "Automated penalty: {} for organization {}. Assessed by NDSEP Financial Ledger Engine.",
                    np.penalty_type.replace('_', " "),
                    org_name
                );

                let insert_result = db.query_opt(
                    "INSERT INTO financial_penalties (organization_id, penalty_type, amount, currency, description, status, issued_at) VALUES ($1, $2, $3, $4, $5, 'pending'::penalty_status, NOW()) RETURNING id",
                    &[&org_id, &np.penalty_type, &np.amount, &np.currency, &desc],
                ).await;

                if let Ok(Some(row)) = insert_result {
                    let penalty_id: i32 = row.get(0);
                    state.penalties_issued.fetch_add(1, Ordering::Relaxed);
                    state
                        .total_amount_ngn
                        .fetch_add(np.ngn_equiv, Ordering::Relaxed);

                    // Ensure org's TigerBeetle account exists
                    let org_acct = (org_id as u128) + 1000;
                    state.tb.ensure_account(org_acct, 10).await;

                    ndsep_shared::broadcast(
                        &http,
                        "new_penalty_issued",
                        json!({
                            "type": "new_penalty_issued",
                            "penaltyId": penalty_id,
                            "organizationId": org_id,
                            "organizationName": org_name,
                            "penaltyType": np.penalty_type,
                            "amount": np.amount,
                            "currency": np.currency,
                            "description": desc,
                            "timestamp": ndsep_shared::now_utc(),
                        }),
                    )
                    .await;
                    info!(
                        "[Ledger] New penalty #{}: {} {} for {} ({})",
                        penalty_id, np.amount, np.currency, org_name, np.penalty_type
                    );
                }
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

async fn run_mojaloop_monitor(http: Arc<reqwest::Client>) {
    info!("[Ledger] Starting Mojaloop payment network monitor...");
    let mut interval = tokio::time::interval(Duration::from_secs(12));
    loop {
        interval.tick().await;
        let schemes: Vec<Value> = MOJALOOP_SCHEMES
            .iter()
            .map(|s| {
                json!({
                    "scheme": s,
                    "transactionsPerSec": ndsep_shared::random_between(100, 50000),
                    "avgLatencyMs": ndsep_shared::random_between(50, 500),
                    "successRate": ndsep_shared::random_float(97.0, 99.99),
                    "status": "healthy",
                    "totalVolumeToday": ndsep_shared::random_between(1_000_000, 1_000_000_000),
                })
            })
            .collect();
        ndsep_shared::broadcast(
            &http,
            "mojaloop_metrics",
            json!({
                "type": "mojaloop_metrics",
                "schemes": schemes,
                "timestamp": ndsep_shared::now_utc(),
            }),
        )
        .await;
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
    let http2 = http.clone();
    let state2 = state.clone();
    tokio::spawn(async move { run_ledger_processor(db2, http2, state2).await });

    let http3 = http.clone();
    tokio::spawn(async move { run_mojaloop_monitor(http3).await });

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
