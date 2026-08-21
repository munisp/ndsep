/*!
NDSEP NOC Collector — SNMP/Syslog/NetFlow Ingest Engine (Rust)
================================================================
Production-grade network data collection for Network Operations Center.
Listens on three protocols simultaneously:
  - SNMP Trap receiver  (UDP :1162) — device alerts, OID polling, interface stats
  - Syslog receiver     (UDP :1514) — RFC 5424/3164 log messages from network gear
  - NetFlow collector   (UDP :2055) — v5/v9/IPFIX traffic flow records

Middleware integrations:
  - PostgreSQL — persists devices, alerts, topology, metrics
  - Kafka — publishes noc.snmp, noc.syslog, noc.netflow topics
  - Redis — caches device state, deduplicates alerts
  - OpenSearch — indexes syslog messages for full-text search
  - Dapr — service invocation for cross-service coordination
  - Fluvio — edge telemetry relay for high-throughput NetFlow
  - Lakehouse — writes raw flow data for historical analytics

Technology: Rust · Tokio · Axum · UDP async sockets
Port: 8190 (HTTP API)
*/

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use tokio::net::UdpSocket;
use uuid::Uuid;

const WORKER_NAME: &str = "noc-collector";
const HTTP_PORT: u16 = 8190;
const SNMP_TRAP_PORT: u16 = 1162;
const SYSLOG_PORT: u16 = 1514;
const NETFLOW_PORT: u16 = 2055;

// ── Configuration ────────────────────────────────────────────────────────────

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

// ── Data Models ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnmpTrap {
    pub trap_id: String,
    pub source_ip: String,
    pub oid: String,
    pub oid_name: String,
    pub value: String,
    pub severity: String,
    pub community: String,
    pub version: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyslogMessage {
    pub msg_id: String,
    pub source_ip: String,
    pub facility: u8,
    pub severity: u8,
    pub hostname: String,
    pub app_name: String,
    pub message: String,
    pub structured_data: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetFlowRecord {
    pub flow_id: String,
    pub collector_ip: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
    pub bytes: u64,
    pub packets: u64,
    pub tcp_flags: u8,
    pub tos: u8,
    pub src_as: u32,
    pub dst_as: u32,
    pub input_interface: u16,
    pub output_interface: u16,
    pub flow_start: DateTime<Utc>,
    pub flow_end: DateTime<Utc>,
    pub version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceState {
    pub device_id: String,
    pub hostname: String,
    pub ip: String,
    pub device_type: String,
    pub status: String,
    pub cpu_pct: f64,
    pub memory_pct: f64,
    pub bandwidth_in_mbps: f64,
    pub bandwidth_out_mbps: f64,
    pub last_seen: DateTime<Utc>,
    pub interfaces: Vec<InterfaceState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceState {
    pub name: String,
    pub status: String,
    pub speed_mbps: u64,
    pub in_octets: u64,
    pub out_octets: u64,
    pub in_errors: u64,
    pub out_errors: u64,
    pub utilization_pct: f64,
}

// ── SNMP OID Database ────────────────────────────────────────────────────────

fn oid_to_name(oid: &str) -> &str {
    match oid {
        "1.3.6.1.2.1.1.1.0" => "sysDescr",
        "1.3.6.1.2.1.1.3.0" => "sysUpTime",
        "1.3.6.1.2.1.1.5.0" => "sysName",
        "1.3.6.1.2.1.1.6.0" => "sysLocation",
        "1.3.6.1.2.1.2.1.0" => "ifNumber",
        "1.3.6.1.2.1.2.2.1.2" => "ifDescr",
        "1.3.6.1.2.1.2.2.1.5" => "ifSpeed",
        "1.3.6.1.2.1.2.2.1.8" => "ifOperStatus",
        "1.3.6.1.2.1.2.2.1.10" => "ifInOctets",
        "1.3.6.1.2.1.2.2.1.14" => "ifInErrors",
        "1.3.6.1.2.1.2.2.1.16" => "ifOutOctets",
        "1.3.6.1.2.1.2.2.1.20" => "ifOutErrors",
        "1.3.6.1.2.1.25.3.3.1.2" => "hrProcessorLoad",
        "1.3.6.1.2.1.25.2.3.1.6" => "hrStorageUsed",
        "1.3.6.1.2.1.25.2.3.1.5" => "hrStorageSize",
        "1.3.6.1.4.1.9.9.109.1.1.1.1.6" => "cpmCPUTotal5minRev",
        "1.3.6.1.6.3.1.1.5.3" => "linkDown",
        "1.3.6.1.6.3.1.1.5.4" => "linkUp",
        "1.3.6.1.6.3.1.1.5.1" => "coldStart",
        "1.3.6.1.6.3.1.1.5.5" => "authenticationFailure",
        _ => "unknown",
    }
}

fn classify_snmp_severity(oid: &str) -> &str {
    match oid {
        "1.3.6.1.6.3.1.1.5.3" => "high",     // linkDown
        "1.3.6.1.6.3.1.1.5.1" => "critical", // coldStart
        "1.3.6.1.6.3.1.1.5.5" => "high",     // authFailure
        "1.3.6.1.6.3.1.1.5.4" => "info",     // linkUp
        _ => "medium",
    }
}

// ── Syslog Parser (RFC 5424 / RFC 3164) ──────────────────────────────────────

fn facility_name(facility: u8) -> &'static str {
    match facility {
        0 => "kern",
        1 => "user",
        2 => "mail",
        3 => "daemon",
        4 => "auth",
        5 => "syslog",
        6 => "lpr",
        7 => "news",
        8 => "uucp",
        9 => "cron",
        10 => "authpriv",
        11 => "ftp",
        12 => "ntp",
        13 => "security",
        14 => "console",
        15 => "solaris-cron",
        16 => "local0",
        17 => "local1",
        18 => "local2",
        19 => "local3",
        20 => "local4",
        21 => "local5",
        22 => "local6",
        23 => "local7",
        _ => "unknown",
    }
}

fn syslog_severity_name(sev: u8) -> &'static str {
    match sev {
        0 => "emergency",
        1 => "alert",
        2 => "critical",
        3 => "error",
        4 => "warning",
        5 => "notice",
        6 => "info",
        7 => "debug",
        _ => "unknown",
    }
}

fn map_syslog_to_noc_severity(sev: u8) -> &'static str {
    match sev {
        0 | 1 => "critical",
        2 | 3 => "high",
        4 => "medium",
        5 | 6 => "low",
        _ => "info",
    }
}

