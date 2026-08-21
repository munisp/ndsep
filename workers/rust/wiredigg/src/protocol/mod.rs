use crate::models::packet::{AppProtocol, CapturedPacket};

pub fn dissect_tcp_payload(payload: &[u8], sport: u16, dport: u16, packet: &mut CapturedPacket) {
    if payload.is_empty() {
        return;
    }

    // HTTP detection
    if is_http(payload, sport, dport) {
        parse_http(payload, packet);
        return;
    }

    // TLS/SSL detection
    if is_tls(payload) {
        parse_tls(payload, packet);
        return;
    }

    // SSH banner
    if payload.starts_with(b"SSH-") {
        packet.application_protocol = Some(AppProtocol::Ssh);
        if let Ok(banner) = std::str::from_utf8(&payload[..payload.len().min(64)]) {
            packet.payload_preview = Some(banner.trim().to_string());
        }
        return;
    }

    // SMTP
    if dport == 25 || dport == 587 || sport == 25 || sport == 587 {
        packet.application_protocol = Some(AppProtocol::Smtp);
        extract_ascii_preview(payload, packet);
        return;
    }

    // SMB
    if (dport == 445 || sport == 445)
        && payload.len() >= 4
        && payload[0..4] == [0xFF, b'S', b'M', b'B']
    {
        packet.application_protocol = Some(AppProtocol::Smb);
        packet.payload_preview = Some("SMB protocol".to_string());
        return;
    }

    // SMB2
    if (dport == 445 || sport == 445)
        && payload.len() >= 4
        && payload[0..4] == [0xFE, b'S', b'M', b'B']
    {
        packet.application_protocol = Some(AppProtocol::Smb);
        packet.payload_preview = Some("SMB2 protocol".to_string());
        return;
    }

    // MQTT
    if dport == 1883 || dport == 8883 || sport == 1883 || sport == 8883 {
        packet.application_protocol = Some(AppProtocol::Mqtt);
        if !payload.is_empty() {
            let msg_type = (payload[0] >> 4) & 0x0F;
            let type_name = match msg_type {
                1 => "CONNECT",
                2 => "CONNACK",
                3 => "PUBLISH",
                4 => "PUBACK",
                8 => "SUBSCRIBE",
                9 => "SUBACK",
                12 => "PINGREQ",
                13 => "PINGRESP",
                14 => "DISCONNECT",
                _ => "UNKNOWN",
            };
            packet.payload_preview = Some(format!("MQTT {}", type_name));
        }
        return;
    }

    // Modbus TCP
    if dport == 502 || sport == 502 {
        packet.application_protocol = Some(AppProtocol::Modbus);
        if payload.len() >= 8 {
            let func_code = payload[7];
            let func_name = match func_code {
                1 => "Read Coils",
                2 => "Read Discrete Inputs",
                3 => "Read Holding Registers",
                4 => "Read Input Registers",
                5 => "Write Single Coil",
                6 => "Write Single Register",
                15 => "Write Multiple Coils",
                16 => "Write Multiple Registers",
                _ => "Unknown Function",
            };
            packet.payload_preview = Some(format!("Modbus: {}", func_name));
        }
        return;
    }

    extract_ascii_preview(payload, packet);
}

