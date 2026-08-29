//! NDSEP Keycloak validator.
//!
//! The validator delegates token validation to Keycloak's authenticated token
//! introspection endpoint. It intentionally fails closed when Keycloak is
//! unreachable or returns an inactive token; it never trusts unsigned JWT
//! payloads as a production fallback.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use lazy_static::lazy_static;
use prometheus::{Counter, Encoder, Registry, TextEncoder};
use reqwest::Client;
use serde::Deserialize;
use std::{
    env,
    time::{Duration, Instant},
};

fn get_env(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

lazy_static! {
    static ref REGISTRY: Registry = Registry::new();
    static ref VALIDATE_COUNTER: Counter = Counter::new(
        "ndsep_keycloak_validations_total",
        "Total token validations"
    )
    .expect("validation metric definition must be valid");
    static ref VALID_COUNTER: Counter =
        Counter::new("ndsep_keycloak_valid_tokens_total", "Total valid tokens")
            .expect("valid-token metric definition must be valid");
    static ref INVALID_COUNTER: Counter = Counter::new(
        "ndsep_keycloak_invalid_tokens_total",
        "Total invalid tokens"
    )
    .expect("invalid-token metric definition must be valid");
    static ref INTROSPECT_COUNTER: Counter = Counter::new(
        "ndsep_keycloak_introspections_total",
        "Total token introspections"
    )
    .expect("introspection metric definition must be valid");
}

fn init_metrics() {
    let _ = REGISTRY.register(Box::new(VALIDATE_COUNTER.clone()));
    let _ = REGISTRY.register(Box::new(VALID_COUNTER.clone()));
    let _ = REGISTRY.register(Box::new(INVALID_COUNTER.clone()));
    let _ = REGISTRY.register(Box::new(INTROSPECT_COUNTER.clone()));
}

const NDSEP_ROLES: &[&str] = &[
    "ndsep-admin",
    "ndsep-compliance-officer",
    "ndsep-analyst",
    "ndsep-auditor",
    "ndsep-regulator",
    "ndsep-institution-user",
    "ndsep-readonly",
    "ndsep-api-client",
    "ndsep-sector-energy",
    "ndsep-sector-fintech",
    "ndsep-sector-healthcare",
    "ndsep-sector-insurance",
    "ndsep-sector-telecom",
    "ndsep-sector-banking",
];

#[derive(Debug, Deserialize)]
pub struct ValidateRequest {
    pub token: String,
    pub required_roles: Option<Vec<String>>,
    pub required_scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IntrospectRequest {
    pub token: String,
}

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub keycloak_url: String,
    pub realm: String,
    pub client_id: String,
    pub client_secret: String,
    pub start_time: Instant,
}

impl AppState {
    fn introspect_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/token/introspect",
            self.keycloak_url, self.realm
        )
    }
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn error_response(status: StatusCode, message: &str) -> ApiError {
    (
        status,
        Json(serde_json::json!({"success": false, "error": message})),
    )
}

async fn active_token_claims(state: &AppState, token: &str) -> Result<serde_json::Value, ApiError> {
    let response = state
        .client
        .post(state.introspect_url())
        .basic_auth(&state.client_id, Some(&state.client_secret))
        .form(&[("token", token), ("client_id", state.client_id.as_str())])
        .send()
        .await
        .map_err(|_| {
            error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "Keycloak introspection is unavailable",
            )
        })?;

    if !response.status().is_success() {
        return Err(error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Keycloak introspection returned an unsuccessful response",
        ));
    }

    let claims: serde_json::Value = response.json().await.map_err(|_| {
        error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Keycloak returned an invalid introspection response",
        )
    })?;

    if claims.get("active").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "token is inactive or invalid",
        ));
    }

    Ok(claims)
}

fn roles_from_claims(claims: &serde_json::Value) -> Vec<String> {
    claims
        .pointer("/realm_access/roles")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .filter(|role| role.starts_with("ndsep-"))
        .map(ToString::to_string)
        .collect()
}