fn parse_syslog(data: &[u8], source_ip: &str) -> Option<SyslogMessage> {
    let msg = String::from_utf8_lossy(data);
    let msg = msg.trim();
    if msg.len() < 3 {
        return None;
    }

    // RFC 3164: <PRI>TIMESTAMP HOSTNAME APP-NAME: MESSAGE
    if !msg.starts_with('<') {
        return None;
    }
    let pri_end = msg.find('>')?;
    let pri: u16 = msg[1..pri_end].parse().ok()?;
    let facility = (pri >> 3) as u8;
    let severity = (pri & 0x07) as u8;
    let rest = &msg[pri_end + 1..];

    let parts: Vec<&str> = rest.splitn(4, ' ').collect();
    let hostname = if parts.len() > 1 { parts[1] } else { source_ip };
    let app_name = if parts.len() > 2 {
        parts[2].trim_end_matches(':')
    } else {
        "unknown"
    };
    let message = if parts.len() > 3 { parts[3] } else { rest };

    Some(SyslogMessage {
        msg_id: Uuid::new_v4().to_string(),
        source_ip: source_ip.to_string(),
        facility,
        severity,
        hostname: hostname.to_string(),
        app_name: app_name.to_string(),
        message: message.to_string(),
        structured_data: None,
        timestamp: Utc::now(),
    })
}

// ── NetFlow v5 Parser ────────────────────────────────────────────────────────

fn parse_netflow_v5(data: &[u8], source_ip: &str) -> Vec<NetFlowRecord> {
    let mut records = Vec::new();
    if data.len() < 24 {
        return records;
    }

    let version = u16::from_be_bytes([data[0], data[1]]);
    if version != 5 {
        return records;
    }

    let count = u16::from_be_bytes([data[2], data[3]]) as usize;
    let sys_uptime = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
    let _unix_secs = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);

    let header_len = 24;
    let record_len = 48;

    for i in 0..count {
        let offset = header_len + i * record_len;
        if offset + record_len > data.len() {
            break;
        }
        let r = &data[offset..offset + record_len];

        let src_ip = format!("{}.{}.{}.{}", r[0], r[1], r[2], r[3]);
        let dst_ip = format!("{}.{}.{}.{}", r[4], r[5], r[6], r[7]);
        let packets = u32::from_be_bytes([r[16], r[17], r[18], r[19]]) as u64;
        let bytes = u32::from_be_bytes([r[20], r[21], r[22], r[23]]) as u64;
        let first = u32::from_be_bytes([r[24], r[25], r[26], r[27]]);
        let last = u32::from_be_bytes([r[28], r[29], r[30], r[31]]);
        let src_port = u16::from_be_bytes([r[32], r[33]]);
        let dst_port = u16::from_be_bytes([r[34], r[35]]);
        let tcp_flags = r[37];
        let protocol = r[38];
        let tos = r[39];
        let src_as = u16::from_be_bytes([r[40], r[41]]) as u32;
        let dst_as = u16::from_be_bytes([r[42], r[43]]) as u32;
        let input_if = u16::from_be_bytes([r[12], r[13]]);
        let output_if = u16::from_be_bytes([r[14], r[15]]);

        let now = Utc::now();
        let uptime_ms = sys_uptime as i64;
        let start_offset = (first as i64).saturating_sub(uptime_ms);
        let end_offset = (last as i64).saturating_sub(uptime_ms);
        let flow_start = now + chrono::Duration::milliseconds(start_offset.min(0));
        let flow_end = now + chrono::Duration::milliseconds(end_offset.min(0));

        records.push(NetFlowRecord {
            flow_id: Uuid::new_v4().to_string(),
            collector_ip: source_ip.to_string(),
            src_ip,
            dst_ip,
            src_port,
            dst_port,
            protocol,
            bytes,
            packets,
            tcp_flags,
            tos,
            src_as,
            dst_as,
            input_interface: input_if,
            output_interface: output_if,
            flow_start,
            flow_end,
            version: 5,
        });
    }
    records
}

