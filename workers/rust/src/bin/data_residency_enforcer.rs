/// data_residency_enforcer — NDSEP Enhancement
/// Real-time data residency enforcement at the network layer.
/// Implements NDPA Section 41: critical data must not leave Nigerian jurisdiction.
/// Intercepts outbound HTTP/HTTPS connections, checks destination IP against
/// geolocation database, and blocks/logs transfers to non-approved jurisdictions.
///
/// Architecture: runs as a transparent HTTP proxy on port 8888.
/// Configure upstream services to use this proxy for egress traffic.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

// ─── Configuration ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Config {
    listen_addr: SocketAddr,
    db_url: String,
    /// ISO-3166-1 alpha-2 country codes allowed as data destinations
    allowed_countries: HashSet<String>,
    /// IP CIDRs explicitly whitelisted (e.g., Nigerian IXP peering IPs)
    whitelisted_cidrs: Vec<IpCidr>,
    /// Block or just log violations
    enforcement_mode: EnforcementMode,
}

#[derive(Debug, Clone, PartialEq)]
enum EnforcementMode {
    Block,
    Log,
    Audit, // log + notify but allow
}

#[derive(Debug, Clone)]
struct IpCidr {
    network: u32,
    mask: u32,
}

impl IpCidr {
    fn contains(&self, ip: u32) -> bool {
        (ip & self.mask) == (self.network & self.mask)
    }
}

impl Default for Config {
    fn default() -> Self {
        let mut allowed = HashSet::new();
        allowed.insert("NG".to_string()); // Nigeria
        // Additional approved jurisdictions per NDPA adequacy decisions
        allowed.insert("GH".to_string()); // Ghana (ECOWAS)
        allowed.insert("ZA".to_string()); // South Africa (adequacy pending)

        Config {
            listen_addr: "0.0.0.0:8888".parse().unwrap(),
            db_url: std::env::var("NDSEP_PG_URL")
                .unwrap_or_else(|_| "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db".to_string()),
            allowed_countries: allowed,
            whitelisted_cidrs: vec![
                // Nigerian IP space (IANA allocations)
                IpCidr { network: ip_to_u32("197.210.0.0"), mask: 0xFFFFF000 },
                IpCidr { network: ip_to_u32("41.58.0.0"),   mask: 0xFFFF8000 },
                IpCidr { network: ip_to_u32("105.112.0.0"), mask: 0xFFFC0000 },
                IpCidr { network: ip_to_u32("154.120.0.0"), mask: 0xFFFF0000 },
                IpCidr { network: ip_to_u32("196.216.0.0"), mask: 0xFFFF0000 },
                // Loopback / private
                IpCidr { network: ip_to_u32("127.0.0.0"),   mask: 0xFF000000 },
                IpCidr { network: ip_to_u32("10.0.0.0"),    mask: 0xFF000000 },
                IpCidr { network: ip_to_u32("172.16.0.0"),  mask: 0xFFF00000 },
                IpCidr { network: ip_to_u32("192.168.0.0"), mask: 0xFFFF0000 },
            ],
            enforcement_mode: EnforcementMode::Audit,
        }
    }
}

fn ip_to_u32(ip: &str) -> u32 {
    let parts: Vec<u32> = ip.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    if parts.len() != 4 { return 0; }
    (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
}

// ─── Violation Record ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct ResidencyViolation {
    source_ip: String,
    destination_host: String,
    destination_ip: String,
    destination_country: String,
    data_classification: String,
    action_taken: String,
    timestamp: u64,
}

// ─── GeoIP Lookup (simplified — production uses MaxMind GeoLite2 or ip-api) ──

fn lookup_country(ip: &str) -> String {
    // In production: query MaxMind GeoLite2 database
    // Here we use a simplified lookup based on known Nigerian IP ranges
    let ip_u32 = ip_to_u32(ip);
    let nigerian_ranges = [
        (ip_to_u32("197.210.0.0"), 0xFFFFF000u32),
        (ip_to_u32("41.58.0.0"),   0xFFFF8000u32),
        (ip_to_u32("105.112.0.0"), 0xFFFC0000u32),
        (ip_to_u32("154.120.0.0"), 0xFFFF0000u32),
        (ip_to_u32("196.216.0.0"), 0xFFFF0000u32),
    ];
    for (net, mask) in &nigerian_ranges {
        if (ip_u32 & mask) == (net & mask) {
            return "NG".to_string();
        }
    }
    // Private / loopback → treat as local
    let private_ranges = [
        (ip_to_u32("127.0.0.0"), 0xFF000000u32),
        (ip_to_u32("10.0.0.0"),  0xFF000000u32),
        (ip_to_u32("172.16.0.0"),0xFFF00000u32),
        (ip_to_u32("192.168.0.0"),0xFFFF0000u32),
    ];
    for (net, mask) in &private_ranges {
        if (ip_u32 & mask) == (net & mask) {
            return "LOCAL".to_string();
        }
    }
    // Default: unknown — treat as foreign
    "UNKNOWN".to_string()
}