fn scopes_from_claims(claims: &serde_json::Value) -> Vec<&str> {
    claims
        .get("scope")
        .and_then(serde_json::Value::as_str)
        .map(|scope| scope.split_whitespace().collect())
        .unwrap_or_default()
}

async fn validate_token(
    State(state): State<AppState>,
    Json(req): Json<ValidateRequest>,
) -> impl IntoResponse {
    VALIDATE_COUNTER.inc();
    let claims = match active_token_claims(&state, &req.token).await {
        Ok(claims) => claims,
        Err(error) => {
            INVALID_COUNTER.inc();
            return error.into_response();
        }
    };

    let roles = roles_from_claims(&claims);
    if let Some(required_roles) = &req.required_roles {
        if !required_roles.iter().all(|role| roles.contains(role)) {
            INVALID_COUNTER.inc();
            return error_response(
                StatusCode::FORBIDDEN,
                "token is missing a required NDSEP role",
            )
            .into_response();
        }
    }

    if let Some(required_scope) = req.required_scope.as_deref() {
        if !scopes_from_claims(&claims).contains(&required_scope) {
            INVALID_COUNTER.inc();
            return error_response(StatusCode::FORBIDDEN, "token is missing a required scope")
                .into_response();
        }
    }

    VALID_COUNTER.inc();
    Json(serde_json::json!({
        "valid": true,
        "sub": claims.get("sub"),
        "username": claims.get("preferred_username"),
        "email": claims.get("email"),
        "roles": roles,
        "scope": claims.get("scope"),
        "tenantId": claims.get("ndsep_tenant_id"),
        "sector": claims.get("ndsep_sector"),
        "exp": claims.get("exp"),
    }))
    .into_response()
}

async fn introspect_token(
    State(state): State<AppState>,
    Json(req): Json<IntrospectRequest>,
) -> impl IntoResponse {
    INTROSPECT_COUNTER.inc();
    match active_token_claims(&state, &req.token).await {
        Ok(claims) => {
            Json(serde_json::json!({"success": true, "introspection": claims})).into_response()
        }
        Err(error) => error.into_response(),
    }
}

async fn list_roles() -> impl IntoResponse {
    Json(serde_json::json!({
        "roles": NDSEP_ROLES,
        "count": NDSEP_ROLES.len(),
        "realm": "ndsep",
    }))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "ndsep-keycloak-validator",
        "version": "1.0.0",
        "uptime": state.start_time.elapsed().as_secs(),
        "keycloak_url": state.keycloak_url,
        "realm": state.realm,
        "roles_defined": NDSEP_ROLES.len(),
        "validation_mode": "remote_introspection_fail_closed",
    }))
}

async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    let _ = encoder.encode(&metric_families, &mut buffer);
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        String::from_utf8(buffer).unwrap_or_default(),
    )
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    init_metrics();

    let port = get_env("KEYCLOAK_VALIDATOR_PORT", "8162");
    let keycloak_url = get_env("KEYCLOAK_URL", "http://localhost:8080");
    let realm = get_env("KEYCLOAK_REALM", "ndsep");
    let client_id = get_env("KEYCLOAK_CLIENT_ID", "ndsep-backend");
    let client_secret = match std::env::var("KEYCLOAK_CLIENT_SECRET") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => panic!("KEYCLOAK_CLIENT_SECRET is required for Keycloak validation"),
    };

    let state = AppState {
        client: Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Keycloak HTTP client must initialize"),
        keycloak_url: keycloak_url.clone(),
        realm: realm.clone(),
        client_id,
        client_secret,
        start_time: Instant::now(),
    };

    let app = Router::new()
        .route("/validate", post(validate_token))
        .route("/introspect", post(introspect_token))
        .route("/roles", get(list_roles))
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .with_state(state);

    let address = format!("0.0.0.0:{port}");
    tracing::info!("NDSEP Keycloak validator starting on {address}");
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .expect("Keycloak validator socket must bind");
    axum::serve(listener, app)
        .await
        .expect("Keycloak validator server must remain available");
}
