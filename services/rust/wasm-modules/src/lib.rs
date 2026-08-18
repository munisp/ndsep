//! NDSEP WASM Modules
//! Compiled to WebAssembly for use in PWA and React Native.
//! Provides client-side PQC verification, compliance scoring, and offline computation.

use wasm_bindgen::prelude::*;
use sha3::{Digest, Sha3_256};

/// Compute SHA3-256 hash of data (for consent receipt verification)
#[wasm_bindgen]
pub fn sha3_hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha3_256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Verify a consent receipt hash matches expected value
#[wasm_bindgen]
pub fn verify_consent_hash(receipt_data: &str, expected_hash: &str) -> bool {
    let hash = sha3_hash(receipt_data.as_bytes());
    let computed = hash.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    computed == expected_hash
}

/// Compute local compliance score (offline-capable)
/// Dimensions: governance, consent, security, breach_readiness, cross_border, dpo, dsr
#[wasm_bindgen]
pub fn compute_compliance_score(controls_json: &str) -> f64 {
    let controls: Vec<String> = serde_json::from_str(controls_json).unwrap_or_default();

    let mut score: f64 = 0.0;
    let mut count: f64 = 0.0;

    // Governance (0-100)
    let mut gov: f64 = 40.0;
    for c in &["data_classification", "retention_policy", "dpo_appointed", "privacy_by_design"] {
        if controls.iter().any(|x| x == c) { gov += 15.0; }
    }
    score += gov.min(100.0);
    count += 1.0;

    // Security (0-100)
    let mut sec: f64 = 30.0;
    for c in &["encryption", "access_control", "audit_logging", "vulnerability_scanning", "incident_response"] {
        if controls.iter().any(|x| x == c) { sec += 14.0; }
    }
    score += sec.min(100.0);
    count += 1.0;

    // Breach readiness (0-100)
    let mut breach: f64 = 20.0;
    if controls.iter().any(|x| x == "incident_response_plan") { breach += 30.0; }
    if controls.iter().any(|x| x == "breach_notification_process") { breach += 25.0; }
    if controls.iter().any(|x| x == "forensics_capability") { breach += 25.0; }
    score += breach.min(100.0);
    count += 1.0;

    // DSR (0-100)
    let mut dsr: f64 = 20.0;
    for c in &["access_request_process", "erasure_process", "portability", "objection_mechanism"] {
        if controls.iter().any(|x| x == c) { dsr += 20.0; }
    }
    score += dsr.min(100.0);
    count += 1.0;

    score / count
}

/// Validate a PQC signature locally (lightweight check)
#[wasm_bindgen]
pub fn verify_pqc_signature_format(signature: &[u8], algorithm: &str) -> bool {
    match algorithm {
        "dilithium3" => signature.len() == 3293,
        "dilithium5" => signature.len() == 4595,
        _ => false,
    }
}

/// Generate a data lineage hash chain entry
#[wasm_bindgen]
pub fn lineage_hash(previous_hash: &str, event_data: &str) -> String {
    let input = format!("{}:{}", previous_hash, event_data);
    let hash = sha3_hash(input.as_bytes());
    hash.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Compute risk score from factors (for offline breach prediction)
#[wasm_bindgen]
pub fn compute_risk_score(
    sector_risk: f64,
    control_coverage: f64,
    incident_history: u32,
    days_since_audit: u32,
) -> f64 {
    let base = sector_risk * 0.3;
    let controls = (1.0 - control_coverage) * 30.0;
    let history = (incident_history as f64).min(10.0) * 3.0;
    let audit_decay = if days_since_audit > 365 { 15.0 } else { (days_since_audit as f64 / 365.0) * 15.0 };

    (base + controls + history + audit_decay).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::compute_compliance_score;

    #[test]
    fn compliance_score_uses_f64_clamps_and_average() {
        let empty = compute_compliance_score("[]");
        assert!((empty - 27.5).abs() < f64::EPSILON);

        let controls = r#"["data_classification","retention_policy","dpo_appointed","privacy_by_design","encryption","access_control","audit_logging","vulnerability_scanning","incident_response","incident_response_plan","breach_notification_process","forensics_capability","access_request_process","erasure_process","portability","objection_mechanism"]"#;
        let complete = compute_compliance_score(controls);
        assert!((complete - 100.0).abs() < f64::EPSILON);
    }
}
