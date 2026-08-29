/*!
NDSEP Network Intelligence Engine (wiredigg-rs)
Real-time packet capture, protocol dissection, ML anomaly detection,
threat classification, and IoT device fingerprinting.

Built from scratch in Rust — inspired by Wiredigg (Python/tkinter) but designed
as a headless microservice with REST API for NDSEP platform integration.

Port: 8160
*/

mod analysis;
mod api;
mod capture;
mod models;
mod protocol;

use std::env;
use std::net::SocketAddr;

use log::{info, warn};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use analysis::anomaly::AnomalyDetector;
use analysis::iot::IoTDetector;
use analysis::threat::ThreatClassifier;
use api::AppState;
use capture::engine::CaptureEngine;

fn start_live_analysis(state: &AppState) {
    let mut packet_events = state.capture.sender.subscribe();
    let analysis_state = state.clone();

    tokio::spawn(async move {
        loop {
            match packet_events.recv().await {
                Ok(packet) => {
                    let anomaly = analysis_state.anomaly.analyze(&packet);
                    if anomaly.is_anomalous {
                        analysis_state
                            .capture
                            .anomaly_count
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }

                    let threats = analysis_state.threat.classify(&packet);
                    if !threats.is_empty() {
                        analysis_state
                            .capture
                            .threat_count
                            .fetch_add(threats.len() as u64, std::sync::atomic::Ordering::Relaxed);
                    }

                    analysis_state.iot.process_packet(&packet);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    warn!("wiredigg analysis dropped {count} buffered packets");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[tokio::main]
async fn main() {
    // Initialize logging
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "info,wiredigg=debug");
    }
    tracing_subscriber::fmt::init();

    let port: u16 = env::var("WIREDIGG_PORT")
        .unwrap_or_else(|_| "8160".into())
        .parse()
        .unwrap_or(8160);

    let max_packets: usize = env::var("WIREDIGG_MAX_PACKETS")
        .unwrap_or_else(|_| "100000".into())
        .parse()
        .unwrap_or(100_000);

    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    info!("  NDSEP Network Intelligence Engine (wiredigg-rs)");
    info!("  Port: {}", port);
    info!("  Max packets buffer: {}", max_packets);
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Initialize engines
    let capture = CaptureEngine::new(max_packets);
    let anomaly = AnomalyDetector::new();
    let threat = ThreatClassifier::new();
    let iot = IoTDetector::new();

    // Log available interfaces
    let interfaces = CaptureEngine::list_interfaces();
    info!("Available network interfaces:");
    for iface in &interfaces {
        info!(
            "  {} — IPs: [{}] MAC: {}",
            iface.name,
            iface.ips.join(", "),
            iface.mac.as_deref().unwrap_or("N/A")
        );
    }

    let state = AppState {
        capture,
        anomaly,
        threat,
        iot,
    };

    start_live_analysis(&state);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = api::build_router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