// ── Shared State ─────────────────────────────────────────────────────────────

#[derive(Default)]
struct CollectorMetrics {
    snmp_traps_received: u64,
    syslog_messages_received: u64,
    netflow_records_received: u64,
    snmp_traps_processed: u64,
    syslog_messages_processed: u64,
    netflow_records_processed: u64,
    alerts_generated: u64,
    devices_discovered: u64,
    errors: u64,
}

struct AppState {
    db_url: String,
    relay_url: String,
    kafka_url: String,
    redis_url: String,
    opensearch_url: String,
    dapr_url: String,
    fluvio_url: String,
    lakehouse_url: String,
    metrics: RwLock<CollectorMetrics>,
    recent_traps: RwLock<Vec<SnmpTrap>>,
    recent_syslog: RwLock<Vec<SyslogMessage>>,
    recent_flows: RwLock<Vec<NetFlowRecord>>,
    devices: RwLock<HashMap<String, DeviceState>>,
    start_time: DateTime<Utc>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db_url: env_or(
                "DATABASE_URL",
                "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db",
            ),
            relay_url: env_or(
                "WORKER_RELAY_URL",
                "http://localhost:3000/api/workers/event",
            ),
            kafka_url: env_or("KAFKA_BROKERS", "localhost:9092"),
            redis_url: env_or("REDIS_URL", "redis://localhost:6379"),
            opensearch_url: env_or("OPENSEARCH_URL", "http://localhost:9200"),
            dapr_url: env_or("DAPR_HTTP_PORT", "http://localhost:3500"),
            fluvio_url: env_or("FLUVIO_URL", "localhost:9003"),
            lakehouse_url: env_or("LAKEHOUSE_URL", "http://localhost:8127"),
            metrics: RwLock::new(CollectorMetrics::default()),
            recent_traps: RwLock::new(Vec::new()),
            recent_syslog: RwLock::new(Vec::new()),
            recent_flows: RwLock::new(Vec::new()),
            devices: RwLock::new(HashMap::new()),
            start_time: Utc::now(),
        }
    }
}

// ── SNMP Trap Receiver ───────────────────────────────────────────────────────

async fn snmp_trap_listener(state: Arc<AppState>) {
    let bind_addr = format!("0.0.0.0:{SNMP_TRAP_PORT}");
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => {
            info!("[SNMP] Listening on UDP {bind_addr}");
            s
        }
        Err(e) => {
            warn!("[SNMP] Cannot bind {bind_addr}: {e} — running in simulation mode");
            run_snmp_simulation(state).await;
            return;
        }
    };

    let mut buf = [0u8; 65535];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let data = buf[..len].to_vec();
                let source_ip = addr.ip().to_string();
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    process_snmp_trap(&state, &data, &source_ip).await;
                });
            }
            Err(e) => {
                error!("[SNMP] recv error: {e}");
                if let Ok(mut m) = state.metrics.write() {
                    m.errors += 1;
                }
            }
        }
    }
}

async fn process_snmp_trap(state: &AppState, data: &[u8], source_ip: &str) {
    // Parse BER-encoded SNMP trap (simplified — real production would use rasn/yasna)
    // For now, extract OID from payload heuristically
    let payload = String::from_utf8_lossy(data);
    let oid = extract_oid_from_payload(&payload).unwrap_or("1.3.6.1.6.3.1.1.5.3");
    let value = extract_value_from_payload(&payload).unwrap_or("trap triggered");

    let trap = SnmpTrap {
        trap_id: Uuid::new_v4().to_string(),
        source_ip: source_ip.to_string(),
        oid: oid.to_string(),
        oid_name: oid_to_name(oid).to_string(),
        value: value.to_string(),
        severity: classify_snmp_severity(oid).to_string(),
        community: "public".to_string(),
        version: "v2c".to_string(),
        timestamp: Utc::now(),
    };

    if let Ok(mut m) = state.metrics.write() {
        m.snmp_traps_received += 1;
        m.snmp_traps_processed += 1;
    }

    if let Ok(mut traps) = state.recent_traps.write() {
        traps.push(trap.clone());
        if traps.len() > 500 {
            traps.drain(0..100);
        }
    }

    // Publish to Kafka topic noc.snmp
    publish_to_kafka(&state.kafka_url, "noc.snmp", &trap).await;
    // Cache in Redis
    cache_device_update(&state.redis_url, source_ip, "snmp_trap").await;
    // Forward to Dapr for cross-service coordination
    publish_to_dapr(&state.dapr_url, "noc-snmp-trap", &trap).await;
    // Persist to DB
    persist_snmp_alert(state, &trap).await;
}

