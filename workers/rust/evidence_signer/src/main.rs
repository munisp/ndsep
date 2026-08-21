// NDSEP Evidence Signer Worker (Rust)
// =====================================
// Generates tamper-evident, HMAC-SHA256 signed evidence packages
// for compliance audits, penalty appeals, and transfer approvals.
use axum::{
    extract::Query,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;

#[derive(Serialize, Deserialize, Clone)]
struct EvidenceRequest {
    org_id: Option<i32>,
    package_type: String,
    reference_id: Option<i32>,
    reference_type: Option<String>,
}

#[derive(Serialize)]
struct EvidenceResponse {
    id: String,
    package_type: String,
    status: String,
    content_hash: String,
    hmac_signature: String,
    generated_at: String,
    expires_at: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    worker: String,
    packages_generated: u64,
}

static PACKAGES_GENERATED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn compute_hash(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn compute_hmac(data: &str, key: &str) -> String {
    // Simple HMAC-like construction using SHA256
    let inner = format!("{}{}", key, data);
    let outer = format!("{}{}", key, compute_hash(&inner));
    compute_hash(&outer)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        worker: "evidence-signer".to_string(),
        packages_generated: PACKAGES_GENERATED.load(std::sync::atomic::Ordering::Relaxed),
    })
}

async fn metrics() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "packages_generated": PACKAGES_GENERATED.load(std::sync::atomic::Ordering::Relaxed),
        "worker": "evidence-signer"
    }))
}

async fn generate_package(Json(req): Json<EvidenceRequest>) -> Json<EvidenceResponse> {
    let secret_key =
        env::var("EVIDENCE_SIGNING_KEY").unwrap_or_else(|_| "ndsep-evidence-key-2026".to_string());

    let now = Utc::now();
    let expires = now + chrono::Duration::days(365);

    let content = serde_json::json!({
        "org_id": req.org_id,
        "package_type": req.package_type,
        "reference_id": req.reference_id,
        "reference_type": req.reference_type,
        "generated_at": now.to_rfc3339(),
        "generator": "ndsep-evidence-signer-v1",
        "platform": "NDSEP National Data Sovereignty Enforcement Platform"
    });

    let content_str = content.to_string();
    let content_hash = compute_hash(&content_str);
    let hmac_sig = compute_hmac(&content_hash, &secret_key);

    let package_id = format!(
        "EVP-{}-{}",
        now.format("%Y%m%d"),
        &content_hash[..8].to_uppercase()
    );

    PACKAGES_GENERATED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    Json(EvidenceResponse {
        id: package_id,
        package_type: req.package_type,
        status: "ready".to_string(),
        content_hash,
        hmac_signature: hmac_sig,
        generated_at: now.to_rfc3339(),
        expires_at: expires.to_rfc3339(),
    })
}

async fn verify_package(Query(params): Query<HashMap<String, String>>) -> Json<serde_json::Value> {
    let secret_key =
        env::var("EVIDENCE_SIGNING_KEY").unwrap_or_else(|_| "ndsep-evidence-key-2026".to_string());

    let content_hash = params.get("content_hash").cloned().unwrap_or_default();
    let provided_sig = params.get("hmac_signature").cloned().unwrap_or_default();

    let expected_sig = compute_hmac(&content_hash, &secret_key);
    let valid = expected_sig == provided_sig;

    Json(serde_json::json!({
        "valid": valid,
        "content_hash": content_hash,
        "verified_at": Utc::now().to_rfc3339()
    }))
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let port = env::var("EVIDENCE_SIGNER_PORT").unwrap_or_else(|_| "8113".to_string());
    let addr = format!("0.0.0.0:{}", port);

    println!("[evidence-signer] Starting on {}", addr);

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/api/evidence/generate", post(generate_package))
        .route("/api/evidence/verify", get(verify_package));

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("[evidence-signer] Listening on {}", addr);
    axum::serve(listener, app).await.unwrap();
}
