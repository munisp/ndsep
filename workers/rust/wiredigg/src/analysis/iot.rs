use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use chrono::Utc;
use dashmap::DashMap;

use crate::models::packet::{AppProtocol, CapturedPacket};
use crate::models::threat::{IoTDevice, IoTDeviceType};

/// IoT device fingerprinting engine.
/// Identifies and classifies IoT devices by traffic patterns, protocols, and port usage.
#[derive(Clone)]
pub struct IoTDetector {
    devices: Arc<DashMap<IpAddr, IoTDevice>>,
    mac_oui_db: Arc<HashMap<String, &'static str>>,
    port_fingerprints: Arc<HashMap<u16, IoTDeviceType>>,
}

impl IoTDetector {
    pub fn new() -> Self {
        Self {
            devices: Arc::new(DashMap::new()),
            mac_oui_db: Arc::new(build_oui_database()),
            port_fingerprints: Arc::new(build_port_fingerprints()),
        }
    }

    pub fn process_packet(&self, packet: &CapturedPacket) {
        let ip = match packet.src_ip {
            Some(ip) => ip,
            None => return,
        };

        // Skip non-private IPs for IoT detection
        if !is_private_ip(&ip) {
            return;
        }

        let now = Utc::now();

        let mut device = self.devices.entry(ip).or_insert_with(|| IoTDevice {
            ip,
            mac: packet.eth_src.clone(),
            device_type: IoTDeviceType::UnknownIoT,
            manufacturer: None,
            first_seen: now,
            last_seen: now,
            protocols_used: Vec::new(),
            risk_score: 0.0,
            risk_factors: Vec::new(),
            packets_sent: 0,
            packets_received: 0,
            bytes_sent: 0,
            bytes_received: 0,
            open_ports: Vec::new(),
        });

        device.last_seen = now;
        device.packets_sent += 1;
        device.bytes_sent += packet.length as u64;

        // Track protocols
        let proto_name = packet.protocol.name().to_string();
        if !device.protocols_used.contains(&proto_name) {
            device.protocols_used.push(proto_name);
        }

        if let Some(app) = &packet.application_protocol {
            let app_name = format!("{:?}", app);
            if !device.protocols_used.contains(&app_name) {
                device.protocols_used.push(app_name);
            }
        }

        // Track ports
        if let Some(sport) = packet.src_port {
            if !device.open_ports.contains(&sport) && sport < 10000 {
                device.open_ports.push(sport);
            }
        }

        // Identify manufacturer from MAC OUI
        if device.manufacturer.is_none() {
            if let Some(mac) = &packet.eth_src {
                let oui = mac.replace(':', "").to_uppercase();
                if oui.len() >= 6 {
                    let prefix = &oui[..6];
                    if let Some(&manufacturer) = self.mac_oui_db.get(prefix) {
                        device.manufacturer = Some(manufacturer.to_string());
                    }
                }
            }
        }

        // Classify device type
        self.classify_device(&mut device, packet);

        // Compute risk score
        self.compute_risk(&mut device);
    }

    fn classify_device(
        &self,
        device: &mut dashmap::mapref::one::RefMut<'_, IpAddr, IoTDevice>,
        packet: &CapturedPacket,
    ) {
        // Port-based fingerprinting
        if let Some(dport) = packet.dst_port {
            if let Some(device_type) = self.port_fingerprints.get(&dport) {
                if device.device_type == IoTDeviceType::UnknownIoT {
                    device.device_type = device_type.clone();
                }
            }
        }

        // Protocol-based classification
        if let Some(app) = &packet.application_protocol {
            match app {
                AppProtocol::Mqtt | AppProtocol::Coap => {
                    if device.device_type == IoTDeviceType::UnknownIoT {
                        device.device_type = IoTDeviceType::Sensor;
                    }
                }
                AppProtocol::Modbus | AppProtocol::Opcua => {
                    device.device_type = IoTDeviceType::IndustrialController;
                }
                AppProtocol::Ssdp | AppProtocol::Mdns => {
                    // Discovery protocols — common for media devices
                    if device.device_type == IoTDeviceType::UnknownIoT {
                        device.device_type = IoTDeviceType::MediaPlayer;
                    }
                }
                AppProtocol::Rtsp => {
                    device.device_type = IoTDeviceType::Camera;
                }
                _ => {}
            }
        }

        // Manufacturer-based classification
        if let Some(mfr) = &device.manufacturer {
            let lower = mfr.to_lowercase();
            if lower.contains("ring")
                || lower.contains("arlo")
                || lower.contains("hikvision")
                || lower.contains("dahua")
            {
                device.device_type = IoTDeviceType::Camera;
            } else if lower.contains("sonos")
                || lower.contains("amazon")
                || lower.contains("google")
            {
                if device.device_type == IoTDeviceType::UnknownIoT {
                    device.device_type = IoTDeviceType::SmartSpeaker;
                }
            } else if lower.contains("nest") || lower.contains("ecobee") {
                device.device_type = IoTDeviceType::Thermostat;
            } else if lower.contains("philips")
                || lower.contains("lifx")
                || lower.contains("sengled")
            {
                device.device_type = IoTDeviceType::LightBulb;
            } else if lower.contains("tp-link") || lower.contains("wemo") {
                device.device_type = IoTDeviceType::SmartPlug;
            } else if lower.contains("hp")
                || lower.contains("canon")
                || lower.contains("epson")
                || lower.contains("brother")
            {
                device.device_type = IoTDeviceType::Printer;
            }
        }
    }