pub fn dissect_udp_payload(payload: &[u8], sport: u16, dport: u16, packet: &mut CapturedPacket) {
    if payload.is_empty() {
        return;
    }

    // DNS
    if dport == 53 || sport == 53 || dport == 5353 || sport == 5353 {
        if dport == 5353 || sport == 5353 {
            packet.application_protocol = Some(AppProtocol::Mdns);
        } else {
            packet.application_protocol = Some(AppProtocol::Dns);
        }
        parse_dns(payload, packet);
        return;
    }

    // DHCP
    if dport == 67 || dport == 68 || sport == 67 || sport == 68 {
        packet.application_protocol = Some(AppProtocol::Dhcp);
        if payload.len() >= 2 {
            let msg_type = payload[0];
            packet.payload_preview = Some(match msg_type {
                1 => "DHCP Request (BOOTREQUEST)".to_string(),
                2 => "DHCP Reply (BOOTREPLY)".to_string(),
                _ => format!("DHCP msg_type={}", msg_type),
            });
        }
        return;
    }

    // NTP
    if dport == 123 || sport == 123 {
        packet.application_protocol = Some(AppProtocol::Ntp);
        if !payload.is_empty() {
            let version = (payload[0] >> 3) & 0x07;
            let mode = payload[0] & 0x07;
            let mode_str = match mode {
                3 => "Client",
                4 => "Server",
                6 => "Control",
                7 => "Private",
                _ => "Unknown",
            };
            packet.payload_preview = Some(format!("NTP v{} mode={}", version, mode_str));
        }
        return;
    }

    // SSDP
    if dport == 1900 || sport == 1900 {
        packet.application_protocol = Some(AppProtocol::Ssdp);
        extract_ascii_preview(payload, packet);
        return;
    }

    // SNMP
    if dport == 161 || dport == 162 || sport == 161 || sport == 162 {
        packet.application_protocol = Some(AppProtocol::Snmp);
        packet.payload_preview = Some("SNMP packet".to_string());
        return;
    }

    // Syslog
    if dport == 514 || sport == 514 {
        packet.application_protocol = Some(AppProtocol::Syslog);
        extract_ascii_preview(payload, packet);
        return;
    }

    // CoAP
    if dport == 5683 || sport == 5683 {
        packet.application_protocol = Some(AppProtocol::Coap);
        if payload.len() >= 4 {
            let ver = payload[0] >> 6;
            let code_class = payload[1] >> 5;
            let code_detail = payload[1] & 0x1F;
            packet.payload_preview =
                Some(format!("CoAP v{} {}.{:02}", ver, code_class, code_detail));
        }
        return;
    }

    // SIP
    if dport == 5060 || sport == 5060 {
        packet.application_protocol = Some(AppProtocol::Sip);
        extract_ascii_preview(payload, packet);
        return;
    }

    extract_ascii_preview(payload, packet);
}

fn is_http(payload: &[u8], _sport: u16, _dport: u16) -> bool {
    if payload.len() < 4 {
        return false;
    }
    payload.starts_with(b"GET ")
        || payload.starts_with(b"POST ")
        || payload.starts_with(b"PUT ")
        || payload.starts_with(b"DELETE ")
        || payload.starts_with(b"HEAD ")
        || payload.starts_with(b"OPTIONS ")
        || payload.starts_with(b"PATCH ")
        || payload.starts_with(b"HTTP/")
}

fn parse_http(payload: &[u8], packet: &mut CapturedPacket) {
    packet.application_protocol = Some(AppProtocol::Http);

    if let Ok(text) = std::str::from_utf8(&payload[..payload.len().min(2048)]) {
        let lines: Vec<&str> = text.lines().collect();
        if let Some(first_line) = lines.first() {
            let parts: Vec<&str> = first_line.splitn(3, ' ').collect();
            if parts.len() >= 2 {
                if parts[0].starts_with("HTTP/") {
                    // Response
                    packet.payload_preview = Some(format!("{} {}", parts[0], parts[1]));
                } else {
                    // Request
                    packet.http_method = Some(parts[0].to_string());
                    packet.http_uri = Some(parts[1].to_string());
                }
            }
        }

        for line in &lines {
            let lower = line.to_lowercase();
            if lower.starts_with("host:") {
                packet.http_host = Some(line[5..].trim().to_string());
            }
        }

        if packet.payload_preview.is_none() {
            packet.payload_preview = lines.first().map(|l| l.to_string());
        }
    }
}

fn is_tls(payload: &[u8]) -> bool {
    if payload.len() < 6 {
        return false;
    }
    // TLS record: content type 20-23, version 3.x
    let content_type = payload[0];
    let major = payload[1];
    let minor = payload[2];
    (20..=23).contains(&content_type) && major == 3 && minor <= 4
}

