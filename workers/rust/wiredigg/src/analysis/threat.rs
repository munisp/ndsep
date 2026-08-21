use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use aho_corasick::AhoCorasick;
use chrono::Utc;
use dashmap::DashMap;
use parking_lot::RwLock;
use uuid::Uuid;

use crate::models::packet::{CapturedPacket, Protocol, ThreatSeverity};
use crate::models::threat::{ThreatEvent, ThreatType};

/// Compiled rule-based threat classifier with Aho-Corasick pattern matching.
#[derive(Clone)]
pub struct ThreatClassifier {
    // Connection tracking per source IP
    syn_counts: Arc<DashMap<IpAddr, SynTracker>>,
    port_scan_tracker: Arc<DashMap<IpAddr, PortScanTracker>>,
    dns_query_tracker: Arc<DashMap<IpAddr, DnsTracker>>,
    arp_cache: Arc<DashMap<IpAddr, String>>,
    beacon_tracker: Arc<DashMap<IpAddr, BeaconTracker>>,

    // Threat intelligence
    malicious_ips: Arc<RwLock<Vec<IpAddr>>>,
    malicious_domains: Arc<RwLock<Vec<String>>>,
    payload_patterns: Arc<AhoCorasick>,

    // Results
    pub threats: Arc<RwLock<Vec<ThreatEvent>>>,
    threat_count: Arc<AtomicU64>,

    // Thresholds
    pub syn_flood_threshold: u32,
    pub port_scan_threshold: u32,
    pub dns_exfil_length_threshold: usize,
    pub beacon_regularity_threshold: f64,
}

