//! NDSEP WASM Edge Processing Module
//!
//! Compiled to WebAssembly for execution in:
//! - Browser (client-side preliminary analysis)
//! - IoT gateways (edge traffic analysis)
//! - Edge CDN nodes (geo-distributed processing)
//!
//! Provides: anomaly detection, threat scoring, PII detection, protocol classification

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ── Anomaly Detection (Statistical Z-Score) ─────────────────────────────────

#[wasm_bindgen]
pub struct AnomalyDetector {
    window: Vec<f64>,
    window_size: usize,
    threshold: f64,
}

#[wasm_bindgen]
impl AnomalyDetector {
    #[wasm_bindgen(constructor)]
    pub fn new(window_size: usize, threshold: f64) -> Self {
        Self {
            window: Vec::with_capacity(window_size),
            window_size,
            threshold,
        }
    }

    pub fn add_sample(&mut self, value: f64) -> bool {
        if self.window.len() >= self.window_size {
            self.window.remove(0);
        }
        self.window.push(value);

        if self.window.len() < 10 {
            return false; // not enough data
        }

        let mean = self.window.iter().sum::<f64>() / self.window.len() as f64;
        let variance = self.window.iter().map(|x| (x - mean).powi(2)).sum::<f64>()
            / self.window.len() as f64;
        let std_dev = variance.sqrt();

        if std_dev < f64::EPSILON {
            return false;
        }

        let z_score = (value - mean).abs() / std_dev;
        z_score > self.threshold
    }

    pub fn get_stats(&self) -> String {
        if self.window.is_empty() {
            return "{}".to_string();
        }
        let mean = self.window.iter().sum::<f64>() / self.window.len() as f64;
        let variance = self.window.iter().map(|x| (x - mean).powi(2)).sum::<f64>()
            / self.window.len() as f64;
        let min = self.window.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = self.window.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        serde_json::json!({
            "samples": self.window.len(),
            "mean": mean,
            "std_dev": variance.sqrt(),
            "min": min,
            "max": max,
        })
        .to_string()
    }
}

// ── Threat Scorer ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct ThreatScore {
    score: f64,
    category: String,
    indicators: Vec<String>,
}

#[wasm_bindgen]
pub struct ThreatScorer {
    malicious_ports: Vec<u16>,
    suspicious_patterns: Vec<String>,
}

#[wasm_bindgen]
impl ThreatScorer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            malicious_ports: vec![
                4444, 5555, 6666, 31337, 12345, 27374, 1337, 9001,
                4443, 8443, 6667, 6668, 6669, // IRC
                445, 139, // SMB
                23, // Telnet
            ],
            suspicious_patterns: vec![
                "cmd.exe".to_string(),
                "/bin/sh".to_string(),
                "eval(".to_string(),
                "SELECT.*FROM".to_string(),
                "UNION.*SELECT".to_string(),
                "<script>".to_string(),
                "passwd".to_string(),
                "shadow".to_string(),
                "Authorization:".to_string(),
                "BEGIN RSA".to_string(),
            ],
        }
    }

    pub fn score_connection(&self, dst_port: u16, payload_preview: &str, packet_size: u32) -> String {
        let mut score: f64 = 0.0;
        let mut indicators = Vec::new();

        // Port analysis
        if self.malicious_ports.contains(&dst_port) {
            score += 30.0;
            indicators.push(format!("Suspicious port: {}", dst_port));
        }
        if dst_port > 49152 {
            score += 10.0;
            indicators.push("High ephemeral port".to_string());
        }

        // Payload analysis
        let payload_lower = payload_preview.to_lowercase();
        for pattern in &self.suspicious_patterns {
            if payload_lower.contains(&pattern.to_lowercase()) {
                score += 20.0;
                indicators.push(format!("Suspicious pattern: {}", pattern));
            }
        }

        // Size anomaly
        if packet_size > 9000 {
            score += 15.0;
            indicators.push("Jumbo frame detected".to_string());
        }
        if packet_size < 20 {
            score += 10.0;
            indicators.push("Suspiciously small packet".to_string());
        }

        score = score.min(100.0);
        let category = if score >= 75.0 {
            "critical"
        } else if score >= 50.0 {
            "high"
        } else if score >= 25.0 {
            "medium"
        } else {
            "low"
        };

        serde_json::to_string(&ThreatScore {
            score,
            category: category.to_string(),
            indicators,
        })
        .unwrap_or_default()
    }
}

// ── PII Detector (runs in browser for local data classification) ────────────

#[wasm_bindgen]
pub struct PiiDetector {
    nin_pattern_len: usize,
    bvn_pattern_len: usize,
}

#[derive(Serialize)]
struct PiiResult {
    has_pii: bool,
    detections: Vec<PiiDetection>,
    risk_level: String,
}

#[derive(Serialize)]
struct PiiDetection {
    pii_type: String,
    confidence: f64,
    location: String,
}

