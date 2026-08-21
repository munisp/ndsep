use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use dashmap::DashMap;
use log::{error, info, warn};
use parking_lot::RwLock;
use pnet::datalink::{self, Channel, NetworkInterface};
use pnet::packet::arp::ArpPacket;
use pnet::packet::ethernet::{EtherTypes, EthernetPacket};
use pnet::packet::ip::IpNextHeaderProtocols;
use pnet::packet::ipv4::Ipv4Packet;
use pnet::packet::ipv6::Ipv6Packet;
use pnet::packet::tcp::TcpPacket;
use pnet::packet::udp::UdpPacket;
use pnet::packet::Packet;
use tokio::sync::broadcast;

use crate::models::packet::*;
use crate::protocol;

#[derive(Clone)]
pub struct CaptureEngine {
    pub is_capturing: Arc<AtomicBool>,
    pub packet_count: Arc<AtomicU64>,
    pub byte_count: Arc<AtomicU64>,
    pub threat_count: Arc<AtomicU64>,
    pub anomaly_count: Arc<AtomicU64>,
    pub start_time: Arc<RwLock<Option<Instant>>>,
    pub packets: Arc<RwLock<Vec<CapturedPacket>>>,
    pub source_ips: Arc<DashMap<IpAddr, u64>>,
    pub dest_ips: Arc<DashMap<IpAddr, u64>>,
    pub protocol_counts: Arc<DashMap<String, u64>>,
    pub sender: broadcast::Sender<CapturedPacket>,
    max_packets: usize,
}