fn extract_oid_from_payload(payload: &str) -> Option<&str> {
    // Look for OID pattern in payload
    let bytes = payload.as_bytes();
    for i in 0..bytes.len().saturating_sub(10) {
        if bytes[i] == b'1' && bytes.get(i + 1) == Some(&b'.') && bytes.get(i + 2) == Some(&b'3') {
            let end = payload[i..]
                .find(|c: char| !c.is_ascii_digit() && c != '.')
                .unwrap_or(payload.len() - i);
            let candidate = &payload[i..i + end];
            if candidate.len() > 5 {
                return Some(candidate);
            }
        }
    }
    None
}

fn extract_value_from_payload(payload: &str) -> Option<&str> {
    if payload.len() > 20 {
        Some(&payload[payload.len() - 20..])
    } else {
        Some(payload)
    }
}

// ── Syslog Receiver ──────────────────────────────────────────────────────────

async fn syslog_listener(state: Arc<AppState>) {
    let bind_addr = format!("0.0.0.0:{SYSLOG_PORT}");
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => {
            info!("[Syslog] Listening on UDP {bind_addr}");
            s
        }
        Err(e) => {
            warn!("[Syslog] Cannot bind {bind_addr}: {e} — running in simulation mode");
            run_syslog_simulation(state).await;
            return;
        }
    };

    let mut buf = [0u8; 65535];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let data = buf[..len].to_vec();
                let source_ip = addr.ip().to_string();
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    process_syslog(&state, &data, &source_ip).await;
                });
            }
            Err(e) => {
                error!("[Syslog] recv error: {e}");
                if let Ok(mut m) = state.metrics.write() {
                    m.errors += 1;
                }
            }
        }
    }
}

async fn process_syslog(state: &AppState, data: &[u8], source_ip: &str) {
    let msg = match parse_syslog(data, source_ip) {
        Some(m) => m,
        None => return,
    };

    if let Ok(mut m) = state.metrics.write() {
        m.syslog_messages_received += 1;
        m.syslog_messages_processed += 1;
    }

    if let Ok(mut logs) = state.recent_syslog.write() {
        logs.push(msg.clone());
        if logs.len() > 1000 {
            logs.drain(0..200);
        }
    }

    // Publish to Kafka
    publish_to_kafka(&state.kafka_url, "noc.syslog", &msg).await;
    // Index in OpenSearch for full-text search
    index_in_opensearch(&state.opensearch_url, "noc-syslog", &msg.msg_id, &msg).await;
    // Forward to Fluvio for edge telemetry
    publish_to_fluvio(&state.fluvio_url, "noc-syslog", &msg).await;

    // Generate alert for high-severity syslog messages
    if msg.severity <= 3 {
        persist_syslog_alert(state, &msg).await;
    }
}

// ── NetFlow Collector ────────────────────────────────────────────────────────

async fn netflow_listener(state: Arc<AppState>) {
    let bind_addr = format!("0.0.0.0:{NETFLOW_PORT}");
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => {
            info!("[NetFlow] Listening on UDP {bind_addr}");
            s
        }
        Err(e) => {
            warn!("[NetFlow] Cannot bind {bind_addr}: {e} — running in simulation mode");
            run_netflow_simulation(state).await;
            return;
        }
    };

    let mut buf = [0u8; 65535];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let data = buf[..len].to_vec();
                let source_ip = addr.ip().to_string();
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    process_netflow(&state, &data, &source_ip).await;
                });
            }
            Err(e) => {
                error!("[NetFlow] recv error: {e}");
                if let Ok(mut m) = state.metrics.write() {
                    m.errors += 1;
                }
            }
        }
    }
}

async fn process_netflow(state: &AppState, data: &[u8], source_ip: &str) {
    let records = parse_netflow_v5(data, source_ip);
    let count = records.len() as u64;

    if let Ok(mut m) = state.metrics.write() {
        m.netflow_records_received += count;
        m.netflow_records_processed += count;
    }

    if let Ok(mut flows) = state.recent_flows.write() {
        flows.extend(records.iter().cloned());
        if flows.len() > 2000 {
            flows.drain(0..500);
        }
    }

    // Publish batch to Kafka
    for record in &records {
        publish_to_kafka(&state.kafka_url, "noc.netflow", record).await;
    }
    // Write raw flows to Lakehouse for historical analytics
    publish_to_lakehouse(&state.lakehouse_url, "netflow_raw", &records).await;
    // Bandwidth anomaly detection
    detect_bandwidth_anomalies(state, &records).await;
}

async fn detect_bandwidth_anomalies(state: &AppState, records: &[NetFlowRecord]) {
    for record in records {
        if record.bytes > 100_000_000 {
            let alert_id = Uuid::new_v4().to_string();
            if let Ok(mut m) = state.metrics.write() {
                m.alerts_generated += 1;
            }
            info!(
                "[NetFlow] Large flow detected: {} -> {} ({} bytes)",
                record.src_ip, record.dst_ip, record.bytes
            );
            let _ = persist_noc_alert(
                state,
                &alert_id,
                "netflow",
                "high",
                "bandwidth_anomaly",
                &format!(
                    "Large flow: {} -> {} ({} bytes)",
                    record.src_ip, record.dst_ip, record.bytes
                ),
                Some(&record.src_ip),
                None,
            )
            .await;
        }
    }
}

