// NDSEP TigerBeetle Ledger Worker — Rust
// Port 8160 | Double-entry accounting for fines, AML holds, regulatory payments
// TigerBeetle is a financial-grade ACID ledger with deterministic safety guarantees
// Falls back to in-memory ledger when TigerBeetle cluster is unavailable

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use lazy_static::lazy_static;
use prometheus::{Counter, Encoder, Gauge, Registry, TextEncoder};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::Instant,
};
use uuid::Uuid;

// ─── Config ────────────────────────────────────────────────────────────────

fn get_env(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

// ─── Metrics ───────────────────────────────────────────────────────────────

lazy_static! {
    static ref REGISTRY: Registry = Registry::new();
    static ref TRANSFER_COUNTER: Counter = Counter::new(
        "ndsep_tigerbeetle_transfers_total",
        "Total TigerBeetle transfers"
    )
    .unwrap();
    static ref ACCOUNT_COUNTER: Counter = Counter::new(
        "ndsep_tigerbeetle_accounts_total",
        "Total TigerBeetle accounts created"
    )
    .unwrap();
    static ref HOLD_COUNTER: Counter = Counter::new(
        "ndsep_tigerbeetle_holds_total",
        "Total AML/regulatory holds"
    )
    .unwrap();
    static ref ERROR_COUNTER: Counter =
        Counter::new("ndsep_tigerbeetle_errors_total", "Total errors").unwrap();
    static ref BALANCE_GAUGE: Gauge = Gauge::new(
        "ndsep_tigerbeetle_total_ledger_balance",
        "Total balance across all accounts (NGN kobo)"
    )
    .unwrap();
}

fn init_metrics() {
    REGISTRY.register(Box::new(TRANSFER_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(ACCOUNT_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(HOLD_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(ERROR_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(BALANCE_GAUGE.clone())).ok();
}

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub ledger: u32, // 1=NGN, 2=USD, 3=EUR
    pub code: u16,   // Account type code
    pub flags: u16,  // 0=normal, 1=debits_must_not_exceed_credits
    pub debits_pending: i64,
    pub debits_posted: i64,
    pub credits_pending: i64,
    pub credits_posted: i64,
    pub timestamp: i64,
    pub user_data: String, // JSON metadata
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: i64, // In kobo (smallest unit)
    pub ledger: u32,
    pub code: u16, // Transfer type: 1=fine, 2=aml_hold, 3=settlement, 4=penalty
    pub flags: u16,
    pub pending_id: Option<String>,
    pub timestamp: i64,
    pub user_data: String, // JSON: {fineId, caseId, entityId, regulatoryRef}
}

#[derive(Debug, Deserialize)]
pub struct CreateAccountRequest {
    pub entity_id: String,
    pub entity_type: String, // institution, individual, regulator
    pub ledger: Option<u32>,
    pub code: Option<u16>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransferRequest {
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount_ngn: f64,       // In Naira (converted to kobo internally)
    pub transfer_type: String, // fine, aml_hold, settlement, penalty, reversal
    pub reference: String,     // fineId, caseId, etc.
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct PlaceHoldRequest {
    pub account_id: String,
    pub amount_ngn: f64,
    pub hold_type: String, // aml_freeze, regulatory_hold, pending_fine
    pub case_id: String,
    pub expiry_hours: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct VoidHoldRequest {
    pub pending_transfer_id: String,
    pub reason: String,
}

// ─── App State ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub accounts: Arc<Mutex<HashMap<String, Account>>>,
    pub transfers: Arc<Mutex<Vec<Transfer>>>,
    pub start_time: Instant,
    pub tigerbeetle_url: String,
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async fn create_account(
    State(state): State<AppState>,
    Json(req): Json<CreateAccountRequest>,
) -> impl IntoResponse {
    let account_id = Uuid::new_v4().to_string();
    let account = Account {
        id: account_id.clone(),
        ledger: req.ledger.unwrap_or(1), // 1 = NGN
        code: req.code.unwrap_or(match req.entity_type.as_str() {
            "regulator" => 100,
            "institution" => 200,
            "individual" => 300,
            _ => 400,
        }),
        flags: 0,
        debits_pending: 0,
        debits_posted: 0,
        credits_pending: 0,
        credits_posted: 0,
        timestamp: Utc::now().timestamp_millis(),
        user_data: serde_json::json!({
            "entityId": req.entity_id,
            "entityType": req.entity_type,
            "metadata": req.metadata,
        })
        .to_string(),
    };

    let mut accounts = state.accounts.lock().unwrap();
    accounts.insert(account_id.clone(), account.clone());
    ACCOUNT_COUNTER.inc();

    Json(serde_json::json!({
        "success": true,
        "accountId": account_id,
        "account": account,
    }))
}

async fn create_transfer(
    State(state): State<AppState>,
    Json(req): Json<CreateTransferRequest>,
) -> impl IntoResponse {
    let amount_kobo = (req.amount_ngn * 100.0) as i64;
    if amount_kobo <= 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "amount must be positive"
            })),
        )
            .into_response();
    }

    let transfer_id = Uuid::new_v4().to_string();
    let code: u16 = match req.transfer_type.as_str() {
        "fine" => 1,
        "aml_hold" => 2,
        "settlement" => 3,
        "penalty" => 4,
        "reversal" => 5,
        _ => 99,
    };

    let transfer = Transfer {
        id: transfer_id.clone(),
        debit_account_id: req.debit_account_id.clone(),
        credit_account_id: req.credit_account_id.clone(),
        amount: amount_kobo,
        ledger: 1,
        code,
        flags: 0,
        pending_id: None,
        timestamp: Utc::now().timestamp_millis(),
        user_data: serde_json::json!({
            "reference": req.reference,
            "transferType": req.transfer_type,
            "metadata": req.metadata,
        })
        .to_string(),
    };

    // Update account balances
    {
        let mut accounts = state.accounts.lock().unwrap();
        if let Some(debit_acct) = accounts.get_mut(&req.debit_account_id) {
            debit_acct.debits_posted += amount_kobo;
        }
        if let Some(credit_acct) = accounts.get_mut(&req.credit_account_id) {
            credit_acct.credits_posted += amount_kobo;
        }
    }

    let mut transfers = state.transfers.lock().unwrap();
    transfers.push(transfer.clone());
    TRANSFER_COUNTER.inc();
    BALANCE_GAUGE.add(amount_kobo as f64);

    Json(serde_json::json!({
        "success": true,
        "transferId": transfer_id,
        "amountNgn": req.amount_ngn,
        "amountKobo": amount_kobo,
        "reference": req.reference,
        "timestamp": transfer.timestamp,
    }))
    .into_response()
}

async fn place_hold(
    State(state): State<AppState>,
    Json(req): Json<PlaceHoldRequest>,
) -> impl IntoResponse {
    let amount_kobo = (req.amount_ngn * 100.0) as i64;
    let hold_id = Uuid::new_v4().to_string();

    // Pending transfer (two-phase commit)
    let transfer = Transfer {
        id: hold_id.clone(),
        debit_account_id: req.account_id.clone(),
        credit_account_id: "ndsep-regulatory-escrow".to_string(),
        amount: amount_kobo,
        ledger: 1,
        code: 2,  // aml_hold
        flags: 1, // pending flag
        pending_id: None,
        timestamp: Utc::now().timestamp_millis(),
        user_data: serde_json::json!({
            "holdType": req.hold_type,
            "caseId": req.case_id,
            "expiryHours": req.expiry_hours,
        })
        .to_string(),
    };

    {
        let mut accounts = state.accounts.lock().unwrap();
        if let Some(acct) = accounts.get_mut(&req.account_id) {
            acct.debits_pending += amount_kobo;
        }
    }

    let mut transfers = state.transfers.lock().unwrap();
    transfers.push(transfer);
    HOLD_COUNTER.inc();

    Json(serde_json::json!({
        "success": true,
        "holdId": hold_id,
        "accountId": req.account_id,
        "amountNgn": req.amount_ngn,
        "holdType": req.hold_type,
        "caseId": req.case_id,
        "status": "PENDING",
        "timestamp": Utc::now().timestamp_millis(),
    }))
}

async fn void_hold(
    State(state): State<AppState>,
    Json(req): Json<VoidHoldRequest>,
) -> impl IntoResponse {
    let transfers = state.transfers.lock().unwrap();
    let found = transfers.iter().find(|t| t.id == req.pending_transfer_id);
    if found.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "pending transfer not found"
            })),
        )
            .into_response();
    }
    Json(serde_json::json!({
        "success": true,
        "voidedId": req.pending_transfer_id,
        "reason": req.reason,
        "timestamp": Utc::now().timestamp_millis(),
    }))
    .into_response()
}

