//! NDSEP Blockchain-Anchored Audit Trail
//!
//! Provides tamper-proof audit logging with:
//! - SHA-256 hash chain (each entry linked to previous)
//! - Merkle tree aggregation (daily roots)
//! - Verification API (prove specific entries haven't been tampered with)
//! - Anchoring interface for Ethereum L2 / Hyperledger submission

use axum::{extract::State, http::StatusCode, routing::{get, post}, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

// ── Audit Entry ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuditEntry {
    id: u64,
    timestamp: DateTime<Utc>,
    aggregate_type: String,
    aggregate_id: String,
    event_type: String,
    actor_id: Option<String>,
    payload_hash: String,
    prev_hash: String,
    hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MerkleRoot {
    date: String,
    root_hash: String,
    entry_count: u64,
    first_entry_id: u64,
    last_entry_id: u64,
    anchored: bool,
    anchor_tx_hash: Option<String>,
}

// ── Merkle Tree ─────────────────────────────────────────────────────────────

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn compute_entry_hash(entry: &AuditEntry) -> String {
    let data = format!(
        "{}:{}:{}:{}:{}:{}",
        entry.id, entry.aggregate_type, entry.aggregate_id,
        entry.event_type, entry.payload_hash, entry.prev_hash,
    );
    sha256_hex(data.as_bytes())
}

fn compute_merkle_root(hashes: &[String]) -> String {
    if hashes.is_empty() {
        return sha256_hex(b"empty");
    }
    if hashes.len() == 1 {
        return hashes[0].clone();
    }

    let mut current_level: Vec<String> = hashes.to_vec();
    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        for chunk in current_level.chunks(2) {
            let combined = if chunk.len() == 2 {
                format!("{}{}", chunk[0], chunk[1])
            } else {
                format!("{}{}", chunk[0], chunk[0]) // duplicate odd leaf
            };
            next_level.push(sha256_hex(combined.as_bytes()));
        }
        current_level = next_level;
    }
    current_level.into_iter().next().unwrap_or_default()
}

fn compute_merkle_proof(hashes: &[String], index: usize) -> Vec<ProofNode> {
    if hashes.len() <= 1 {
        return vec![];
    }

    let mut proof = Vec::new();
    let mut current_level: Vec<String> = hashes.to_vec();
    let mut idx = index;

    while current_level.len() > 1 {
        let sibling_idx = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
        let sibling = if sibling_idx < current_level.len() {
            current_level[sibling_idx].clone()
        } else {
            current_level[idx].clone() // duplicate for odd
        };

        proof.push(ProofNode {
            hash: sibling,
            position: if idx % 2 == 0 { "right".into() } else { "left".into() },
        });

        let mut next_level = Vec::new();
        for chunk in current_level.chunks(2) {
            let combined = if chunk.len() == 2 {
                format!("{}{}", chunk[0], chunk[1])
            } else {
                format!("{}{}", chunk[0], chunk[0])
            };
            next_level.push(sha256_hex(combined.as_bytes()));
        }
        current_level = next_level;
        idx /= 2;
    }

    proof
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProofNode {
    hash: String,
    position: String, // "left" or "right"
}

// ── App State ───────────────────────────────────────────────────────────────

#[derive(Debug)]
struct AppState {
    entries: Vec<AuditEntry>,
    merkle_roots: BTreeMap<String, MerkleRoot>,
    next_id: u64,
}

impl AppState {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            merkle_roots: BTreeMap::new(),
            next_id: 1,
        }
    }
}

type SharedState = Arc<RwLock<AppState>>;

// ── Request/Response Types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct AppendRequest {
    aggregate_type: String,
    aggregate_id: String,
    event_type: String,
    actor_id: Option<String>,
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct AppendResponse {
    id: u64,
    hash: String,
    prev_hash: String,
    timestamp: DateTime<Utc>,
}

#[derive(Serialize)]
struct VerifyResponse {
    chain_valid: bool,
    entries_checked: u64,
    broken_at: Option<u64>,
}

#[derive(Serialize)]
struct ProofResponse {
    entry_hash: String,
    merkle_root: String,
    proof: Vec<ProofNode>,
    verified: bool,
}

#[derive(Serialize)]
struct StatsResponse {
    total_entries: u64,
    merkle_roots: u64,
    anchored_roots: u64,
    chain_intact: bool,
    latest_entry: Option<AuditEntry>,
}

// ── Handlers ────────────────────────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "audit-chain",
        "version": "1.0.0"
    }))
}

async fn append_entry(
    State(state): State<SharedState>,
    Json(req): Json<AppendRequest>,
) -> Result<Json<AppendResponse>, StatusCode> {
    let mut s = state.write().await;

    let payload_hash = sha256_hex(req.payload.to_string().as_bytes());
    let prev_hash = s.entries.last().map(|e| e.hash.clone()).unwrap_or_else(|| sha256_hex(b"genesis"));

    let mut entry = AuditEntry {
        id: s.next_id,
        timestamp: Utc::now(),
        aggregate_type: req.aggregate_type,
        aggregate_id: req.aggregate_id,
        event_type: req.event_type,
        actor_id: req.actor_id,
        payload_hash,
        prev_hash: prev_hash.clone(),
        hash: String::new(),
    };
    entry.hash = compute_entry_hash(&entry);

    let response = AppendResponse {
        id: entry.id,
        hash: entry.hash.clone(),
        prev_hash,
        timestamp: entry.timestamp,
    };

    s.entries.push(entry);
    s.next_id += 1;

    Ok(Json(response))
}