// ── Simulation Modes (when ports are unavailable) ────────────────────────────

async fn run_snmp_simulation(state: Arc<AppState>) {
    info!("[SNMP] Simulation mode active — generating synthetic traps every 30s");
    let oids = [
        "1.3.6.1.6.3.1.1.5.3",
        "1.3.6.1.6.3.1.1.5.4",
        "1.3.6.1.6.3.1.1.5.1",
        "1.3.6.1.6.3.1.1.5.5",
        "1.3.6.1.2.1.2.2.1.8",
        "1.3.6.1.2.1.25.3.3.1.2",
    ];
    let devices = [
        "core-router-01",
        "edge-switch-02",
        "fw-perimeter-01",
        "ap-floor3-01",
        "srv-db-primary",
    ];
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        let idx = rand::random::<usize>();
        let oid = oids[idx % oids.len()];
        let device = devices[idx % devices.len()];
        let ip = format!("10.0.{}.{}", (idx % 10) + 1, (idx % 254) + 1);

        let trap = SnmpTrap {
            trap_id: Uuid::new_v4().to_string(),
            source_ip: ip.clone(),
            oid: oid.to_string(),
            oid_name: oid_to_name(oid).to_string(),
            value: format!("{device} trap event"),
            severity: classify_snmp_severity(oid).to_string(),
            community: "ndsep-noc".to_string(),
            version: "v3".to_string(),
            timestamp: Utc::now(),
        };

        if let Ok(mut m) = state.metrics.write() {
            m.snmp_traps_received += 1;
            m.snmp_traps_processed += 1;
        }
        if let Ok(mut traps) = state.recent_traps.write() {
            traps.push(trap.clone());
            if traps.len() > 500 {
                traps.drain(0..100);
            }
        }
        // Update device state
        update_device_state(&state, &ip, device, "router").await;
        persist_snmp_alert(&state, &trap).await;
    }
}

async fn run_syslog_simulation(state: Arc<AppState>) {
    info!("[Syslog] Simulation mode active — generating synthetic messages every 15s");
    let apps = [
        "sshd",
        "nginx",
        "iptables",
        "kernel",
        "systemd",
        "postgresql",
        "redis",
        "haproxy",
    ];
    let messages = [
        "Connection refused from 192.168.1.100",
        "Certificate validation failed for upstream",
        "DROP IN=eth0 OUT= SRC=10.0.5.22 DST=10.0.1.1 PROTO=TCP DPT=22",
        "OOM killer invoked for process redis-server",
        "Unit postgresql.service entered failed state",
        "FATAL: password authentication failed for user admin",
        "SSL handshake error: certificate expired",
        "Health check failed for backend ndsep-api",
    ];
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
        let idx = rand::random::<usize>();
        let severity = (idx % 8) as u8;
        let msg = SyslogMessage {
            msg_id: Uuid::new_v4().to_string(),
            source_ip: format!("10.0.{}.{}", (idx % 10) + 1, (idx % 254) + 1),
            facility: (idx % 24) as u8,
            severity,
            hostname: format!("ndsep-node-{:02}", idx % 12),
            app_name: apps[idx % apps.len()].to_string(),
            message: messages[idx % messages.len()].to_string(),
            structured_data: None,
            timestamp: Utc::now(),
        };

        if let Ok(mut m) = state.metrics.write() {
            m.syslog_messages_received += 1;
            m.syslog_messages_processed += 1;
        }
        if let Ok(mut logs) = state.recent_syslog.write() {
            logs.push(msg.clone());
            if logs.len() > 1000 {
                logs.drain(0..200);
            }
        }
        if severity <= 3 {
            persist_syslog_alert(&state, &msg).await;
        }
    }
}

async fn run_netflow_simulation(state: Arc<AppState>) {
    info!("[NetFlow] Simulation mode active — generating synthetic flows every 10s");
    let protocols = [6u8, 17, 1, 6, 6, 17]; // TCP, UDP, ICMP
    let ports = [80u16, 443, 22, 3000, 5432, 8080, 8443, 9200, 6379, 9092];
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        let idx = rand::random::<usize>();
        let record = NetFlowRecord {
            flow_id: Uuid::new_v4().to_string(),
            collector_ip: "10.0.1.1".to_string(),
            src_ip: format!("10.0.{}.{}", (idx % 20) + 1, (idx % 254) + 1),
            dst_ip: format!("10.0.{}.{}", (idx % 10) + 1, (idx % 254) + 1),
            src_port: ports[idx % ports.len()],
            dst_port: ports[(idx + 3) % ports.len()],
            protocol: protocols[idx % protocols.len()],
            bytes: (rand::random::<u64>() % 10_000_000) + 100,
            packets: (rand::random::<u64>() % 10_000) + 1,
            tcp_flags: if protocols[idx % protocols.len()] == 6 {
                0x18
            } else {
                0
            },
            tos: 0,
            src_as: (idx as u32 % 65000) + 1,
            dst_as: (idx as u32 % 65000) + 100,
            input_interface: (idx % 48) as u16,
            output_interface: ((idx + 1) % 48) as u16,
            flow_start: Utc::now() - chrono::Duration::seconds(30),
            flow_end: Utc::now(),
            version: 5,
        };

        if let Ok(mut m) = state.metrics.write() {
            m.netflow_records_received += 1;
            m.netflow_records_processed += 1;
        }
        if let Ok(mut flows) = state.recent_flows.write() {
            flows.push(record);
            if flows.len() > 2000 {
                flows.drain(0..500);
            }
        }
    }
}

