//! NDSEP WASM modules — client-side privacy-preserving computation.
//! Compiled to WebAssembly for use in PWA and React Native.
//! Provides client-side PQC verification, compliance scoring, and offline computation.

use sha3::{Digest, Sha3_256};
use wasm_bindgen::prelude::*;

/// Compute SHA3-256 hash of data (for consent receipt verification).
#[wasm_bindgen]
pub fn sha3_hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha3_256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Verify a consent receipt hash matches expected value.
#[wasm_bindgen]
pub fn verify_consent_hash(receipt_data: &str, expected_hash: &str) -> bool {
    let hash = sha3_hash(receipt_data.as_bytes());
    let computed = hash.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    computed == expected_hash
}

/// Stable, non-sensitive validation codes for the client-facing scoring API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ComplianceScoreValidationError {
    InvalidControlsJson,
}

impl ComplianceScoreValidationError {
    fn code(self) -> &'static str {
        match self {
            Self::InvalidControlsJson => "INVALID_CONTROLS_JSON",
        }
    }
}

fn parse_compliance_controls(
    controls_json: &str,
) -> Result<Vec<String>, ComplianceScoreValidationError> {
    serde_json::from_str(controls_json).map_err(|_| ComplianceScoreValidationError::InvalidControlsJson)
}

fn score_compliance_controls(controls: &[String]) -> f64 {
    let mut score: f64 = 0.0;
    let mut count: f64 = 0.0;

    // Governance (0-100)
    let mut gov: f64 = 40.0;
    for control in [
        "data_classification",
        "retention_policy",
        "dpo_appointed",
        "privacy_by_design",
    ] {
        if controls.iter().any(|value| value == control) {
            gov += 15.0;
        }
    }
    score += gov.min(100.0);
    count += 1.0;

    // Security (0-100)
    let mut sec: f64 = 30.0;
    for control in [
        "encryption",
        "access_control",
        "audit_logging",
        "vulnerability_scanning",
        "incident_response",
    ] {
        if controls.iter().any(|value| value == control) {
            sec += 14.0;
        }
    }
    score += sec.min(100.0);
    count += 1.0;

    // Breach readiness (0-100)
    let mut breach: f64 = 20.0;
    if controls.iter().any(|value| value == "incident_response_plan") {
        breach += 30.0;
    }
    if controls.iter().any(|value| value == "breach_notification_process") {
        breach += 25.0;
    }
    if controls.iter().any(|value| value == "forensics_capability") {
        breach += 25.0;
    }
    score += breach.min(100.0);
    count += 1.0;

    // DSR (0-100)
    let mut dsr: f64 = 20.0;
    for control in [
        "access_request_process",
        "erasure_process",
        "portability",
        "objection_mechanism",
    ] {
        if controls.iter().any(|value| value == control) {
            dsr += 20.0;
        }
    }
    score += dsr.min(100.0);
    count += 1.0;

    score / count
}

fn score_compliance_from_json(
    controls_json: &str,
) -> Result<f64, ComplianceScoreValidationError> {
    let controls = parse_compliance_controls(controls_json)?;
    Ok(score_compliance_controls(&controls))
}

/// Compute the local compliance score from a valid JSON array of controls.
///
/// Invalid JSON and JSON values that are not string arrays return the stable
/// `INVALID_CONTROLS_JSON` error to JavaScript/WASM callers. Callers must treat
/// that error as unavailable input rather than displaying a baseline score.
#[wasm_bindgen]
pub fn compute_compliance_score(controls_json: &str) -> Result<f64, JsValue> {
    score_compliance_from_json(controls_json)
        .map_err(|validation_error| JsValue::from_str(validation_error.code()))
}

/// Validate a PQC signature locally (lightweight format check).
#[wasm_bindgen]
pub fn verify_pqc_signature_format(signature: &[u8], algorithm: &str) -> bool {
    match algorithm {
        "dilithium3" => signature.len() == 3293,
        "dilithium5" => signature.len() == 4595,
        _ => false,
    }
}

/// Generate a data lineage hash chain entry.
#[wasm_bindgen]
pub fn lineage_hash(previous_hash: &str, event_data: &str) -> String {
    let input = format!("{}:{}", previous_hash, event_data);
    let hash = sha3_hash(input.as_bytes());
    hash.iter().map(|byte| format!("{:02x}", byte)).collect()
}

/// Compute a bounded risk score from local factors (for offline breach prediction).
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
    let audit_decay = if days_since_audit > 365 {
        15.0
    } else {
        (days_since_audit as f64 / 365.0) * 15.0
    };

    (base + controls + history + audit_decay).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::{score_compliance_from_json, ComplianceScoreValidationError};

    #[test]
    fn valid_empty_controls_retain_the_baseline_score() {
        assert!(matches!(
            score_compliance_from_json("[]"),
            Ok(score) if (score - 27.5).abs() < f64::EPSILON
        ));
    }

    #[test]
    fn complete_controls_retain_the_capped_average_score() {
        let controls = r#"["data_classification","retention_policy","dpo_appointed","privacy_by_design","encryption","access_control","audit_logging","vulnerability_scanning","incident_response","incident_response_plan","breach_notification_process","forensics_capability","access_request_process","erasure_process","portability","objection_mechanism"]"#;
        assert!(matches!(
            score_compliance_from_json(controls),
            Ok(score) if (score - 100.0).abs() < f64::EPSILON
        ));
    }

    #[test]
    fn malformed_json_returns_an_explicit_validation_error() {
        assert!(matches!(
            score_compliance_from_json("{not-json}"),
            Err(ComplianceScoreValidationError::InvalidControlsJson)
        ));
    }

    #[test]
    fn non_array_json_returns_an_explicit_validation_error() {
        assert!(matches!(
            score_compliance_from_json(r#"{"control":"encryption"}"#),
            Err(ComplianceScoreValidationError::InvalidControlsJson)
        ));
    }
}
