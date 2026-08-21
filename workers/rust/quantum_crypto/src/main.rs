//! NDSEP Post-Quantum Cryptography Service
//!
//! Provides quantum-resistant cryptographic operations:
//! - Hybrid key exchange (classical ECDH + lattice-based KEM simulation)
//! - Post-quantum digital signatures (hash-based, lattice-based simulation)
//! - Crypto-agility layer (swap algorithms without code changes)
//! - Key encapsulation for evidence packages and certificates
//!
//! Note: Uses simplified simulations of CRYSTALS-Kyber/Dilithium algorithms.
//! Production deployment should use NIST-certified implementations (e.g., liboqs).

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{routing::{get, post}, Json, Router};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sha3::Sha3_256;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    algorithms: Vec<String>,
    nist_compliance: String,
}

#[derive(Deserialize)]
struct EncapsulateRequest {
    public_key_b64: Option<String>,
    algorithm: Option<String>,
}

#[derive(Serialize)]
struct KeyPair {
    public_key: String,
    secret_key: String,
    algorithm: String,
    key_size_bits: u32,
    quantum_safe: bool,
}

#[derive(Serialize)]
struct EncapsulationResult {
    ciphertext: String,
    shared_secret: String,
    algorithm: String,
    quantum_safe: bool,
}

#[derive(Deserialize)]
struct SignRequest {
    message: String,
    algorithm: Option<String>,
}

#[derive(Serialize)]
struct SignResult {
    signature: String,
    public_key: String,
    algorithm: String,
    message_hash: String,
    quantum_safe: bool,
}

#[derive(Deserialize)]
struct VerifyRequest {
    message: String,
    signature: String,
    public_key: String,
    algorithm: Option<String>,
}

#[derive(Serialize)]
struct VerifyResult {
    valid: bool,
    algorithm: String,
    message_hash: String,
}

#[derive(Deserialize)]
struct HybridEncryptRequest {
    plaintext: String,
}

#[derive(Serialize)]
struct HybridEncryptResult {
    ciphertext: String,
    classical_key: String,
    pq_key: String,
    combined_key_hash: String,
    algorithm: String,
}

#[derive(Serialize)]
struct AlgorithmInfo {
    name: String,
    category: String,
    security_level: String,
    nist_status: String,
    key_size_bytes: u32,
    signature_size_bytes: Option<u32>,
    ciphertext_size_bytes: Option<u32>,
    quantum_safe: bool,
}

// ── Crypto Operations ───────────────────────────────────────────────────────

fn sha256_hex(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    hex::encode(hash)
}

fn sha3_256_hex(data: &[u8]) -> String {
    let hash = Sha3_256::digest(data);
    hex::encode(hash)
}

fn generate_keypair_kyber() -> KeyPair {
    let mut rng = rand::thread_rng();
    // Simulate Kyber-768 keypair (production: use pqcrypto-kyber)
    let sk: Vec<u8> = (0..2400).map(|_| rng.gen()).collect();
    let pk: Vec<u8> = (0..1184).map(|_| rng.gen()).collect();

    KeyPair {
        public_key: B64.encode(&pk),
        secret_key: B64.encode(&sk),
        algorithm: "CRYSTALS-Kyber-768".to_string(),
        key_size_bits: 1184 * 8,
        quantum_safe: true,
    }
}

fn generate_keypair_dilithium() -> KeyPair {
    let mut rng = rand::thread_rng();
    // Simulate Dilithium3 keypair (production: use pqcrypto-dilithium)
    let sk: Vec<u8> = (0..4000).map(|_| rng.gen()).collect();
    let pk: Vec<u8> = (0..1952).map(|_| rng.gen()).collect();

    KeyPair {
        public_key: B64.encode(&pk),
        secret_key: B64.encode(&sk),
        algorithm: "CRYSTALS-Dilithium3".to_string(),
        key_size_bits: 1952 * 8,
        quantum_safe: true,
    }
}

fn encapsulate_kyber(pk_b64: &str) -> EncapsulationResult {
    let mut rng = rand::thread_rng();
    let pk_bytes = B64.decode(pk_b64).unwrap_or_default();

    // Simulate KEM encapsulation
    let shared_secret: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    let ciphertext: Vec<u8> = {
        let mut ct = Vec::with_capacity(1088);
        for (i, &b) in pk_bytes.iter().enumerate().take(1088) {
            ct.push(b ^ shared_secret[i % 32]);
        }
        while ct.len() < 1088 {
            ct.push(rng.gen());
        }
        ct
    };

    EncapsulationResult {
        ciphertext: B64.encode(&ciphertext),
        shared_secret: hex::encode(&shared_secret),
        algorithm: "CRYSTALS-Kyber-768-KEM".to_string(),
        quantum_safe: true,
    }
}

fn sign_dilithium(message: &[u8], _sk_b64: &str) -> SignResult {
    let mut rng = rand::thread_rng();
    let message_hash = sha3_256_hex(message);

    // Simulate Dilithium signature (production: use pqcrypto-dilithium)
    let sig_bytes: Vec<u8> = {
        let hash = Sha3_256::digest(message);
        let mut sig: Vec<u8> = hash.to_vec();
        sig.extend((0..3261).map(|_| rng.gen::<u8>()));
        sig
    };

    // Generate a deterministic public key for verification
    let pk: Vec<u8> = (0..1952).map(|_| rng.gen()).collect();

    SignResult {
        signature: B64.encode(&sig_bytes),
        public_key: B64.encode(&pk),
        algorithm: "CRYSTALS-Dilithium3".to_string(),
        message_hash,
        quantum_safe: true,
    }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "quantum-crypto".to_string(),
        algorithms: vec![
            "CRYSTALS-Kyber-768".to_string(),
            "CRYSTALS-Dilithium3".to_string(),
            "AES-256-GCM (classical)".to_string(),
            "SHA3-256".to_string(),
            "Hybrid (ECDH+Kyber)".to_string(),
        ],
        nist_compliance: "FIPS 203 (ML-KEM) + FIPS 204 (ML-DSA) simulation".to_string(),
    })
}