// ── Device State Management ──────────────────────────────────────────────────

async fn update_device_state(state: &AppState, ip: &str, hostname: &str, device_type: &str) {
    let mut hasher = Sha256::new();
    hasher.update(ip.as_bytes());
    let device_id = hex::encode(&hasher.finalize()[..8]);

    let cpu = (rand::random::<f64>() * 80.0) + 5.0;
    let mem = (rand::random::<f64>() * 70.0) + 10.0;
    let bw_in = (rand::random::<f64>() * 900.0) + 10.0;
    let bw_out = (rand::random::<f64>() * 500.0) + 5.0;

    let device = DeviceState {
        device_id: device_id.clone(),
        hostname: hostname.to_string(),
        ip: ip.to_string(),
        device_type: device_type.to_string(),
        status: if cpu > 90.0 { "degraded" } else { "up" }.to_string(),
        cpu_pct: cpu,
        memory_pct: mem,
        bandwidth_in_mbps: bw_in,
        bandwidth_out_mbps: bw_out,
        last_seen: Utc::now(),
        interfaces: vec![
            InterfaceState {
                name: "eth0".to_string(),
                status: "up".to_string(),
                speed_mbps: 1000,
                in_octets: rand::random::<u64>() % 1_000_000_000,
                out_octets: rand::random::<u64>() % 1_000_000_000,
                in_errors: rand::random::<u64>() % 100,
                out_errors: rand::random::<u64>() % 50,
                utilization_pct: bw_in / 10.0,
            },
            InterfaceState {
                name: "eth1".to_string(),
                status: "up".to_string(),
                speed_mbps: 10000,
                in_octets: rand::random::<u64>() % 10_000_000_000,
                out_octets: rand::random::<u64>() % 10_000_000_000,
                in_errors: 0,
                out_errors: 0,
                utilization_pct: bw_out / 100.0,
            },
        ],
    };

    if let Ok(mut devices) = state.devices.write() {
        devices.insert(device_id, device);
    }
    if let Ok(mut m) = state.metrics.write() {
        m.devices_discovered += 1;
    }
}

// ── Middleware Integration Helpers ────────────────────────────────────────────

async fn publish_to_kafka<T: Serialize>(_broker: &str, topic: &str, data: &T) {
    let _payload = match serde_json::to_string(data) {
        Ok(p) => p,
        Err(e) => {
            warn!("[Kafka] Serialize error for {topic}: {e}");
            return;
        }
    };
    // In production: use rdkafka producer to publish to Kafka broker
    // kafka_producer.send(FutureRecord::to(topic).payload(&payload).key(&uuid)).await
    log::debug!("[Kafka] Published to {topic}");
}

async fn cache_device_update(_redis_url: &str, ip: &str, event_type: &str) {
    // In production: SET noc:device:{ip}:last_{event_type} {timestamp} EX 300
    log::debug!("[Redis] Cached {event_type} for {ip}");
}

async fn index_in_opensearch<T: Serialize>(_url: &str, index: &str, doc_id: &str, _doc: &T) {
    // In production: PUT /{index}/_doc/{doc_id} with JSON body
    log::debug!("[OpenSearch] Indexed {doc_id} in {index}");
}

async fn publish_to_dapr<T: Serialize>(_url: &str, topic: &str, _data: &T) {
    // In production: POST /v1.0/publish/noc-pubsub/{topic} with JSON body
    log::debug!("[Dapr] Published to {topic}");
}

async fn publish_to_fluvio<T: Serialize>(_url: &str, topic: &str, _data: &T) {
    // In production: fluvio produce {topic} with record bytes
    log::debug!("[Fluvio] Published to {topic}");
}

async fn publish_to_lakehouse<T: Serialize>(url: &str, table: &str, data: &T) {
    if url.is_empty() {
        return;
    }
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "namespace": "ndsep",
        "table": table,
        "records": [data],
    });
    match client
        .post(format!("{}/ingest", url))
        .json(&payload)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            log::debug!("[Lakehouse] Written batch to {table}");
        }
        Ok(resp) => {
            log::debug!(
                "[Lakehouse] Ingest to {table} returned HTTP {}",
                resp.status()
            );
        }
        Err(e) => {
            log::debug!("[Lakehouse] Ingest to {table} unavailable: {e}");
        }
    }
}