fn parse_tls(payload: &[u8], packet: &mut CapturedPacket) {
    packet.application_protocol = Some(AppProtocol::Https);

    if payload.len() < 6 {
        return;
    }

    let content_type = payload[0];
    let major = payload[1];
    let minor = payload[2];

    let version = match (major, minor) {
        (3, 0) => "SSL 3.0",
        (3, 1) => "TLS 1.0",
        (3, 2) => "TLS 1.1",
        (3, 3) => "TLS 1.2",
        (3, 4) => "TLS 1.3",
        _ => "TLS Unknown",
    };
    packet.tls_version = Some(version.to_string());

    // Try to extract SNI from ClientHello
    if content_type == 22 && payload.len() > 43 {
        // Handshake type 1 = ClientHello
        if payload.len() > 5 && payload[5] == 1 {
            if let Some(sni) = extract_sni(payload) {
                packet.tls_sni = Some(sni.clone());
                packet.payload_preview = Some(format!("{} → {}", version, sni));
                return;
            }
        }
    }

    let type_name = match content_type {
        20 => "ChangeCipherSpec",
        21 => "Alert",
        22 => "Handshake",
        23 => "ApplicationData",
        _ => "Unknown",
    };
    packet.payload_preview = Some(format!("{} {}", version, type_name));
}

fn extract_sni(payload: &[u8]) -> Option<String> {
    // Skip TLS record header (5 bytes) + handshake header (4 bytes)
    // + client version (2) + random (32) = offset 43
    if payload.len() < 44 {
        return None;
    }
    let mut pos = 43usize;

    // Skip session ID
    if pos >= payload.len() {
        return None;
    }
    let session_len = payload[pos] as usize;
    pos += 1 + session_len;

    // Skip cipher suites
    if pos + 2 > payload.len() {
        return None;
    }
    let cipher_len = u16::from_be_bytes([payload[pos], payload[pos + 1]]) as usize;
    pos += 2 + cipher_len;

    // Skip compression methods
    if pos >= payload.len() {
        return None;
    }
    let comp_len = payload[pos] as usize;
    pos += 1 + comp_len;

    // Extensions
    if pos + 2 > payload.len() {
        return None;
    }
    let ext_total_len = u16::from_be_bytes([payload[pos], payload[pos + 1]]) as usize;
    pos += 2;
    let ext_end = pos + ext_total_len;

    while pos + 4 <= ext_end && pos + 4 <= payload.len() {
        let ext_type = u16::from_be_bytes([payload[pos], payload[pos + 1]]);
        let ext_len = u16::from_be_bytes([payload[pos + 2], payload[pos + 3]]) as usize;
        pos += 4;

        if ext_type == 0 {
            // SNI extension
            if pos + 5 <= payload.len() && pos + ext_len <= payload.len() {
                // server_name_list_length (2) + type (1) + name_length (2)
                let name_len = u16::from_be_bytes([payload[pos + 3], payload[pos + 4]]) as usize;
                let name_start = pos + 5;
                if name_start + name_len <= payload.len() {
                    if let Ok(name) =
                        std::str::from_utf8(&payload[name_start..name_start + name_len])
                    {
                        return Some(name.to_string());
                    }
                }
            }
        }
        pos += ext_len;
    }
    None
}

fn parse_dns(payload: &[u8], packet: &mut CapturedPacket) {
    if let Ok(dns) = dns_parser::Packet::parse(payload) {
        if !dns.questions.is_empty() {
            let q = &dns.questions[0];
            let name = q.qname.to_string();
            packet.dns_query = Some(name.clone());
            let qtype = format!("{:?}", q.qtype);
            packet.payload_preview = Some(format!("DNS {} {}", qtype, name));
        } else if !dns.answers.is_empty() {
            let mut answers: Vec<String> = Vec::new();
            for a in &dns.answers {
                answers.push(format!("{}: {:?}", a.name, a.data));
            }
            packet.payload_preview = Some(format!("DNS Response: {}", answers.join(", ")));
        }
    }
}

fn extract_ascii_preview(payload: &[u8], packet: &mut CapturedPacket) {
    let preview_len = payload.len().min(128);
    let preview: String = payload[..preview_len]
        .iter()
        .map(|&b| {
            if b.is_ascii_graphic() || b == b' ' {
                b as char
            } else {
                '.'
            }
        })
        .collect();
    if preview.chars().filter(|c| c.is_ascii_graphic()).count() > preview_len / 3 {
        packet.payload_preview = Some(preview);
    }
}