impl CaptureEngine {
    pub fn new(max_packets: usize) -> Self {
        let (sender, _) = broadcast::channel(4096);
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            packet_count: Arc::new(AtomicU64::new(0)),
            byte_count: Arc::new(AtomicU64::new(0)),
            threat_count: Arc::new(AtomicU64::new(0)),
            anomaly_count: Arc::new(AtomicU64::new(0)),
            start_time: Arc::new(RwLock::new(None)),
            packets: Arc::new(RwLock::new(Vec::with_capacity(max_packets))),
            source_ips: Arc::new(DashMap::new()),
            dest_ips: Arc::new(DashMap::new()),
            protocol_counts: Arc::new(DashMap::new()),
            sender,
            max_packets,
        }
    }

    pub fn list_interfaces() -> Vec<InterfaceInfo> {
        datalink::interfaces()
            .into_iter()
            .filter(|iface| !iface.is_loopback() && iface.is_up())
            .map(|iface| InterfaceInfo {
                name: iface.name.clone(),
                description: iface.description.clone(),
                mac: iface.mac.map(|m| m.to_string()),
                ips: iface.ips.iter().map(|ip| ip.ip().to_string()).collect(),
                is_up: iface.is_up(),
                is_loopback: iface.is_loopback(),
            })
            .collect()
    }

    pub fn start_capture(&self, interface_name: &str) -> Result<(), String> {
        if self.is_capturing.load(Ordering::Relaxed) {
            return Err("Capture already running".into());
        }

        let interface = datalink::interfaces()
            .into_iter()
            .find(|iface| iface.name == interface_name)
            .ok_or_else(|| format!("Interface '{}' not found", interface_name))?;

        self.is_capturing.store(true, Ordering::SeqCst);
        *self.start_time.write() = Some(Instant::now());

        let engine = self.clone();
        let iface = interface.clone();

        std::thread::spawn(move || {
            engine.capture_loop(iface);
        });

        info!("Capture started on interface: {}", interface_name);
        Ok(())
    }

    pub fn stop_capture(&self) {
        self.is_capturing.store(false, Ordering::SeqCst);
        info!("Capture stopped");
    }

    fn capture_loop(&self, interface: NetworkInterface) {
        let config = pnet::datalink::Config {
            read_timeout: Some(std::time::Duration::from_millis(100)),
            ..Default::default()
        };

        let (_tx, mut rx) = match datalink::channel(&interface, config) {
            Ok(Channel::Ethernet(tx, rx)) => (tx, rx),
            Ok(_) => {
                error!("Unsupported channel type for {}", interface.name);
                self.is_capturing.store(false, Ordering::SeqCst);
                return;
            }
            Err(e) => {
                error!("Failed to open channel on {}: {}", interface.name, e);
                self.is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        while self.is_capturing.load(Ordering::Relaxed) {
            match rx.next() {
                Ok(frame) => {
                    if let Some(ethernet) = EthernetPacket::new(frame) {
                        self.process_ethernet(&ethernet, frame.len());
                    }
                }
                Err(e) => {
                    if self.is_capturing.load(Ordering::Relaxed) {
                        warn!("Capture read error: {}", e);
                    }
                }
            }
        }
    }

    fn process_ethernet(&self, ethernet: &EthernetPacket, raw_len: usize) {
        let pkt_id = self.packet_count.fetch_add(1, Ordering::Relaxed);
        self.byte_count.fetch_add(raw_len as u64, Ordering::Relaxed);

        if pkt_id as usize >= self.max_packets {
            return;
        }

        let eth_src = ethernet.get_source().to_string();
        let eth_dst = ethernet.get_destination().to_string();

        let mut packet = CapturedPacket {
            id: pkt_id,
            timestamp: Utc::now(),
            src_ip: None,
            dst_ip: None,
            src_port: None,
            dst_port: None,
            protocol: Protocol::Unknown(0),
            length: raw_len,
            ttl: None,
            flags: None,
            payload_preview: None,
            raw_length: raw_len,
            eth_src: Some(eth_src),
            eth_dst: Some(eth_dst),
            vlan_id: None,
            application_protocol: None,
            dns_query: None,
            http_method: None,
            http_host: None,
            http_uri: None,
            tls_sni: None,
            tls_version: None,
            anomaly_score: None,
            threat_level: None,
        };

        match ethernet.get_ethertype() {
            EtherTypes::Ipv4 => {
                if let Some(ipv4) = Ipv4Packet::new(ethernet.payload()) {
                    self.process_ipv4(&ipv4, &mut packet);
                }
            }
            EtherTypes::Ipv6 => {
                if let Some(ipv6) = Ipv6Packet::new(ethernet.payload()) {
                    self.process_ipv6(&ipv6, &mut packet);
                }
            }
            EtherTypes::Arp => {
                if let Some(arp) = ArpPacket::new(ethernet.payload()) {
                    packet.protocol = Protocol::Arp;
                    packet.src_ip = Some(IpAddr::V4(arp.get_sender_proto_addr()));
                    packet.dst_ip = Some(IpAddr::V4(arp.get_target_proto_addr()));
                    self.update_proto_count("ARP");
                }
            }
            _ => {
                self.update_proto_count("OTHER");
            }
        }

        if let Some(src) = packet.src_ip {
            *self.source_ips.entry(src).or_insert(0) += 1;
        }
        if let Some(dst) = packet.dst_ip {
            *self.dest_ips.entry(dst).or_insert(0) += 1;
        }

        let _ = self.sender.send(packet.clone());

        self.packets.write().push(packet);
    }

    fn process_ipv4(&self, ipv4: &Ipv4Packet, packet: &mut CapturedPacket) {
        packet.src_ip = Some(IpAddr::V4(ipv4.get_source()));
        packet.dst_ip = Some(IpAddr::V4(ipv4.get_destination()));
        packet.ttl = Some(ipv4.get_ttl());
        let next = ipv4.get_next_level_protocol();
        packet.protocol = Protocol::from_ip_next_header(next.0);

        match next {
            IpNextHeaderProtocols::Tcp => {
                if let Some(tcp) = TcpPacket::new(ipv4.payload()) {
                    self.process_tcp(&tcp, packet, ipv4.payload());
                }
            }
            IpNextHeaderProtocols::Udp => {
                if let Some(udp) = UdpPacket::new(ipv4.payload()) {
                    self.process_udp(&udp, packet);
                }
            }
            IpNextHeaderProtocols::Icmp => {
                self.update_proto_count("ICMP");
            }
            _ => {
                self.update_proto_count("OTHER");
            }
        }
    }

    fn process_ipv6(&self, ipv6: &Ipv6Packet, packet: &mut CapturedPacket) {
        packet.src_ip = Some(IpAddr::V6(ipv6.get_source()));
        packet.dst_ip = Some(IpAddr::V6(ipv6.get_destination()));
        let next = ipv6.get_next_header();
        packet.protocol = Protocol::from_ip_next_header(next.0);

        match next {
            IpNextHeaderProtocols::Tcp => {
                if let Some(tcp) = TcpPacket::new(ipv6.payload()) {
                    self.process_tcp(&tcp, packet, ipv6.payload());
                }
            }
            IpNextHeaderProtocols::Udp => {
                if let Some(udp) = UdpPacket::new(ipv6.payload()) {
                    self.process_udp(&udp, packet);
                }
            }
            IpNextHeaderProtocols::Icmpv6 => {
                packet.protocol = Protocol::Icmpv6;
                self.update_proto_count("ICMPv6");
            }
            _ => {
                self.update_proto_count("OTHER");
            }
        }
    }

    fn process_tcp(&self, tcp: &TcpPacket, packet: &mut CapturedPacket, _ip_payload: &[u8]) {
        let sport = tcp.get_source();
        let dport = tcp.get_destination();
        packet.src_port = Some(sport);
        packet.dst_port = Some(dport);
        packet.flags = Some(TcpFlags::from_bits(tcp.get_flags()));

        let app = AppProtocol::from_port(dport, true);
        if app == AppProtocol::Unknown {
            packet.application_protocol = Some(AppProtocol::from_port(sport, true));
        } else {
            packet.application_protocol = Some(app);
        }

        let payload = tcp.payload();
        if !payload.is_empty() {
            protocol::dissect_tcp_payload(payload, sport, dport, packet);
        }

        self.update_proto_count("TCP");
    }

    fn process_udp(&self, udp: &UdpPacket, packet: &mut CapturedPacket) {
        let sport = udp.get_source();
        let dport = udp.get_destination();
        packet.src_port = Some(sport);
        packet.dst_port = Some(dport);

        let app = AppProtocol::from_port(dport, false);
        if app == AppProtocol::Unknown {
            packet.application_protocol = Some(AppProtocol::from_port(sport, false));
        } else {
            packet.application_protocol = Some(app);
        }

        let payload = udp.payload();
        if !payload.is_empty() {
            protocol::dissect_udp_payload(payload, sport, dport, packet);
        }

        self.update_proto_count("UDP");
    }

    fn update_proto_count(&self, proto: &str) {
        *self.protocol_counts.entry(proto.to_string()).or_insert(0) += 1;
    }

    pub fn get_stats(&self) -> CaptureStats {
        let elapsed = self
            .start_time
            .read()
            .map(|t| t.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        let pkts = self.packet_count.load(Ordering::Relaxed);
        let bytes = self.byte_count.load(Ordering::Relaxed);

        let proto_map: HashMap<String, u64> = self
            .protocol_counts
            .iter()
            .map(|e| (e.key().clone(), *e.value()))
            .collect();

        CaptureStats {
            packets_captured: pkts,
            packets_per_second: if elapsed > 0.0 {
                pkts as f64 / elapsed
            } else {
                0.0
            },
            bytes_captured: bytes,
            bytes_per_second: if elapsed > 0.0 {
                bytes as f64 / elapsed
            } else {
                0.0
            },
            protocols: ProtocolStats {
                tcp: *proto_map.get("TCP").unwrap_or(&0),
                udp: *proto_map.get("UDP").unwrap_or(&0),
                icmp: *proto_map.get("ICMP").unwrap_or(&0) + *proto_map.get("ICMPv6").unwrap_or(&0),
                arp: *proto_map.get("ARP").unwrap_or(&0),
                other: *proto_map.get("OTHER").unwrap_or(&0),
                total: pkts,
            },
            unique_sources: self.source_ips.len(),
            unique_destinations: self.dest_ips.len(),
            capture_duration_secs: elapsed,
            threats_detected: self.threat_count.load(Ordering::Relaxed),
            anomalies_detected: self.anomaly_count.load(Ordering::Relaxed),
        }
    }

    pub fn get_recent_packets(&self, limit: usize, offset: usize) -> Vec<CapturedPacket> {
        let packets = self.packets.read();
        let total = packets.len();
        if offset >= total {
            return Vec::new();
        }
        let start = if total > offset + limit {
            total - offset - limit
        } else {
            0
        };
        let end = total - offset;
        packets[start..end].to_vec()
    }

    pub fn reset(&self) {
        self.stop_capture();
        self.packet_count.store(0, Ordering::SeqCst);
        self.byte_count.store(0, Ordering::SeqCst);
        self.threat_count.store(0, Ordering::SeqCst);
        self.anomaly_count.store(0, Ordering::SeqCst);
        *self.start_time.write() = None;
        self.packets.write().clear();
        self.source_ips.clear();
        self.dest_ips.clear();
        self.protocol_counts.clear();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceInfo {
    pub name: String,
    pub description: String,
    pub mac: Option<String>,
    pub ips: Vec<String>,
    pub is_up: bool,
    pub is_loopback: bool,
}

use serde::{Deserialize, Serialize};
