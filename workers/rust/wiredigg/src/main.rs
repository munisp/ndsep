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

use log::info;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use analysis::anomaly::AnomalyDetector;
use analysis::iot::IoTDetector;
use analysis::threat::ThreatClassifier;
use api::AppState;
use capture::engine::CaptureEngine;

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