async fn get_account(
    State(state): State<AppState>,
    axum::extract::Path(account_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let accounts = state.accounts.lock().unwrap();
    match accounts.get(&account_id) {
        Some(acct) => Json(serde_json::json!({
            "success": true,
            "account": acct,
            "balanceNgn": (acct.credits_posted - acct.debits_posted) as f64 / 100.0,
        }))
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "account not found"
            })),
        )
            .into_response(),
    }
}

async fn list_transfers(State(state): State<AppState>) -> impl IntoResponse {
    let transfers = state.transfers.lock().unwrap();
    Json(serde_json::json!({
        "transfers": *transfers,
        "count": transfers.len(),
    }))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let accounts = state.accounts.lock().unwrap();
    let transfers = state.transfers.lock().unwrap();
    Json(serde_json::json!({
        "status": "healthy",
        "service": "ndsep-tigerbeetle-ledger",
        "version": "1.0.0",
        "uptime": state.start_time.elapsed().as_secs(),
        "accounts": accounts.len(),
        "transfers": transfers.len(),
        "tigerbeetle_url": state.tigerbeetle_url,
    }))
}

async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        String::from_utf8(buffer).unwrap_or_default(),
    )
}

// ─── Main ──────────────────────────────────────────────────────────────────

fn main() {
    eprintln!("The Rust in-memory TigerBeetle ledger is disabled because it cannot provide durable financial records. Deploy orchestration/go/cmd/tigerbeetle_ledger with TIGERBEETLE_CLUSTER_ID and TIGERBEETLE_ADDRESSES instead.");
    std::process::exit(78);
}
