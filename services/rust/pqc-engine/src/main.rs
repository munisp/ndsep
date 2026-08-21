//! NDSEP Post-Quantum Cryptography Engine
//!
//! Provides lattice-based cryptographic operations resistant to quantum attacks:
//! - CRYSTALS-Kyber (ML-KEM) for key encapsulation
//! - CRYSTALS-Dilithium (ML-DSA) for digital signatures
//! - Hybrid encryption (PQC + classical AES-256-GCM)
//!
//! Designed for NDSEP data sovereignty: consent receipts, audit trails,
//! and cross-border data transfer attestations.

use axum::{
    extract::Json,
    http::StatusCode,
    routing::{get, post},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

mod crypto;
mod types;

use crypto::{PQCKeyPair, PQCOps};

// ── API Types ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KeyGenRequest {
    algorithm: String, // "kyber768", "kyber1024", "dilithium3", "dilithium5"
    label: Option<String>,
}

#[derive(Serialize)]
struct KeyGenResponse {
    public_key: String,  // base64
    secret_key: String,  // base64
    algorithm: String,
    key_id: String,
    fingerprint: String, // SHA3-256 of public key
}

#[derive(Deserialize)]
struct EncapsulateRequest {
    public_key: String, // base64-encoded Kyber public key
}

#[derive(Serialize)]
struct EncapsulateResponse {
    ciphertext: String,   // base64
    shared_secret: String, // base64
}

#[derive(Deserialize)]
struct SignRequest {
    message: String,    // base64-encoded message
    secret_key: String, // base64-encoded Dilithium secret key
}

#[derive(Serialize)]
struct SignResponse {
    signature: String, // base64
    algorithm: String,
}

#[derive(Deserialize)]
struct VerifyRequest {
    message: String,    // base64
    signature: String,  // base64
    public_key: String, // base64
}

#[derive(Serialize)]
struct VerifyResponse {
    valid: bool,
    algorithm: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    algorithms: Vec<String>,
    operations: OperationCounts,
}

#[derive(Serialize, Default)]
struct OperationCounts {
    keygen: u64,
    encapsulate: u64,
    sign: u64,
    verify: u64,
}

// ── Handlers ────────────────────────────────────────────────────────────────

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        algorithms: vec![
            "kyber768".to_string(),
            "kyber1024".to_string(),
            "dilithium3".to_string(),
            "dilithium5".to_string(),
        ],
        operations: OperationCounts::default(),
    })
}

async fn keygen(Json(req): Json<KeyGenRequest>) -> Result<Json<KeyGenResponse>, StatusCode> {
    let ops = PQCOps::new();
    let keypair = ops.generate_keypair(&req.algorithm).map_err(|e| {
        warn!("Key generation failed: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    Ok(Json(KeyGenResponse {
        public_key: BASE64.encode(&keypair.public_key),
        secret_key: BASE64.encode(&keypair.secret_key),
        algorithm: req.algorithm,
        key_id: keypair.key_id,
        fingerprint: keypair.fingerprint,
    }))
}

async fn encapsulate(
    Json(req): Json<EncapsulateRequest>,
) -> Result<Json<EncapsulateResponse>, StatusCode> {
    let ops = PQCOps::new();
    let pk_bytes = BASE64.decode(&req.public_key).map_err(|_| StatusCode::BAD_REQUEST)?;

    let (ciphertext, shared_secret) = ops.encapsulate(&pk_bytes).map_err(|e| {
        warn!("Encapsulation failed: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    Ok(Json(EncapsulateResponse {
        ciphertext: BASE64.encode(&ciphertext),
        shared_secret: BASE64.encode(&shared_secret),
    }))
}

async fn sign(Json(req): Json<SignRequest>) -> Result<Json<SignResponse>, StatusCode> {
    let ops = PQCOps::new();
    let message = BASE64.decode(&req.message).map_err(|_| StatusCode::BAD_REQUEST)?;
    let sk = BASE64.decode(&req.secret_key).map_err(|_| StatusCode::BAD_REQUEST)?;

    let signature = ops.sign(&message, &sk).map_err(|e| {
        warn!("Signing failed: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    Ok(Json(SignResponse {
        signature: BASE64.encode(&signature),
        algorithm: "dilithium3".to_string(),
    }))
}

async fn verify(Json(req): Json<VerifyRequest>) -> Result<Json<VerifyResponse>, StatusCode> {
    let ops = PQCOps::new();
    let message = BASE64.decode(&req.message).map_err(|_| StatusCode::BAD_REQUEST)?;
    let signature = BASE64.decode(&req.signature).map_err(|_| StatusCode::BAD_REQUEST)?;
    let pk = BASE64.decode(&req.public_key).map_err(|_| StatusCode::BAD_REQUEST)?;

    let valid = ops.verify(&message, &signature, &pk).unwrap_or(false);

    Ok(Json(VerifyResponse {
        valid,
        algorithm: "dilithium3".to_string(),
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .json()
        .init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/keygen", post(keygen))
        .route("/encapsulate", post(encapsulate))
        .route("/sign", post(sign))
        .route("/verify", post(verify));

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8190".to_string())
        .parse()
        .unwrap_or(8190);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("NDSEP PQC Engine starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
