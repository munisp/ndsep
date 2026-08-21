use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

use super::packet::ThreatSeverity;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreatEvent {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub threat_type: ThreatType,
    pub severity: ThreatSeverity,
    pub source_ip: Option<IpAddr>,
    pub destination_ip: Option<IpAddr>,
    pub source_port: Option<u16>,
    pub destination_port: Option<u16>,
    pub protocol: String,
    pub description: String,
    pub evidence: Vec<String>,
    pub recommendation: String,
    pub confidence: f64,
    pub packet_ids: Vec<u64>,
    pub mitre_tactic: Option<String>,
    pub mitre_technique: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ThreatType {
    PortScan,
    SynFlood,
    DnsExfiltration,
    ArpSpoofing,
    BruteForce,
    DataExfiltration,
    CommandAndControl,
    MalwareBeacon,
    DdosAmplification,
    ManInTheMiddle,
    UnauthorizedAccess,
    ProtocolAnomaly,
    SuspiciousPayload,
    CryptoMining,
    LateralMovement,
    PrivilegeEscalation,
    RansomwareActivity,
    DnsRebinding,
    SlowLoris,
    IcmpTunnel,
    DnsTunnel,
    TlsDowngrade,
    CertificateAnomaly,
    BeaconPattern,
    UnencryptedPii,
    PolicyViolation,
    AnomalousTraffic,
}

impl ThreatType {
    pub fn default_severity(&self) -> ThreatSeverity {
        match self {
            Self::RansomwareActivity | Self::CommandAndControl | Self::DataExfiltration => {
                ThreatSeverity::Critical
            }
            Self::SynFlood
            | Self::DdosAmplification
            | Self::ArpSpoofing
            | Self::ManInTheMiddle
            | Self::MalwareBeacon
            | Self::PrivilegeEscalation
            | Self::DnsExfiltration
            | Self::UnencryptedPii => ThreatSeverity::High,
            Self::PortScan
            | Self::BruteForce
            | Self::LateralMovement
            | Self::DnsTunnel
            | Self::IcmpTunnel
            | Self::TlsDowngrade
            | Self::CertificateAnomaly
            | Self::SlowLoris
            | Self::DnsRebinding
            | Self::CryptoMining => ThreatSeverity::Medium,
            Self::SuspiciousPayload
            | Self::BeaconPattern
            | Self::UnauthorizedAccess
            | Self::PolicyViolation => ThreatSeverity::Low,
            Self::ProtocolAnomaly | Self::AnomalousTraffic => ThreatSeverity::Info,
        }
    }

    pub fn mitre_mapping(&self) -> (&'static str, &'static str) {
        match self {
            Self::PortScan => ("Discovery", "T1046 Network Service Scanning"),
            Self::SynFlood | Self::DdosAmplification | Self::SlowLoris => {
                ("Impact", "T1499 Endpoint Denial of Service")
            }
            Self::DnsExfiltration | Self::DnsTunnel | Self::DataExfiltration => (
                "Exfiltration",
                "T1048 Exfiltration Over Alternative Protocol",
            ),
            Self::ArpSpoofing | Self::ManInTheMiddle => {
                ("Credential Access", "T1557 Adversary-in-the-Middle")
            }
            Self::BruteForce => ("Credential Access", "T1110 Brute Force"),
            Self::CommandAndControl | Self::MalwareBeacon | Self::BeaconPattern => {
                ("Command and Control", "T1071 Application Layer Protocol")
            }
            Self::LateralMovement => ("Lateral Movement", "T1021 Remote Services"),
            Self::PrivilegeEscalation => (
                "Privilege Escalation",
                "T1068 Exploitation for Privilege Escalation",
            ),
            Self::RansomwareActivity => ("Impact", "T1486 Data Encrypted for Impact"),
            Self::CryptoMining => ("Impact", "T1496 Resource Hijacking"),
            Self::IcmpTunnel => (
                "Command and Control",
                "T1095 Non-Application Layer Protocol",
            ),
            Self::TlsDowngrade | Self::CertificateAnomaly => {
                ("Collection", "T1040 Network Sniffing")
            }
            _ => ("Uncategorized", "N/A"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoTDevice {
    pub ip: IpAddr,
    pub mac: Option<String>,
    pub device_type: IoTDeviceType,
    pub manufacturer: Option<String>,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub protocols_used: Vec<String>,
    pub risk_score: f64,
    pub risk_factors: Vec<String>,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub open_ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IoTDeviceType {
    Camera,
    SmartSpeaker,
    SmartDisplay,
    Thermostat,
    SmartLock,
    LightBulb,
    SmartPlug,
    Router,
    Printer,
    MediaPlayer,
    IndustrialController,
    Sensor,
    Gateway,
    MedicalDevice,
    PointOfSale,
    UnknownIoT,
    Workstation,
    Server,
    Mobile,
}
