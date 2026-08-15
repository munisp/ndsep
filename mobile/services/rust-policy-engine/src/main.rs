use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct HealthResponse {
    service: &'static str,
    language: &'static str,
    middleware: Vec<&'static str>,
    status: &'static str,
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
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "rust-policy-engine",
        language: "rust",
        middleware: vec!["permify", "apisix"],
        status: "healthy",
    })
}

async fn evaluate(Json(request): Json<PolicyRequest>) -> Json<PolicyDecision> {
    let allowed = request.action != "approve" || request.agency_count >= 1;
    Json(PolicyDecision {
        allowed,
        trace_id: format!("policy-{}-{}", request.subject, request.resource),
        rationale: if allowed {
            format!("{} can {} {} after deterministic policy evaluation.", request.subject, request.action, request.resource)
        } else {
            "Policy denied due to missing agency context.".to_string()
        },
    })
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(health))
        .route("/evaluate", post(evaluate));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8092").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