#[derive(Debug, Clone)]
struct SynTracker {
    count: u32,
    window_start: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct PortScanTracker {
    ports: Vec<u16>,
    window_start: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct DnsTracker {
    queries: Vec<String>,
    total_query_bytes: usize,
}

#[derive(Debug, Clone)]
struct BeaconTracker {
    intervals: Vec<f64>,
    last_seen: chrono::DateTime<Utc>,
}

impl ThreatClassifier {
    pub fn new() -> Self {
        // Compile suspicious payload patterns
        let patterns: Vec<&str> = vec![
            // Shell commands
            "/bin/sh",
            "/bin/bash",
            "cmd.exe",
            "powershell",
            // SQL injection
            "' OR '1'='1",
            "UNION SELECT",
            "DROP TABLE",
            "'; DROP",
            // XSS
            "<script>",
            "javascript:",
            "onerror=",
            "onload=",
            // Directory traversal
            "../../../",
            "..\\..\\",
            "/etc/passwd",
            "/etc/shadow",
            // C2 beacons
            "Mozilla/4.0 (compatible; MSIE 6.0;",
            // Crypto mining
            "stratum+tcp://",
            "mining.pool",
            // Ransomware markers
            ".encrypted",
            "DECRYPT_INSTRUCTIONS",
            "YOUR_FILES_ARE",
        ];

        let ac = AhoCorasick::builder()
            .ascii_case_insensitive(true)
            .build(&patterns)
            .expect("Failed to build Aho-Corasick automaton");

        Self {
            syn_counts: Arc::new(DashMap::new()),
            port_scan_tracker: Arc::new(DashMap::new()),
            dns_query_tracker: Arc::new(DashMap::new()),
            arp_cache: Arc::new(DashMap::new()),
            beacon_tracker: Arc::new(DashMap::new()),
            malicious_ips: Arc::new(RwLock::new(Vec::new())),
            malicious_domains: Arc::new(RwLock::new(Vec::new())),
            payload_patterns: Arc::new(ac),
            threats: Arc::new(RwLock::new(Vec::new())),
            threat_count: Arc::new(AtomicU64::new(0)),
            syn_flood_threshold: 100,
            port_scan_threshold: 20,
            dns_exfil_length_threshold: 50,
            beacon_regularity_threshold: 0.85,
        }
    }

    pub fn classify(&self, packet: &CapturedPacket) -> Vec<ThreatEvent> {
        let mut threats = Vec::new();

        // 1. SYN flood detection
        if let Some(threat) = self.check_syn_flood(packet) {
            threats.push(threat);
        }

        // 2. Port scan detection
        if let Some(threat) = self.check_port_scan(packet) {
            threats.push(threat);
        }

        // 3. DNS exfiltration
        if let Some(threat) = self.check_dns_exfiltration(packet) {
            threats.push(threat);
        }

        // 4. ARP spoofing
        if let Some(threat) = self.check_arp_spoofing(packet) {
            threats.push(threat);
        }

        // 5. Payload pattern matching
        if let Some(threat) = self.check_payload_patterns(packet) {
            threats.push(threat);
        }

        // 6. Beacon detection
        if let Some(threat) = self.check_beacon_pattern(packet) {
            threats.push(threat);
        }

        // 7. Known malicious IPs
        if let Some(threat) = self.check_malicious_ip(packet) {
            threats.push(threat);
        }

        // 8. DNS rebinding
        if let Some(threat) = self.check_dns_rebinding(packet) {
            threats.push(threat);
        }

        // 9. TLS anomalies
        if let Some(threat) = self.check_tls_anomaly(packet) {
            threats.push(threat);
        }

        // 10. Unencrypted PII detection (NDPA compliance)
        if let Some(threat) = self.check_unencrypted_pii(packet) {
            threats.push(threat);
        }

        // Store threats
        if !threats.is_empty() {
            let mut all = self.threats.write();
            for t in &threats {
                all.push(t.clone());
                self.threat_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        threats
    }

    fn check_syn_flood(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let flags = packet.flags?;
        if !flags.syn || flags.ack {
            return None;
        }
        let src = packet.src_ip?;
        let now = Utc::now();

        let mut entry = self.syn_counts.entry(src).or_insert(SynTracker {
            count: 0,
            window_start: now,
        });

        let elapsed = (now - entry.window_start).num_seconds();
        if elapsed > 10 {
            entry.count = 1;
            entry.window_start = now;
            return None;
        }

        entry.count += 1;
        if entry.count >= self.syn_flood_threshold {
            entry.count = 0;
            let (tactic, technique) = ThreatType::SynFlood.mitre_mapping();
            return Some(ThreatEvent {
                id: Uuid::new_v4().to_string(),
                timestamp: now,
                threat_type: ThreatType::SynFlood,
                severity: ThreatSeverity::High,
                source_ip: Some(src),
                destination_ip: packet.dst_ip,
                source_port: packet.src_port,
                destination_port: packet.dst_port,
                protocol: packet.protocol.name().to_string(),
                description: format!(
                    "SYN flood detected: {} SYN packets in {}s from {}",
                    self.syn_flood_threshold, elapsed, src
                ),
                evidence: vec![format!(
                    "{} SYN packets in window",
                    self.syn_flood_threshold
                )],
                recommendation: "Rate-limit or block source IP. Enable SYN cookies.".into(),
                confidence: 0.85,
                packet_ids: vec![packet.id],
                mitre_tactic: Some(tactic.into()),
                mitre_technique: Some(technique.into()),
            });
        }
        None
    }

    fn check_port_scan(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let flags = packet.flags?;
        if !flags.syn || flags.ack {
            return None;
        }
        let src = packet.src_ip?;
        let dport = packet.dst_port?;
        let now = Utc::now();

        let mut entry = self
            .port_scan_tracker
            .entry(src)
            .or_insert(PortScanTracker {
                ports: Vec::new(),
                window_start: now,
            });

        let elapsed = (now - entry.window_start).num_seconds();
        if elapsed > 60 {
            entry.ports.clear();
            entry.window_start = now;
        }

        if !entry.ports.contains(&dport) {
            entry.ports.push(dport);
        }

        if entry.ports.len() >= self.port_scan_threshold as usize {
            let ports = entry.ports.clone();
            entry.ports.clear();
            let (tactic, technique) = ThreatType::PortScan.mitre_mapping();
            return Some(ThreatEvent {
                id: Uuid::new_v4().to_string(),
                timestamp: now,
                threat_type: ThreatType::PortScan,
                severity: ThreatSeverity::Medium,
                source_ip: Some(src),
                destination_ip: packet.dst_ip,
                source_port: packet.src_port,
                destination_port: packet.dst_port,
                protocol: "TCP".into(),
                description: format!(
                    "Port scan detected: {} unique ports probed from {}",
                    ports.len(),
                    src
                ),
                evidence: vec![format!("Ports: {:?}", &ports[..ports.len().min(10)])],
                recommendation: "Investigate source. Consider firewall rules to block scanning."
                    .into(),
                confidence: 0.75,
                packet_ids: vec![packet.id],
                mitre_tactic: Some(tactic.into()),
                mitre_technique: Some(technique.into()),
            });
        }
        None
    }

    fn check_dns_exfiltration(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let query = packet.dns_query.as_ref()?;
        let src = packet.src_ip?;

        // Indicators of DNS exfiltration:
        // 1. Very long subdomain labels
        // 2. High entropy in labels
        // 3. Unusual TLD
        let labels: Vec<&str> = query.split('.').collect();
        let max_label_len = labels.iter().map(|l| l.len()).max().unwrap_or(0);

        if max_label_len > self.dns_exfil_length_threshold {
            let mut entry = self.dns_query_tracker.entry(src).or_insert(DnsTracker {
                queries: Vec::new(),
                total_query_bytes: 0,
            });
            entry.queries.push(query.clone());
            entry.total_query_bytes += query.len();

            if entry.queries.len() >= 5 {
                let (tactic, technique) = ThreatType::DnsExfiltration.mitre_mapping();
                return Some(ThreatEvent {
                    id: Uuid::new_v4().to_string(),
                    timestamp: Utc::now(),
                    threat_type: ThreatType::DnsExfiltration,
                    severity: ThreatSeverity::High,
                    source_ip: Some(src),
                    destination_ip: packet.dst_ip,
                    source_port: packet.src_port,
                    destination_port: packet.dst_port,
                    protocol: "DNS".into(),
                    description: format!(
                        "DNS exfiltration suspected: {} queries with long labels (max {}chars) from {}",
                        entry.queries.len(), max_label_len, src
                    ),
                    evidence: vec![
                        format!("Total bytes in queries: {}", entry.total_query_bytes),
                        format!("Sample: {}", query),
                    ],
                    recommendation:
                        "Block DNS to suspicious domains. Monitor for data leakage via DNS tunneling."
                            .into(),
                    confidence: 0.7,
                    packet_ids: vec![packet.id],
                    mitre_tactic: Some(tactic.into()),
                    mitre_technique: Some(technique.into()),
                });
            }
        }
        None
    }

    fn check_arp_spoofing(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        if packet.protocol != Protocol::Arp {
            return None;
        }
        let src_ip = packet.src_ip?;
        let src_mac = packet.eth_src.as_ref()?;

        if let Some(existing_mac) = self.arp_cache.get(&src_ip) {
            if existing_mac.value() != src_mac {
                let old_mac = existing_mac.value().clone();
                drop(existing_mac);
                self.arp_cache.insert(src_ip, src_mac.clone());
                let (tactic, technique) = ThreatType::ArpSpoofing.mitre_mapping();
                return Some(ThreatEvent {
                    id: Uuid::new_v4().to_string(),
                    timestamp: Utc::now(),
                    threat_type: ThreatType::ArpSpoofing,
                    severity: ThreatSeverity::High,
                    source_ip: Some(src_ip),
                    destination_ip: packet.dst_ip,
                    source_port: None,
                    destination_port: None,
                    protocol: "ARP".into(),
                    description: format!(
                        "ARP spoofing detected: IP {} changed MAC from {} to {}",
                        src_ip, old_mac, src_mac
                    ),
                    evidence: vec![
                        format!("Previous MAC: {}", old_mac),
                        format!("New MAC: {}", src_mac),
                    ],
                    recommendation:
                        "Enable Dynamic ARP Inspection (DAI). Use static ARP entries for critical hosts."
                            .into(),
                    confidence: 0.9,
                    packet_ids: vec![packet.id],
                    mitre_tactic: Some(tactic.into()),
                    mitre_technique: Some(technique.into()),
                });
            }
        } else {
            self.arp_cache.insert(src_ip, src_mac.clone());
        }
        None
    }

    fn check_payload_patterns(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let preview = packet.payload_preview.as_ref()?;
        let matches: Vec<_> = self.payload_patterns.find_iter(preview).collect();
        if matches.is_empty() {
            return None;
        }

        let matched_patterns: Vec<String> = matches
            .iter()
            .map(|m| preview[m.start()..m.end()].to_string())
            .collect();

        let (threat_type, severity) = categorize_payload_match(&matched_patterns);
        let (tactic, technique) = threat_type.mitre_mapping();

        Some(ThreatEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            threat_type,
            severity,
            source_ip: packet.src_ip,
            destination_ip: packet.dst_ip,
            source_port: packet.src_port,
            destination_port: packet.dst_port,
            protocol: packet.protocol.name().to_string(),
            description: format!(
                "Suspicious payload detected: {} pattern(s) matched",
                matched_patterns.len()
            ),
            evidence: matched_patterns,
            recommendation: "Investigate source and destination. Block if confirmed malicious."
                .into(),
            confidence: 0.8,
            packet_ids: vec![packet.id],
            mitre_tactic: Some(tactic.into()),
            mitre_technique: Some(technique.into()),
        })
    }

    fn check_beacon_pattern(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let src = packet.src_ip?;
        let dst = packet.dst_ip?;
        let now = Utc::now();

        let key = src;
        let mut entry = self.beacon_tracker.entry(key).or_insert(BeaconTracker {
            intervals: Vec::new(),
            last_seen: now,
        });

        let interval = (now - entry.last_seen).num_milliseconds() as f64 / 1000.0;
        entry.last_seen = now;

        if interval > 0.1 && interval < 3600.0 {
            entry.intervals.push(interval);
        }

        if entry.intervals.len() >= 10 {
            let mean = entry.intervals.iter().sum::<f64>() / entry.intervals.len() as f64;
            let variance = entry
                .intervals
                .iter()
                .map(|&x| (x - mean).powi(2))
                .sum::<f64>()
                / entry.intervals.len() as f64;
            let cv = variance.sqrt() / mean;
            let regularity = 1.0 - cv.min(1.0);

            if regularity > self.beacon_regularity_threshold {
                entry.intervals.clear();
                let (tactic, technique) = ThreatType::BeaconPattern.mitre_mapping();
                return Some(ThreatEvent {
                    id: Uuid::new_v4().to_string(),
                    timestamp: now,
                    threat_type: ThreatType::BeaconPattern,
                    severity: ThreatSeverity::Medium,
                    source_ip: Some(src),
                    destination_ip: Some(dst),
                    source_port: packet.src_port,
                    destination_port: packet.dst_port,
                    protocol: packet.protocol.name().to_string(),
                    description: format!(
                        "Beacon-like pattern detected: {:.1}s avg interval, {:.0}% regularity from {} → {}",
                        mean, regularity * 100.0, src, dst
                    ),
                    evidence: vec![
                        format!("Mean interval: {:.2}s", mean),
                        format!("Regularity: {:.1}%", regularity * 100.0),
                    ],
                    recommendation: "Investigate for C2 communication. Check destination reputation."
                        .into(),
                    confidence: regularity * 0.9,
                    packet_ids: vec![packet.id],
                    mitre_tactic: Some(tactic.into()),
                    mitre_technique: Some(technique.into()),
                });
            }
        }
        None
    }

    fn check_malicious_ip(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let mal_ips = self.malicious_ips.read();
        let src = packet.src_ip?;
        let dst = packet.dst_ip?;

        let matched_ip = if mal_ips.contains(&src) {
            Some(src)
        } else if mal_ips.contains(&dst) {
            Some(dst)
        } else {
            None
        };

        matched_ip.map(|ip| {
            let (tactic, technique) = ThreatType::CommandAndControl.mitre_mapping();
            ThreatEvent {
                id: Uuid::new_v4().to_string(),
                timestamp: Utc::now(),
                threat_type: ThreatType::CommandAndControl,
                severity: ThreatSeverity::Critical,
                source_ip: Some(src),
                destination_ip: Some(dst),
                source_port: packet.src_port,
                destination_port: packet.dst_port,
                protocol: packet.protocol.name().to_string(),
                description: format!("Communication with known malicious IP: {}", ip),
                evidence: vec![format!("Matched threat intelligence feed: {}", ip)],
                recommendation:
                    "Block immediately. Isolate affected host. Investigate for compromise.".into(),
                confidence: 0.95,
                packet_ids: vec![packet.id],
                mitre_tactic: Some(tactic.into()),
                mitre_technique: Some(technique.into()),
            }
        })
    }

    fn check_dns_rebinding(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let query = packet.dns_query.as_ref()?;
        // DNS rebinding: public domain resolving to private IP
        // We check if a DNS query for a public domain is followed by a response with a private IP
        // Simplified: flag queries that look suspicious (very short TTL + private IP resolution)
        if query.len() > 100 || query.matches('.').count() > 10 {
            let (tactic, technique) = ThreatType::DnsRebinding.mitre_mapping();
            return Some(ThreatEvent {
                id: Uuid::new_v4().to_string(),
                timestamp: Utc::now(),
                threat_type: ThreatType::DnsRebinding,
                severity: ThreatSeverity::Medium,
                source_ip: packet.src_ip,
                destination_ip: packet.dst_ip,
                source_port: packet.src_port,
                destination_port: packet.dst_port,
                protocol: "DNS".into(),
                description: format!("Suspicious DNS query with excessive depth: {}", query),
                evidence: vec![format!("Subdomain depth: {}", query.matches('.').count())],
                recommendation: "Monitor for DNS rebinding attacks. Validate DNS responses.".into(),
                confidence: 0.5,
                packet_ids: vec![packet.id],
                mitre_tactic: Some(tactic.into()),
                mitre_technique: Some(technique.into()),
            });
        }
        None
    }

    fn check_tls_anomaly(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let tls_version = packet.tls_version.as_ref()?;

        // Flag deprecated TLS versions
        if tls_version == "SSL 3.0" || tls_version == "TLS 1.0" || tls_version == "TLS 1.1" {
            let (tactic, technique) = ThreatType::TlsDowngrade.mitre_mapping();
            return Some(ThreatEvent {
                id: Uuid::new_v4().to_string(),
                timestamp: Utc::now(),
                threat_type: ThreatType::TlsDowngrade,
                severity: ThreatSeverity::Medium,
                source_ip: packet.src_ip,
                destination_ip: packet.dst_ip,
                source_port: packet.src_port,
                destination_port: packet.dst_port,
                protocol: "TLS".into(),
                description: format!(
                    "Deprecated TLS version detected: {} ({}→{})",
                    tls_version,
                    packet.src_ip.map(|i| i.to_string()).unwrap_or_default(),
                    packet.dst_ip.map(|i| i.to_string()).unwrap_or_default(),
                ),
                evidence: vec![format!("TLS version: {}", tls_version)],
                recommendation: "Upgrade to TLS 1.2+ minimum. Disable SSLv3, TLS 1.0, TLS 1.1."
                    .into(),
                confidence: 0.9,
                packet_ids: vec![packet.id],
                mitre_tactic: Some(tactic.into()),
                mitre_technique: Some(technique.into()),
            });
        }
        None
    }

    fn check_unencrypted_pii(&self, packet: &CapturedPacket) -> Option<ThreatEvent> {
        let preview = packet.payload_preview.as_ref()?;

        // NDPA Article 24: Personal data must be encrypted in transit
        let pii_indicators = [
            "password=",
            "passwd=",
            "credit_card",
            "card_number",
            "ssn=",
            "social_security",
            "bank_account",
            "nin=", // National Identification Number (Nigeria)
            "bvn=", // Bank Verification Number (Nigeria)
            "date_of_birth",
        ];

        let is_encrypted = packet.tls_version.is_some()
            || packet
                .dst_port
                .map(|p| p == 443 || p == 8443 || p == 993 || p == 995)
                .unwrap_or(false);

        if is_encrypted {
            return None;
        }

        let lower = preview.to_lowercase();
        for indicator in &pii_indicators {
            if lower.contains(indicator) {
                let (tactic, technique) = ThreatType::UnencryptedPii.mitre_mapping();
                return Some(ThreatEvent {
                    id: Uuid::new_v4().to_string(),
                    timestamp: Utc::now(),
                    threat_type: ThreatType::UnencryptedPii,
                    severity: ThreatSeverity::High,
                    source_ip: packet.src_ip,
                    destination_ip: packet.dst_ip,
                    source_port: packet.src_port,
                    destination_port: packet.dst_port,
                    protocol: packet.protocol.name().to_string(),
                    description: format!(
                        "NDPA Violation: Unencrypted PII detected in transit ('{}' indicator found)",
                        indicator
                    ),
                    evidence: vec![
                        format!("PII indicator: {}", indicator),
                        "Traffic is not TLS-encrypted".into(),
                    ],
                    recommendation:
                        "Enforce TLS for all PII transmission per NDPA Article 24. Alert DPO."
                            .into(),
                    confidence: 0.85,
                    packet_ids: vec![packet.id],
                    mitre_tactic: Some(tactic.into()),
                    mitre_technique: Some(technique.into()),
                });
            }
        }
        None
    }

    pub fn add_malicious_ip(&self, ip: IpAddr) {
        self.malicious_ips.write().push(ip);
    }

    pub fn add_malicious_domain(&self, domain: String) {
        self.malicious_domains.write().push(domain);
    }

    pub fn get_threats(&self, limit: usize) -> Vec<ThreatEvent> {
        let threats = self.threats.read();
        let start = if threats.len() > limit {
            threats.len() - limit
        } else {
            0
        };
        threats[start..].to_vec()
    }

    pub fn threat_summary(&self) -> HashMap<String, u64> {
        let threats = self.threats.read();
        let mut summary = HashMap::new();
        for t in threats.iter() {
            *summary.entry(format!("{:?}", t.threat_type)).or_insert(0) += 1;
        }
        summary
    }

    pub fn total_threats(&self) -> u64 {
        self.threat_count.load(Ordering::Relaxed)
    }
}

fn categorize_payload_match(patterns: &[String]) -> (ThreatType, ThreatSeverity) {
    for p in patterns {
        let lower = p.to_lowercase();
        if lower.contains("script") || lower.contains("onerror") || lower.contains("onload") {
            return (ThreatType::SuspiciousPayload, ThreatSeverity::Medium);
        }
        if lower.contains("union select")
            || lower.contains("drop table")
            || lower.contains("'; drop")
        {
            return (ThreatType::SuspiciousPayload, ThreatSeverity::High);
        }
        if lower.contains("/bin/sh")
            || lower.contains("/bin/bash")
            || lower.contains("cmd.exe")
            || lower.contains("powershell")
        {
            return (ThreatType::CommandAndControl, ThreatSeverity::Critical);
        }
        if lower.contains("stratum") || lower.contains("mining") {
            return (ThreatType::CryptoMining, ThreatSeverity::Medium);
        }
        if lower.contains("encrypted")
            || lower.contains("decrypt_instructions")
            || lower.contains("your_files")
        {
            return (ThreatType::RansomwareActivity, ThreatSeverity::Critical);
        }
        if lower.contains("etc/passwd") || lower.contains("etc/shadow") || lower.contains("../") {
            return (ThreatType::UnauthorizedAccess, ThreatSeverity::High);
        }
    }
    (ThreatType::SuspiciousPayload, ThreatSeverity::Low)
}