fn is_allowed(ip: &str, config: &Config) -> bool {
    let ip_u32 = ip_to_u32(ip);
    // Check whitelisted CIDRs first
    for cidr in &config.whitelisted_cidrs {
        if cidr.contains(ip_u32) {
            return true;
        }
    }
    // Check country allowlist
    let country = lookup_country(ip);
    config.allowed_countries.contains(&country)
}

// ─── Proxy Core ───────────────────────────────────────────────────────────────

async fn handle_connect(
    mut client: TcpStream,
    host: String,
    port: u16,
    config: Arc<Config>,
    violations: Arc<RwLock<Vec<ResidencyViolation>>>,
) {
    // Resolve destination IP
    let dest_addr = format!("{}:{}", host, port);
    let resolved = match tokio::net::lookup_host(&dest_addr).await {
        Ok(mut addrs) => addrs.next(),
        Err(_) => None,
    };

    let dest_ip = resolved
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "0.0.0.0".to_string());

    let allowed = is_allowed(&dest_ip, &config);
    let country = lookup_country(&dest_ip);

    if !allowed {
        let violation = ResidencyViolation {
            source_ip: client.peer_addr().map(|a| a.to_string()).unwrap_or_default(),
            destination_host: host.clone(),
            destination_ip: dest_ip.clone(),
            destination_country: country.clone(),
            data_classification: "unknown".to_string(),
            action_taken: match config.enforcement_mode {
                EnforcementMode::Block => "blocked".to_string(),
                EnforcementMode::Log   => "logged".to_string(),
                EnforcementMode::Audit => "audited".to_string(),
            },
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        eprintln!(
            "[RESIDENCY VIOLATION] {} → {}:{} (IP: {}, Country: {}) → {}",
            violation.source_ip, host, port, dest_ip, country, violation.action_taken
        );

        if let Ok(mut v) = violations.write() {
            v.push(violation);
        }

        if config.enforcement_mode == EnforcementMode::Block {
            let _ = client.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nData residency violation: destination not in approved jurisdiction\r\n").await;
            return;
        }
    }

    // Establish upstream connection
    match timeout(Duration::from_secs(10), TcpStream::connect(&dest_addr)).await {
        Ok(Ok(mut upstream)) => {
            // Send 200 Connection Established for CONNECT
            let _ = client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await;
            // Bidirectional copy
            let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
        }
        _ => {
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
        }
    }
}

async fn parse_connect_request(stream: &mut TcpStream) -> Option<(String, u16)> {
    let mut buf = vec![0u8; 4096];
    let n = timeout(Duration::from_secs(5), stream.read(&mut buf)).await.ok()?.ok()?;
    let req = std::str::from_utf8(&buf[..n]).ok()?;

    // Parse: CONNECT host:port HTTP/1.1
    let first_line = req.lines().next()?;
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "CONNECT" {
        return None;
    }
    let host_port: Vec<&str> = parts[1].split(':').collect();
    if host_port.len() != 2 {
        return None;
    }
    let host = host_port[0].to_string();
    let port: u16 = host_port[1].parse().ok()?;
    Some((host, port))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let config = Arc::new(Config::default());
    let violations: Arc<RwLock<Vec<ResidencyViolation>>> = Arc::new(RwLock::new(Vec::new()));

    let listener = TcpListener::bind(&config.listen_addr)
        .await
        .expect("Failed to bind listener");

    eprintln!(
        "[data_residency_enforcer] Listening on {} (mode: {:?})",
        config.listen_addr, config.enforcement_mode
    );
    eprintln!(
        "[data_residency_enforcer] Allowed countries: {:?}",
        config.allowed_countries
    );

    loop {
        match listener.accept().await {
            Ok((mut stream, peer)) => {
                let cfg = Arc::clone(&config);
                let viols = Arc::clone(&violations);
                tokio::spawn(async move {
                    if let Some((host, port)) = parse_connect_request(&mut stream).await {
                        handle_connect(stream, host, port, cfg, viols).await;
                    }
                });
            }
            Err(e) => eprintln!("Accept error: {}", e),
        }
    }
}