#[wasm_bindgen]
impl PiiDetector {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            nin_pattern_len: 11,
            bvn_pattern_len: 11,
        }
    }

    pub fn scan(&self, text: &str) -> String {
        let mut detections = Vec::new();

        // NIN detection (11-digit number)
        let digits: Vec<(usize, String)> = extract_digit_sequences(text);
        for (pos, seq) in &digits {
            if seq.len() == self.nin_pattern_len {
                detections.push(PiiDetection {
                    pii_type: "NIN".to_string(),
                    confidence: 0.85,
                    location: format!("offset:{}", pos),
                });
            }
            if seq.len() == self.bvn_pattern_len && seq.starts_with("22") {
                detections.push(PiiDetection {
                    pii_type: "BVN".to_string(),
                    confidence: 0.90,
                    location: format!("offset:{}", pos),
                });
            }
        }

        // Email detection
        if text.contains('@') && text.contains('.') {
            let parts: Vec<&str> = text.split_whitespace().collect();
            for part in parts {
                if part.contains('@') && part.contains('.') && part.len() > 5 {
                    detections.push(PiiDetection {
                        pii_type: "Email".to_string(),
                        confidence: 0.95,
                        location: "inline".to_string(),
                    });
                }
            }
        }

        // Phone number detection (Nigerian +234)
        let text_lower = text.to_lowercase();
        if text_lower.contains("+234") || text_lower.contains("0803") || text_lower.contains("0805")
            || text_lower.contains("0807") || text_lower.contains("0810") || text_lower.contains("0901")
        {
            detections.push(PiiDetection {
                pii_type: "PhoneNumber".to_string(),
                confidence: 0.88,
                location: "inline".to_string(),
            });
        }

        // Credit card pattern (16 digits)
        for (pos, seq) in &digits {
            if seq.len() == 16 {
                detections.push(PiiDetection {
                    pii_type: "CreditCard".to_string(),
                    confidence: 0.80,
                    location: format!("offset:{}", pos),
                });
            }
        }

        let has_pii = !detections.is_empty();
        let risk_level = if detections.iter().any(|d| d.pii_type == "BVN" || d.pii_type == "NIN") {
            "critical"
        } else if detections.iter().any(|d| d.pii_type == "CreditCard") {
            "high"
        } else if has_pii {
            "medium"
        } else {
            "none"
        };

        serde_json::to_string(&PiiResult {
            has_pii,
            detections,
            risk_level: risk_level.to_string(),
        })
        .unwrap_or_default()
    }
}

fn extract_digit_sequences(text: &str) -> Vec<(usize, String)> {
    let mut results = Vec::new();
    let mut current = String::new();
    let mut start = 0;

    for (i, ch) in text.char_indices() {
        if ch.is_ascii_digit() {
            if current.is_empty() {
                start = i;
            }
            current.push(ch);
        } else if !current.is_empty() {
            if current.len() >= 8 {
                results.push((start, current.clone()));
            }
            current.clear();
        }
    }
    if current.len() >= 8 {
        results.push((start, current));
    }
    results
}

// ── Protocol Classifier ─────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn classify_protocol(dst_port: u16, payload_hint: &str) -> String {
    let protocol = match dst_port {
        80 => "HTTP",
        443 => "HTTPS/TLS",
        53 => "DNS",
        22 => "SSH",
        21 => "FTP",
        25 | 587 => "SMTP",
        110 => "POP3",
        143 | 993 => "IMAP",
        3306 => "MySQL",
        5432 => "PostgreSQL",
        6379 => "Redis",
        27017 => "MongoDB",
        8080 | 8443 => "HTTP-Alt",
        1883 => "MQTT",
        5683 => "CoAP",
        502 => "Modbus",
        161 | 162 => "SNMP",
        389 | 636 => "LDAP",
        _ => {
            if payload_hint.starts_with("GET ") || payload_hint.starts_with("POST ") {
                "HTTP"
            } else if payload_hint.starts_with("SSH-") {
                "SSH"
            } else if payload_hint.contains("TLS") {
                "TLS"
            } else {
                "Unknown"
            }
        }
    };
    protocol.to_string()
}

// ── Batch Analyzer (for IoT gateway edge processing) ────────────────────────

#[wasm_bindgen]
pub struct BatchAnalyzer {
    anomaly: AnomalyDetector,
    threat: ThreatScorer,
    pii: PiiDetector,
    packets_analyzed: u64,
    threats_found: u64,
    pii_found: u64,
}

#[wasm_bindgen]
impl BatchAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            anomaly: AnomalyDetector::new(1000, 3.0),
            threat: ThreatScorer::new(),
            pii: PiiDetector::new(),
            packets_analyzed: 0,
            threats_found: 0,
            pii_found: 0,
        }
    }

    pub fn analyze_packet(&mut self, dst_port: u16, payload: &str, size: u32) -> String {
        self.packets_analyzed += 1;

        let is_anomaly = self.anomaly.add_sample(size as f64);
        let threat_json = self.threat.score_connection(dst_port, payload, size);
        let pii_json = self.pii.scan(payload);
        let protocol = classify_protocol(dst_port, payload);

        // Parse results for counters
        if let Ok(threat) = serde_json::from_str::<serde_json::Value>(&threat_json) {
            if threat.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0) >= 50.0 {
                self.threats_found += 1;
            }
        }
        if let Ok(pii) = serde_json::from_str::<serde_json::Value>(&pii_json) {
            if pii.get("has_pii").and_then(|p| p.as_bool()).unwrap_or(false) {
                self.pii_found += 1;
            }
        }

        serde_json::json!({
            "protocol": protocol,
            "is_anomaly": is_anomaly,
            "threat": serde_json::from_str::<serde_json::Value>(&threat_json).unwrap_or_default(),
            "pii": serde_json::from_str::<serde_json::Value>(&pii_json).unwrap_or_default(),
        })
        .to_string()
    }

    pub fn get_summary(&self) -> String {
        serde_json::json!({
            "packets_analyzed": self.packets_analyzed,
            "threats_found": self.threats_found,
            "pii_detections": self.pii_found,
            "anomaly_stats": self.anomaly.get_stats(),
        })
        .to_string()
    }
}
