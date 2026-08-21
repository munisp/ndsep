use axum::{
    extract::{Query, State},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::analysis::anomaly::AnomalyDetector;
use crate::analysis::iot::IoTDetector;
use crate::analysis::threat::ThreatClassifier;
use crate::capture::engine::CaptureEngine;
use crate::models::packet::ThreatSeverity;

#[derive(Clone)]
pub struct AppState {
    pub capture: CaptureEngine,
    pub anomaly: AnomalyDetector,
    pub threat: ThreatClassifier,
    pub iot: IoTDetector,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        // Health & metrics
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/status", get(status))
        // Capture control
        .route("/api/interfaces", get(list_interfaces))
        .route("/api/capture/start", post(start_capture))
        .route("/api/capture/stop", post(stop_capture))
        .route("/api/capture/reset", post(reset_capture))
        .route("/api/capture/stats", get(capture_stats))
        .route("/api/packets", get(get_packets))
        .route("/api/packets/live", get(get_packets))
        // Analysis
        .route("/api/threats", get(get_threats))
        .route("/api/threats/summary", get(threat_summary))
        .route("/api/anomaly/stats", get(anomaly_stats))
        .route("/api/anomaly/analyze", post(analyze_batch))
        // IoT
        .route("/api/iot/devices", get(get_iot_devices))
        .route("/api/iot/high-risk", get(get_high_risk_devices))
        // Protocol statistics
        .route("/api/protocols", get(protocol_stats))
        // Top talkers
        .route("/api/top-sources", get(top_sources))
        .route("/api/top-destinations", get(top_destinations))
        // Threat intelligence
        .route("/api/threat-intel/add-ip", post(add_malicious_ip))
        .with_state(state)
}

async fn health(State(_s): State<AppState>) -> Json<Value> {
    Json(ndsep_shared::health_response("wiredigg"))
}

async fn metrics(State(s): State<AppState>) -> Json<Value> {
    let stats = s.capture.get_stats();
    let anomaly = s.anomaly.stats();
    Json(json!({
        "packetsCaptured": stats.packets_captured,
        "bytesCaptures": stats.bytes_captured,
        "packetsPerSecond": stats.packets_per_second,
        "threatsDetected": s.threat.total_threats(),
        "anomaliesDetected": anomaly.anomalies_found,
        "iotDevices": s.iot.device_count(),
        "uniqueSources": stats.unique_sources,
        "uniqueDestinations": stats.unique_destinations,
        "captureActive": s.capture.is_capturing.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

async fn status(State(s): State<AppState>) -> Json<Value> {
    let stats = s.capture.get_stats();
    Json(json!({
        "id": "wiredigg",
        "name": "Network Intelligence Engine",
        "layer": "L1",
        "status": "active",
        "version": env!("CARGO_PKG_VERSION"),
        "capabilities": [
            "packet_capture",
            "protocol_dissection",
            "anomaly_detection",
            "threat_classification",
            "iot_fingerprinting",
            "ndpa_compliance",
        ],
        "protocols_supported": [
            "TCP", "UDP", "ICMP", "ICMPv6", "ARP", "DNS", "HTTP", "HTTPS/TLS",
            "SSH", "SMTP", "FTP", "DHCP", "NTP", "SNMP", "SSDP", "mDNS",
            "LLMNR", "SMB", "MQTT", "CoAP", "Modbus", "OPC-UA", "SIP", "RTSP",
        ],
        "threat_types": 27,
        "mitre_coverage": "13 tactics",
        "stats": {
            "packets": stats.packets_captured,
            "threats": s.threat.total_threats(),
            "iot_devices": s.iot.device_count(),
        }
    }))
}

async fn list_interfaces(State(_s): State<AppState>) -> Json<Value> {
    let interfaces = CaptureEngine::list_interfaces();
    Json(json!({ "interfaces": interfaces }))
}

#[derive(Deserialize)]
struct StartCaptureRequest {
    interface: String,
}

async fn start_capture(
    State(s): State<AppState>,
    Json(req): Json<StartCaptureRequest>,
) -> Json<Value> {
    match s.capture.start_capture(&req.interface) {
        Ok(()) => Json(json!({ "status": "started", "interface": req.interface })),
        Err(e) => Json(json!({ "status": "error", "error": e })),
    }
}

async fn stop_capture(State(s): State<AppState>) -> Json<Value> {
    s.capture.stop_capture();
    Json(json!({ "status": "stopped" }))
}

async fn reset_capture(State(s): State<AppState>) -> Json<Value> {
    s.capture.reset();
    Json(json!({ "status": "reset" }))
}

async fn capture_stats(State(s): State<AppState>) -> Json<Value> {
    let stats = s.capture.get_stats();
    Json(serde_json::to_value(stats).unwrap_or(json!({})))
}

#[derive(Deserialize)]
struct PaginationParams {
    limit: Option<usize>,
    offset: Option<usize>,
}

async fn get_packets(
    State(s): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Json<Value> {
    let limit = params.limit.unwrap_or(100).min(1000);
    let offset = params.offset.unwrap_or(0);
    let packets = s.capture.get_recent_packets(limit, offset);
    Json(json!({
        "packets": packets,
        "count": packets.len(),
        "total": s.capture.packet_count.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

#[derive(Deserialize)]
struct ThreatParams {
    limit: Option<usize>,
    severity: Option<String>,
}

async fn get_threats(State(s): State<AppState>, Query(params): Query<ThreatParams>) -> Json<Value> {
    let limit = params.limit.unwrap_or(100);
    let mut threats = s.threat.get_threats(limit);

    if let Some(sev) = &params.severity {
        let target: Option<ThreatSeverity> = match sev.to_lowercase().as_str() {
            "critical" => Some(ThreatSeverity::Critical),
            "high" => Some(ThreatSeverity::High),
            "medium" => Some(ThreatSeverity::Medium),
            "low" => Some(ThreatSeverity::Low),
            "info" => Some(ThreatSeverity::Info),
            _ => None,
        };
        if let Some(target) = target {
            threats.retain(|t| t.severity == target);
        }
    }

    Json(json!({
        "threats": threats,
        "count": threats.len(),
        "total": s.threat.total_threats(),
    }))
}

async fn threat_summary(State(s): State<AppState>) -> Json<Value> {
    let summary = s.threat.threat_summary();
    Json(json!({
        "summary": summary,
        "total": s.threat.total_threats(),
    }))
}

async fn anomaly_stats(State(s): State<AppState>) -> Json<Value> {
    let stats = s.anomaly.stats();
    Json(serde_json::to_value(stats).unwrap_or(json!({})))
}

async fn analyze_batch(State(s): State<AppState>) -> Json<Value> {
    let packets = s.capture.get_recent_packets(256, 0);
    s.anomaly.train_on_batch(&packets);

    let results: Vec<_> = packets.iter().map(|p| s.anomaly.analyze(p)).collect();
    let anomalous_count = results.iter().filter(|r| r.is_anomalous).count();

    Json(json!({
        "analyzed": results.len(),
        "anomalies": anomalous_count,
        "model_trained": true,
    }))
}

async fn get_iot_devices(State(s): State<AppState>) -> Json<Value> {
    let devices = s.iot.get_devices();
    Json(json!({
        "devices": devices,
        "count": devices.len(),
    }))
}

async fn get_high_risk_devices(State(s): State<AppState>) -> Json<Value> {
    let devices = s.iot.high_risk_devices();
    Json(json!({
        "devices": devices,
        "count": devices.len(),
    }))
}

async fn protocol_stats(State(s): State<AppState>) -> Json<Value> {
    let stats = s.capture.get_stats();
    Json(json!({
        "protocols": stats.protocols,
        "total": stats.protocols.total,
    }))
}

#[derive(Deserialize)]
struct TopParams {
    limit: Option<usize>,
}

async fn top_sources(State(s): State<AppState>, Query(params): Query<TopParams>) -> Json<Value> {
    let limit = params.limit.unwrap_or(20);
    let mut sources: Vec<(IpAddr, u64)> = s
        .capture
        .source_ips
        .iter()
        .map(|e| (*e.key(), *e.value()))
        .collect();
    sources.sort_by(|a, b| b.1.cmp(&a.1));
    sources.truncate(limit);

    let items: Vec<Value> = sources
        .iter()
        .map(|(ip, count)| json!({ "ip": ip.to_string(), "packets": count }))
        .collect();
    Json(json!({ "sources": items }))
}

async fn top_destinations(
    State(s): State<AppState>,
    Query(params): Query<TopParams>,
) -> Json<Value> {
    let limit = params.limit.unwrap_or(20);
    let mut dests: Vec<(IpAddr, u64)> = s
        .capture
        .dest_ips
        .iter()
        .map(|e| (*e.key(), *e.value()))
        .collect();
    dests.sort_by(|a, b| b.1.cmp(&a.1));
    dests.truncate(limit);

    let items: Vec<Value> = dests
        .iter()
        .map(|(ip, count)| json!({ "ip": ip.to_string(), "packets": count }))
        .collect();
    Json(json!({ "destinations": items }))
}

#[derive(Deserialize)]
struct AddIpRequest {
    ip: String,
}

async fn add_malicious_ip(State(s): State<AppState>, Json(req): Json<AddIpRequest>) -> Json<Value> {
    match req.ip.parse::<IpAddr>() {
        Ok(ip) => {
            s.threat.add_malicious_ip(ip);
            Json(json!({ "status": "added", "ip": req.ip }))
        }
        Err(e) => Json(json!({ "status": "error", "error": e.to_string() })),
    }
}

use std::net::IpAddr;