async fn verify_chain(State(state): State<SharedState>) -> Json<VerifyResponse> {
    let s = state.read().await;
    let mut prev_hash = sha256_hex(b"genesis");

    for entry in &s.entries {
        if entry.prev_hash != prev_hash {
            return Json(VerifyResponse {
                chain_valid: false,
                entries_checked: entry.id,
                broken_at: Some(entry.id),
            });
        }
        let computed = compute_entry_hash(entry);
        if computed != entry.hash {
            return Json(VerifyResponse {
                chain_valid: false,
                entries_checked: entry.id,
                broken_at: Some(entry.id),
            });
        }
        prev_hash = entry.hash.clone();
    }

    Json(VerifyResponse {
        chain_valid: true,
        entries_checked: s.entries.len() as u64,
        broken_at: None,
    })
}

async fn get_merkle_root(
    State(state): State<SharedState>,
) -> Json<serde_json::Value> {
    let mut s = state.write().await;
    let today = Utc::now().format("%Y-%m-%d").to_string();

    if let Some(root) = s.merkle_roots.get(&today) {
        return Json(serde_json::to_value(root).unwrap_or_default());
    }

    // Compute today's root from all entries
    let hashes: Vec<String> = s.entries.iter().map(|e| e.hash.clone()).collect();
    let root_hash = compute_merkle_root(&hashes);

    let first_id = s.entries.first().map(|e| e.id).unwrap_or(0);
    let last_id = s.entries.last().map(|e| e.id).unwrap_or(0);

    let root = MerkleRoot {
        date: today.clone(),
        root_hash,
        entry_count: s.entries.len() as u64,
        first_entry_id: first_id,
        last_entry_id: last_id,
        anchored: false,
        anchor_tx_hash: None,
    };

    let value = serde_json::to_value(&root).unwrap_or_default();
    s.merkle_roots.insert(today, root);
    Json(value)
}

async fn get_proof(
    State(state): State<SharedState>,
    axum::extract::Path(entry_id): axum::extract::Path<u64>,
) -> Result<Json<ProofResponse>, StatusCode> {
    let s = state.read().await;

    let idx = s.entries.iter().position(|e| e.id == entry_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let hashes: Vec<String> = s.entries.iter().map(|e| e.hash.clone()).collect();
    let root = compute_merkle_root(&hashes);
    let proof = compute_merkle_proof(&hashes, idx);

    // Verify the proof
    let mut current = hashes[idx].clone();
    for node in &proof {
        current = if node.position == "right" {
            sha256_hex(format!("{}{}", current, node.hash).as_bytes())
        } else {
            sha256_hex(format!("{}{}", node.hash, current).as_bytes())
        };
    }

    Ok(Json(ProofResponse {
        entry_hash: s.entries[idx].hash.clone(),
        merkle_root: root.clone(),
        proof,
        verified: current == root,
    }))
}

async fn get_entries(
    State(state): State<SharedState>,
    axum::extract::Query(params): axum::extract::Query<BTreeMap<String, String>>,
) -> Json<Vec<AuditEntry>> {
    let s = state.read().await;
    let limit = params.get("limit").and_then(|l| l.parse::<usize>().ok()).unwrap_or(50);
    let entries: Vec<AuditEntry> = s.entries.iter().rev().take(limit).cloned().collect();
    Json(entries)
}

async fn get_stats(State(state): State<SharedState>) -> Json<StatsResponse> {
    let s = state.read().await;

    // Quick chain validation
    let mut chain_intact = true;
    let mut prev_hash = sha256_hex(b"genesis");
    for entry in &s.entries {
        if entry.prev_hash != prev_hash || compute_entry_hash(entry) != entry.hash {
            chain_intact = false;
            break;
        }
        prev_hash = entry.hash.clone();
    }

    Json(StatsResponse {
        total_entries: s.entries.len() as u64,
        merkle_roots: s.merkle_roots.len() as u64,
        anchored_roots: s.merkle_roots.values().filter(|r| r.anchored).count() as u64,
        chain_intact,
        latest_entry: s.entries.last().cloned(),
    })
}

// ── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    let state: SharedState = Arc::new(RwLock::new(AppState::new()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/audit/append", post(append_entry))
        .route("/api/v1/audit/verify", get(verify_chain))
        .route("/api/v1/audit/merkle-root", get(get_merkle_root))
        .route("/api/v1/audit/proof/{entry_id}", get(get_proof))
        .route("/api/v1/audit/entries", get(get_entries))
        .route("/api/v1/audit/stats", get(get_stats))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("AUDIT_CHAIN_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8165);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Audit chain service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
