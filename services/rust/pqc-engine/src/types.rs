//! Shared types for PQC engine

use serde::{Deserialize, Serialize};

/// Supported PQC algorithms
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PQCAlgorithm {
    Kyber768,
    Kyber1024,
    Dilithium3,
    Dilithium5,
}

impl PQCAlgorithm {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "kyber768" => Some(Self::Kyber768),
            "kyber1024" => Some(Self::Kyber1024),
            "dilithium3" => Some(Self::Dilithium3),
            "dilithium5" => Some(Self::Dilithium5),
            _ => None,
        }
    }

    pub fn key_sizes(&self) -> (usize, usize) {
        match self {
            Self::Kyber768 => (1184, 2400),
            Self::Kyber1024 => (1568, 3168),
            Self::Dilithium3 => (1952, 4000),
            Self::Dilithium5 => (2592, 4864),
        }
    }
}

/// Consent receipt anchoring (for blockchain/immutable ledger)
#[derive(Debug, Serialize, Deserialize)]
pub struct ConsentReceipt {
    pub receipt_id: String,
    pub subject_hash: String, // SHA3-256 of data subject ID
    pub purpose: String,
    pub granted_at: String,
    pub expires_at: Option<String>,
    pub signature: String, // PQC signature of the receipt
    pub public_key_id: String,
}

/// Data transfer attestation (cross-border)
#[derive(Debug, Serialize, Deserialize)]
pub struct TransferAttestation {
    pub attestation_id: String,
    pub source_jurisdiction: String,
    pub destination_jurisdiction: String,
    pub data_classification: String,
    pub legal_basis: String,
    pub signed_hash: String,
    pub timestamp: String,
}