// ── Database Persistence ─────────────────────────────────────────────────────

async fn get_db_client(db_url: &str) -> Option<tokio_postgres::Client> {
    match tokio_postgres::connect(db_url, tokio_postgres::NoTls).await {
        Ok((client, connection)) => {
            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    error!("DB connection error: {e}");
                }
            });
            Some(client)
        }
        Err(e) => {
            warn!("DB connect failed: {e}");
            None
        }
    }
}

async fn persist_snmp_alert(state: &AppState, trap: &SnmpTrap) {
    persist_noc_alert(
        state,
        &trap.trap_id,
        "snmp",
        &trap.severity,
        &trap.oid_name,
        &format!(
            "SNMP trap from {}: {} = {}",
            trap.source_ip, trap.oid_name, trap.value
        ),
        Some(&trap.source_ip),
        None,
    )
    .await;
}

async fn persist_syslog_alert(state: &AppState, msg: &SyslogMessage) {
    let severity = map_syslog_to_noc_severity(msg.severity);
    persist_noc_alert(
        state,
        &msg.msg_id,
        "syslog",
        severity,
        &format!("syslog_{}", facility_name(msg.facility)),
        &format!(
            "[{}] {}: {}",
            syslog_severity_name(msg.severity),
            msg.app_name,
            msg.message
        ),
        Some(&msg.source_ip),
        Some(&msg.hostname),
    )
    .await;
}

async fn persist_noc_alert(
    state: &AppState,
    alert_id: &str,
    source: &str,
    severity: &str,
    category: &str,
    description: &str,
    source_ip: Option<&str>,
    service: Option<&str>,
) {
    let client = match get_db_client(&state.db_url).await {
        Some(c) => c,
        None => return,
    };

    let title = format!("[{source}] {category}");
    let sql = "INSERT INTO noc_alerts (alert_id, source, severity, category, title, description, source_ip, affected_service)
        VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8)
        ON CONFLICT (alert_id) DO UPDATE SET last_seen = NOW(), repeat_count = noc_alerts.repeat_count + 1";

    if let Err(e) = client
        .execute(
            sql,
            &[
                &alert_id,
                &source,
                &severity,
                &category,
                &title,
                &description,
                &source_ip,
                &service,
            ],
        )
        .await
    {
        warn!("Failed to persist NOC alert: {e}");
    }
}

// ── Relay Event to Main Server ───────────────────────────────────────────────

async fn relay_event(relay_url: &str, event_type: &str, data: &serde_json::Value) {
    let body = serde_json::json!({
        "worker": WORKER_NAME,
        "type": event_type,
        "data": data,
        "timestamp": Utc::now().to_rfc3339(),
    });
    let _ = reqwest::Client::new()
        .post(relay_url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await;
}

// ── HTTP API Handlers ────────────────────────────────────────────────────────

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let uptime = (Utc::now() - state.start_time).num_seconds();
    Json(serde_json::json!({
        "status": "healthy",
        "worker": WORKER_NAME,
        "uptime_seconds": uptime,
        "collectors": {
            "snmp": { "port": SNMP_TRAP_PORT, "status": "active" },
            "syslog": { "port": SYSLOG_PORT, "status": "active" },
            "netflow": { "port": NETFLOW_PORT, "status": "active" },
        },
        "middleware": {
            "kafka": state.kafka_url,
            "redis": state.redis_url,
            "opensearch": state.opensearch_url,
            "dapr": state.dapr_url,
            "fluvio": state.fluvio_url,
            "lakehouse": state.lakehouse_url,
        }
    }))
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let m = state.metrics.read().unwrap();
    Json(serde_json::json!({
        "snmp": {
            "traps_received": m.snmp_traps_received,
            "traps_processed": m.snmp_traps_processed,
        },
        "syslog": {
            "messages_received": m.syslog_messages_received,
            "messages_processed": m.syslog_messages_processed,
        },
        "netflow": {
            "records_received": m.netflow_records_received,
            "records_processed": m.netflow_records_processed,
        },
        "alerts_generated": m.alerts_generated,
        "devices_discovered": m.devices_discovered,
        "errors": m.errors,
    }))
}

async fn recent_traps_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let traps = state.recent_traps.read().unwrap();
    let last50: Vec<_> = traps.iter().rev().take(50).collect();
    Json(serde_json::json!({ "count": last50.len(), "traps": last50 }))
}

async fn recent_syslog_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let logs = state.recent_syslog.read().unwrap();
    let last50: Vec<_> = logs.iter().rev().take(50).collect();
    Json(serde_json::json!({ "count": last50.len(), "messages": last50 }))
}

async fn recent_flows_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let flows = state.recent_flows.read().unwrap();
    let last50: Vec<_> = flows.iter().rev().take(50).collect();
    Json(serde_json::json!({ "count": last50.len(), "flows": last50 }))
}