async fn gen_kem_keypair() -> Json<KeyPair> {
    Json(generate_keypair_kyber())
}

async fn gen_sig_keypair() -> Json<KeyPair> {
    Json(generate_keypair_dilithium())
}

async fn encapsulate(Json(req): Json<EncapsulateRequest>) -> Json<EncapsulationResult> {
    let pk = req.public_key_b64.unwrap_or_else(|| {
        let kp = generate_keypair_kyber();
        kp.public_key
    });
    Json(encapsulate_kyber(&pk))
}

async fn sign(Json(req): Json<SignRequest>) -> Json<SignResult> {
    let kp = generate_keypair_dilithium();
    Json(sign_dilithium(req.message.as_bytes(), &kp.secret_key))
}

async fn verify(Json(req): Json<VerifyRequest>) -> Json<VerifyResult> {
    let message_hash = sha3_256_hex(req.message.as_bytes());
    // Simplified verification
    let sig_bytes = B64.decode(&req.signature).unwrap_or_default();
    let valid = sig_bytes.len() > 32 && {
        let expected_prefix = Sha3_256::digest(req.message.as_bytes());
        sig_bytes[..32] == expected_prefix[..]
    };

    Json(VerifyResult {
        valid,
        algorithm: req.algorithm.unwrap_or_else(|| "CRYSTALS-Dilithium3".to_string()),
        message_hash,
    })
}

async fn hybrid_encrypt(Json(req): Json<HybridEncryptRequest>) -> Json<HybridEncryptResult> {
    let mut rng = rand::thread_rng();

    // Classical key (simulating ECDH shared secret)
    let classical_key: [u8; 32] = rng.gen();
    // Post-quantum key (simulating Kyber shared secret)
    let pq_key: [u8; 32] = rng.gen();

    // Combine keys: SHA-256(classical || pq)
    let mut combined = Vec::with_capacity(64);
    combined.extend_from_slice(&classical_key);
    combined.extend_from_slice(&pq_key);
    let combined_key = Sha256::digest(&combined);

    // Encrypt with AES-256-GCM using combined key
    let cipher = Aes256Gcm::new_from_slice(&combined_key).unwrap();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, req.plaintext.as_bytes())
        .unwrap_or_default();

    let mut ct_with_nonce = nonce_bytes.to_vec();
    ct_with_nonce.extend(ciphertext);

    Json(HybridEncryptResult {
        ciphertext: B64.encode(&ct_with_nonce),
        classical_key: hex::encode(classical_key),
        pq_key: hex::encode(pq_key),
        combined_key_hash: sha256_hex(&combined_key),
        algorithm: "Hybrid-ECDH-Kyber768-AES256GCM".to_string(),
    })
}

async fn algorithms() -> Json<Vec<AlgorithmInfo>> {
    Json(vec![
        AlgorithmInfo {
            name: "CRYSTALS-Kyber-768".to_string(),
            category: "KEM (Key Encapsulation)".to_string(),
            security_level: "NIST Level 3 (equivalent to AES-192)".to_string(),
            nist_status: "FIPS 203 (ML-KEM) — Standardized August 2024".to_string(),
            key_size_bytes: 1184,
            signature_size_bytes: None,
            ciphertext_size_bytes: Some(1088),
            quantum_safe: true,
        },
        AlgorithmInfo {
            name: "CRYSTALS-Dilithium3".to_string(),
            category: "Digital Signature".to_string(),
            security_level: "NIST Level 3 (equivalent to AES-192)".to_string(),
            nist_status: "FIPS 204 (ML-DSA) — Standardized August 2024".to_string(),
            key_size_bytes: 1952,
            signature_size_bytes: Some(3293),
            ciphertext_size_bytes: None,
            quantum_safe: true,
        },
        AlgorithmInfo {
            name: "AES-256-GCM".to_string(),
            category: "Symmetric Encryption".to_string(),
            security_level: "128-bit post-quantum security (Grover's)".to_string(),
            nist_status: "FIPS 197 — Standard".to_string(),
            key_size_bytes: 32,
            signature_size_bytes: None,
            ciphertext_size_bytes: None,
            quantum_safe: true,
        },
        AlgorithmInfo {
            name: "SHA3-256".to_string(),
            category: "Hash Function".to_string(),
            security_level: "128-bit post-quantum collision resistance".to_string(),
            nist_status: "FIPS 202 — Standard".to_string(),
            key_size_bytes: 32,
            signature_size_bytes: None,
            ciphertext_size_bytes: None,
            quantum_safe: true,
        },
    ])
}

// ── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/pqc/kem/keypair", post(gen_kem_keypair))
        .route("/api/v1/pqc/sig/keypair", post(gen_sig_keypair))
        .route("/api/v1/pqc/kem/encapsulate", post(encapsulate))
        .route("/api/v1/pqc/sig/sign", post(sign))
        .route("/api/v1/pqc/sig/verify", post(verify))
        .route("/api/v1/pqc/hybrid/encrypt", post(hybrid_encrypt))
        .route("/api/v1/pqc/algorithms", get(algorithms))
        .layer(CorsLayer::permissive());

    let port: u16 = std::env::var("QUANTUM_CRYPTO_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8185);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Quantum crypto service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
