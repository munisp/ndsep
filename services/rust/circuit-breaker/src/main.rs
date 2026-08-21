use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Clone, Debug, Serialize)]
pub struct CircuitStatus {
    pub name: String,
    pub state: CircuitState,
    pub failure_count: u64,
    pub success_count: u64,
    pub last_failure: Option<String>,
}

struct AppState {
    circuits: RwLock<Vec<CircuitStatus>>,
}

async fn health() -> &'static str {
    "OK"
}

async fn list_circuits(State(state): State<Arc<AppState>>) -> Json<Vec<CircuitStatus>> {
    let circuits = state.circuits.read().await;
    Json(circuits.clone())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let state = Arc::new(AppState {
        circuits: RwLock::new(vec![
            CircuitStatus {
                name: "database".into(),
                state: CircuitState::Closed,
                failure_count: 0,
                success_count: 1542,
                last_failure: None,
            },
            CircuitStatus {
                name: "redis-cache".into(),
                state: CircuitState::Closed,
                failure_count: 2,
                success_count: 8934,
                last_failure: Some("2026-06-07T10:30:00Z".into()),
            },
        ]),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/circuits", get(list_circuits))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 8090));
    tracing::info!("Circuit breaker service on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