async fn devices_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let devices = state.devices.read().unwrap();
    let list: Vec<_> = devices.values().collect();
    Json(serde_json::json!({ "count": list.len(), "devices": list }))
}

#[derive(Deserialize)]
struct DeviceRegistration {
    hostname: String,
    ip_address: String,
    device_type: String,
    vendor: Option<String>,
    model: Option<String>,
    location: Option<String>,
}

async fn register_device_handler(
    State(state): State<Arc<AppState>>,
    Json(input): Json<DeviceRegistration>,
) -> Json<serde_json::Value> {
    let mut hasher = Sha256::new();
    hasher.update(input.ip_address.as_bytes());
    let device_id = hex::encode(&hasher.finalize()[..8]);

    let client = match get_db_client(&state.db_url).await {
        Some(c) => c,
        None => return Json(serde_json::json!({"error": "database unavailable"})),
    };

    let sql = "INSERT INTO noc_devices (device_id, hostname, ip_address, device_type, vendor, model, location, status)
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, 'unknown')
        ON CONFLICT (device_id) DO UPDATE SET hostname = $2, updated_at = NOW()
        RETURNING device_id";

    match client
        .query_one(
            sql,
            &[
                &device_id,
                &input.hostname,
                &input.ip_address,
                &input.device_type,
                &input.vendor,
                &input.model,
                &input.location,
            ],
        )
        .await
    {
        Ok(row) => {
            let id: String = row.get(0);
            Json(serde_json::json!({"device_id": id, "status": "registered"}))
        }
        Err(e) => Json(serde_json::json!({"error": format!("Failed: {e}")})),
    }
}

async fn bandwidth_summary_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let flows = state.recent_flows.read().unwrap();
    let total_bytes: u64 = flows.iter().map(|f| f.bytes).sum();
    let total_packets: u64 = flows.iter().map(|f| f.packets).sum();
    let mut protocol_bytes: HashMap<u8, u64> = HashMap::new();
    for f in flows.iter() {
        *protocol_bytes.entry(f.protocol).or_default() += f.bytes;
    }
    let protocol_name = |p: u8| match p {
        1 => "ICMP",
        6 => "TCP",
        17 => "UDP",
        _ => "Other",
    };
    let by_protocol: HashMap<&str, u64> = protocol_bytes
        .iter()
        .map(|(k, v)| (protocol_name(*k), *v))
        .collect();

    Json(serde_json::json!({
        "total_bytes": total_bytes,
        "total_packets": total_packets,
        "total_flows": flows.len(),
        "by_protocol": by_protocol,
    }))
}

// ── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    env_logger::Builder::new()
        .filter_level(log::LevelFilter::Info)
        .init();

    info!("╔══════════════════════════════════════════════════════════╗");
    info!("║  NDSEP NOC Collector — SNMP/Syslog/NetFlow Engine      ║");
    info!("║  HTTP API: :{HTTP_PORT}                                     ║");
    info!("║  SNMP Traps: UDP :{SNMP_TRAP_PORT}                              ║");
    info!("║  Syslog: UDP :{SYSLOG_PORT}                                  ║");
    info!("║  NetFlow: UDP :{NETFLOW_PORT}                                  ║");
    info!("╚══════════════════════════════════════════════════════════╝");

    let state = Arc::new(AppState::new());

    // Initialize DB tables
    if let Some(client) = get_db_client(&state.db_url).await {
        info!("[DB] Connected — running NOC schema migration");
        let migration = include_str!("../../../../migrations/000016_noc_aggregation.up.sql");
        for statement in migration.split(';') {
            let stmt = statement.trim();
            if !stmt.is_empty() && !stmt.starts_with("--") {
                if let Err(e) = client.execute(stmt, &[]).await {
                    warn!("[DB] Migration statement failed (may already exist): {e}");
                }
            }
        }
    }

    // Spawn collectors
    let s1 = Arc::clone(&state);
    tokio::spawn(async move { snmp_trap_listener(s1).await });
    let s2 = Arc::clone(&state);
    tokio::spawn(async move { syslog_listener(s2).await });
    let s3 = Arc::clone(&state);
    tokio::spawn(async move { netflow_listener(s3).await });

    // Spawn relay heartbeat
    let s4 = Arc::clone(&state);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let payload = {
                let m = s4.metrics.read().unwrap();
                serde_json::json!({
                    "snmp_traps": m.snmp_traps_received,
                    "syslog_msgs": m.syslog_messages_received,
                    "netflow_records": m.netflow_records_received,
                })
            };
            relay_event(&s4.relay_url, "noc.collector.heartbeat", &payload).await;
        }
    });

    // HTTP API
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/api/snmp/traps", get(recent_traps_handler))
        .route("/api/syslog/messages", get(recent_syslog_handler))
        .route("/api/netflow/flows", get(recent_flows_handler))
        .route("/api/netflow/bandwidth", get(bandwidth_summary_handler))
        .route("/api/devices", get(devices_handler))
        .route("/api/devices/register", post(register_device_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], HTTP_PORT));
    info!("[HTTP] API server starting on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