    fn compute_risk(&self, device: &mut dashmap::mapref::one::RefMut<'_, IpAddr, IoTDevice>) {
        let mut risk: f64 = 0.0;
        let mut factors = Vec::new();

        // Factor 1: Unencrypted communication
        let has_unencrypted = device
            .protocols_used
            .iter()
            .any(|p| p == "Http" || p == "Telnet" || p == "Ftp");
        if has_unencrypted {
            risk += 25.0;
            factors.push("Uses unencrypted protocols".into());
        }

        // Factor 2: Industrial protocol without TLS
        let has_ics = device
            .protocols_used
            .iter()
            .any(|p| p == "Modbus" || p == "Opcua");
        if has_ics {
            risk += 30.0;
            factors.push("Industrial control protocol detected".into());
        }

        // Factor 3: Too many open ports
        if device.open_ports.len() > 10 {
            risk += 15.0;
            factors.push(format!("{} open ports detected", device.open_ports.len()));
        }

        // Factor 4: Default/common weak ports
        let weak_ports = [23, 21, 8080, 8443, 9100];
        let has_weak = device.open_ports.iter().any(|p| weak_ports.contains(p));
        if has_weak {
            risk += 20.0;
            factors.push("Commonly exploited ports open".into());
        }

        // Factor 5: Camera/medical/ICS are higher risk by nature
        match device.device_type {
            IoTDeviceType::Camera | IoTDeviceType::MedicalDevice => {
                risk += 15.0;
                factors.push("High-sensitivity device type".into());
            }
            IoTDeviceType::IndustrialController => {
                risk += 20.0;
                factors.push("Industrial control system".into());
            }
            _ => {}
        }

        device.risk_score = risk.min(100.0);
        device.risk_factors = factors;
    }

    pub fn get_devices(&self) -> Vec<IoTDevice> {
        self.devices.iter().map(|e| e.value().clone()).collect()
    }

    pub fn get_device(&self, ip: &IpAddr) -> Option<IoTDevice> {
        self.devices.get(ip).map(|e| e.value().clone())
    }

    pub fn device_count(&self) -> usize {
        self.devices.len()
    }

    pub fn high_risk_devices(&self) -> Vec<IoTDevice> {
        self.devices
            .iter()
            .filter(|e| e.value().risk_score >= 50.0)
            .map(|e| e.value().clone())
            .collect()
    }
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn build_oui_database() -> HashMap<String, &'static str> {
    let mut db = HashMap::new();
    // Common IoT manufacturer OUIs
    db.insert("B0A7B9".into(), "Amazon (Ring/Echo)");
    db.insert("A4CF12".into(), "Google (Nest/Home)");
    db.insert("7C2EBD".into(), "Google");
    db.insert("F4F5D8".into(), "Google");
    db.insert("30B49E".into(), "TP-Link");
    db.insert("B09FBA".into(), "TP-Link");
    db.insert("E8DE27".into(), "TP-Link");
    db.insert("441CB8".into(), "Sonos");
    db.insert("B8E937".into(), "Sonos");
    db.insert("5CCF7F".into(), "Espressif (ESP8266/ESP32)");
    db.insert("240AC4".into(), "Espressif");
    db.insert("3C71BF".into(), "Espressif");
    db.insert("D8BFC0".into(), "Philips Hue");
    db.insert("00178A".into(), "Hikvision");
    db.insert("C0567C".into(), "Hikvision");
    db.insert("BC3400".into(), "Dahua");
    db.insert("E0B9A5".into(), "Arlo");
    db.insert("08EA40".into(), "Shenzhen Bilian");
    db.insert("60D1AA".into(), "Ecobee");
    db.insert("001788".into(), "Axis Communications (Camera)");
    db.insert("000E8F".into(), "Cisco (SMB)");
    db.insert("DC4F22".into(), "Espressif");
    db.insert("002722".into(), "Ubiquiti");
    db.insert("788A20".into(), "Ubiquiti");
    db.insert("B4FBE4".into(), "Ubiquiti");
    db.insert("18B430".into(), "Nest Labs");
    db.insert("641666".into(), "Nest Labs");
    db.insert("AC233F".into(), "Shenzhen Minew");
    db.insert("30AEA4".into(), "Samsung (SmartThings)");
    db
}

fn build_port_fingerprints() -> HashMap<u16, IoTDeviceType> {
    let mut db = HashMap::new();
    db.insert(554, IoTDeviceType::Camera); // RTSP
    db.insert(8554, IoTDeviceType::Camera); // RTSP alternate
    db.insert(37777, IoTDeviceType::Camera); // Dahua
    db.insert(8000, IoTDeviceType::Camera); // Hikvision
    db.insert(9100, IoTDeviceType::Printer); // Raw printing
    db.insert(631, IoTDeviceType::Printer); // IPP
    db.insert(502, IoTDeviceType::IndustrialController); // Modbus
    db.insert(4840, IoTDeviceType::IndustrialController); // OPC-UA
    db.insert(47808, IoTDeviceType::IndustrialController); // BACnet
    db.insert(1883, IoTDeviceType::Sensor); // MQTT
    db.insert(8883, IoTDeviceType::Sensor); // MQTT/TLS
    db.insert(5683, IoTDeviceType::Sensor); // CoAP
    db
}
