use axum::{http::StatusCode, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Serialize)]
struct HealthResponse {
    service: &'static str,
    language: &'static str,
    middleware: Vec<&'static str>,
    status: &'static str,
    mode: &'static str,
    disclaimer: &'static str,
}

#[derive(Deserialize)]
struct PolicyRequest {
    subject: String,
    action: String,
    resource: String,
    agency_count: u32,
}

#[derive(Serialize)]
struct PolicyDecision {
    allowed: bool,
    trace_id: String,
    rationale: String,
    provenance: &'static str,
    requires_review: bool,
}

async fn health() -> Json<HealthResponse> {
	let emulator = env::var("IDLR_EMULATOR_MODE").map(|value| value == "true").unwrap_or(false);
    Json(HealthResponse {
        service: "rust-policy-engine",
        language: "rust",
        middleware: vec!["permify", "apisix"],
        status: if emulator { "emulator" } else { "unconfigured" },
        mode: if emulator { "development_only" } else { "fail_closed" },
        disclaimer: "This service does not prove a Permify, APISIX, or enterprise policy connection.",
    })
}

async fn evaluate(Json(request): Json<PolicyRequest>) -> Result<Json<PolicyDecision>, (StatusCode, Json<serde_json::Value>)> {
    if env::var("IDLR_EMULATOR_MODE").map(|value| value != "true").unwrap_or(true) {
        return Err((StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "error": "policy_engine_unconfigured",
            "detail": "Set IDLR_EMULATOR_MODE=true only for labelled local simulation; connect a real policy service for production."
        }))));
    }
    let allowed = request.action != "approve" || request.agency_count >= 1;
    Ok(Json(PolicyDecision {
        allowed,
        trace_id: format!("policy-{}-{}", request.subject, request.resource),
        rationale: if allowed {
			format!("{} can {} {} only in the labelled deterministic development emulator.", request.subject, request.action, request.resource)
        } else {
            "Policy denied due to missing agency context.".to_string()
        },
        provenance: "deterministic_development_emulator",
        requires_review: true,
    }))
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(health))
        .route("/evaluate", post(evaluate));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8092").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
