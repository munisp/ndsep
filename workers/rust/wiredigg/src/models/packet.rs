use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedPacket {
    pub id: u64,
    pub timestamp: DateTime<Utc>,
    pub src_ip: Option<IpAddr>,
    pub dst_ip: Option<IpAddr>,
    pub src_port: Option<u16>,
    pub dst_port: Option<u16>,
    pub protocol: Protocol,
    pub length: usize,
    pub ttl: Option<u8>,
    pub flags: Option<TcpFlags>,
    pub payload_preview: Option<String>,
    pub raw_length: usize,
    pub eth_src: Option<String>,
    pub eth_dst: Option<String>,
    pub vlan_id: Option<u16>,
    pub application_protocol: Option<AppProtocol>,
    pub dns_query: Option<String>,
    pub http_method: Option<String>,
    pub http_host: Option<String>,
    pub http_uri: Option<String>,
    pub tls_sni: Option<String>,
    pub tls_version: Option<String>,
    pub anomaly_score: Option<f64>,
    pub threat_level: Option<ThreatSeverity>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "UPPERCASE")]
pub enum Protocol {
    Tcp,
    Udp,
    Icmp,
    Icmpv6,
    Arp,
    Igmp,
    Gre,
    Esp,
    Unknown(u8),
}

impl Protocol {
    pub fn from_ip_next_header(val: u8) -> Self {
        match val {
            1 => Self::Icmp,
            2 => Self::Igmp,
            6 => Self::Tcp,
            17 => Self::Udp,
            47 => Self::Gre,
            50 => Self::Esp,
            58 => Self::Icmpv6,
            _ => Self::Unknown(val),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Tcp => "TCP",
            Self::Udp => "UDP",
            Self::Icmp => "ICMP",
            Self::Icmpv6 => "ICMPv6",
            Self::Arp => "ARP",
            Self::Igmp => "IGMP",
            Self::Gre => "GRE",
            Self::Esp => "ESP",
            Self::Unknown(_) => "OTHER",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "UPPERCASE")]
pub enum AppProtocol {
    Http,
    Https,
    Dns,
    Dhcp,
    Ssh,
    Ftp,
    Smtp,
    Imap,
    Pop3,
    Snmp,
    Ntp,
    Syslog,
    Mdns,
    Ssdp,
    Llmnr,
    Netbios,
    Smb,
    Rdp,
    Telnet,
    Mqtt,
    Coap,
    Modbus,
    Opcua,
    Sip,
    Rtsp,
    Unknown,
}

impl AppProtocol {
    pub fn from_port(port: u16, is_tcp: bool) -> Self {
        match (port, is_tcp) {
            (80, true) => Self::Http,
            (443, true) => Self::Https,
            (53, _) => Self::Dns,
            (67 | 68, false) => Self::Dhcp,
            (22, true) => Self::Ssh,
            (21, true) => Self::Ftp,
            (25 | 587, true) => Self::Smtp,
            (143 | 993, true) => Self::Imap,
            (110 | 995, true) => Self::Pop3,
            (161 | 162, false) => Self::Snmp,
            (123, false) => Self::Ntp,
            (514, false) => Self::Syslog,
            (5353, false) => Self::Mdns,
            (1900, false) => Self::Ssdp,
            (5355, false) => Self::Llmnr,
            (137 | 138 | 139, _) => Self::Netbios,
            (445, true) => Self::Smb,
            (3389, true) => Self::Rdp,
            (23, true) => Self::Telnet,
            (1883 | 8883, true) => Self::Mqtt,
            (5683, false) => Self::Coap,
            (502, true) => Self::Modbus,
            (4840, true) => Self::Opcua,
            (5060 | 5061, _) => Self::Sip,
            (554, true) => Self::Rtsp,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TcpFlags {
    pub syn: bool,
    pub ack: bool,
    pub fin: bool,
    pub rst: bool,
    pub psh: bool,
    pub urg: bool,
}

impl TcpFlags {
    pub fn from_bits(flags: u8) -> Self {
        Self {
            fin: flags & 0x01 != 0,
            syn: flags & 0x02 != 0,
            rst: flags & 0x04 != 0,
            psh: flags & 0x08 != 0,
            ack: flags & 0x10 != 0,
            urg: flags & 0x20 != 0,
        }
    }

    pub fn label(&self) -> String {
        let mut parts = Vec::new();
        if self.syn {
            parts.push("SYN");
        }
        if self.ack {
            parts.push("ACK");
        }
        if self.fin {
            parts.push("FIN");
        }
        if self.rst {
            parts.push("RST");
        }
        if self.psh {
            parts.push("PSH");
        }
        if self.urg {
            parts.push("URG");
        }
        parts.join("|")
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ThreatSeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl ThreatSeverity {
    pub fn score(&self) -> u8 {
        match self {
            Self::Critical => 10,
            Self::High => 8,
            Self::Medium => 5,
            Self::Low => 3,
            Self::Info => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolStats {
    pub tcp: u64,
    pub udp: u64,
    pub icmp: u64,
    pub arp: u64,
    pub other: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureStats {
    pub packets_captured: u64,
    pub packets_per_second: f64,
    pub bytes_captured: u64,
    pub bytes_per_second: f64,
    pub protocols: ProtocolStats,
    pub unique_sources: usize,
    pub unique_destinations: usize,
    pub capture_duration_secs: f64,
    pub threats_detected: u64,
    pub anomalies_detected: u64,
}
