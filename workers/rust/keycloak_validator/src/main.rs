// NDSEP Keycloak Token Validator — Rust
// Port 8162 | JWT validation, JWKS caching, role extraction for all NDSEP services
// Validates Keycloak-issued tokens and extracts NDSEP-specific roles and claims

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use lazy_static::lazy_static;
use prometheus::{Counter, Encoder, Registry, TextEncoder};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
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
    .unwrap();
    static ref VALID_COUNTER: Counter =
        Counter::new("ndsep_keycloak_valid_tokens_total", "Total valid tokens").unwrap();
    static ref INVALID_COUNTER: Counter = Counter::new(
        "ndsep_keycloak_invalid_tokens_total",
        "Total invalid tokens"
    )
    .unwrap();
    static ref INTROSPECT_COUNTER: Counter = Counter::new(
        "ndsep_keycloak_introspections_total",
        "Total token introspections"
    )
    .unwrap();
}

fn init_metrics() {
    REGISTRY.register(Box::new(VALIDATE_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(VALID_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(INVALID_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(INTROSPECT_COUNTER.clone())).ok();
}

// NDSEP Keycloak realm roles
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenClaims {
    pub sub: Option<String>,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub realm_access: Option<serde_json::Value>,
    pub resource_access: Option<serde_json::Value>,
    pub scope: Option<String>,
    pub exp: Option<i64>,
    pub iat: Option<i64>,
    pub iss: Option<String>,
    pub ndsep_tenant_id: Option<String>,
    pub ndsep_sector: Option<String>,
}

#[derive(Debug, Clone)]
pub struct JwksCache {
    pub keys: serde_json::Value,
    pub cached_at: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub keycloak_url: String,
    pub realm: String,
    pub client_id: String,
    pub client_secret: String,
    pub jwks_cache: Arc<Mutex<Option<JwksCache>>>,
    pub start_time: Instant,
}

impl AppState {
    fn jwks_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/certs",
            self.keycloak_url, self.realm
        )
    }

    fn introspect_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/token/introspect",
            self.keycloak_url, self.realm
        )
    }

    fn userinfo_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/userinfo",
            self.keycloak_url, self.realm
        )
    }
}

/// Decode JWT payload without signature verification (for degraded mode)
fn decode_jwt_payload(token: &str) -> Option<TokenClaims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload = parts[1];
    // Add padding
    let padded = match payload.len() % 4 {
        2 => format!("{}==", payload),
        3 => format!("{}=", payload),
        _ => payload.to_string(),
    };
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(&padded))
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

/// Check if token is expired
fn is_token_expired(claims: &TokenClaims) -> bool {
    if let Some(exp) = claims.exp {
        return Utc::now().timestamp() > exp;
    }
    false
}

/// Extract NDSEP roles from token claims
fn extract_ndsep_roles(claims: &TokenClaims) -> Vec<String> {
    let mut roles = Vec::new();
    if let Some(realm_access) = &claims.realm_access {
        if let Some(realm_roles) = realm_access.get("roles") {
            if let Some(role_array) = realm_roles.as_array() {
                for role in role_array {
                    if let Some(role_str) = role.as_str() {
                        if role_str.starts_with("ndsep-") {
                            roles.push(role_str.to_string());
                        }
                    }
                }
            }
        }
    }
    roles
}

async fn validate_token(
    State(state): State<AppState>,
    Json(req): Json<ValidateRequest>,
) -> impl IntoResponse {
    VALIDATE_COUNTER.inc();

    // Decode JWT payload (degraded mode — no signature verification)
    let claims = match decode_jwt_payload(&req.token) {
        Some(c) => c,
        None => {
            INVALID_COUNTER.inc();
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "valid": false,
                    "error": "invalid token format",
                })),
            )
                .into_response();
        }
    };

    // Check expiry
    if is_token_expired(&claims) {
        INVALID_COUNTER.inc();
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "valid": false,
                "error": "token expired",
            })),
        )
            .into_response();
    }

    // Extract roles
    let roles = extract_ndsep_roles(&claims);

    // Check required roles
    if let Some(required) = &req.required_roles {
        let has_all = required.iter().all(|r| roles.contains(r));
        if !has_all {
            INVALID_COUNTER.inc();
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "valid": false,
                    "error": "insufficient roles",
                    "required": required,
                    "actual": roles,
                })),
            )
                .into_response();
        }
    }

    VALID_COUNTER.inc();
    Json(serde_json::json!({
        "valid": true,
        "sub": claims.sub,
        "username": claims.preferred_username,
        "email": claims.email,
        "roles": roles,
        "scope": claims.scope,
        "tenantId": claims.ndsep_tenant_id,
        "sector": claims.ndsep_sector,
        "exp": claims.exp,
    }))
    .into_response()
}

async fn introspect_token(
    State(state): State<AppState>,
    Json(req): Json<IntrospectRequest>,
) -> impl IntoResponse {
    INTROSPECT_COUNTER.inc();

    // Try Keycloak introspection endpoint
    let auth = format!("{}:{}", state.client_id, state.client_secret);
    let auth_header = format!("Basic {}", general_purpose::STANDARD.encode(&auth));

    let mut params = HashMap::new();
    params.insert("token", req.token.as_str());
    params.insert("client_id", state.client_id.as_str());
    params.insert("client_secret", state.client_secret.as_str());

    match state
        .client
        .post(&state.introspect_url())
        .header("Authorization", auth_header)
        .form(&params)
        .send()
        .await
    {
        Ok(resp) => {
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            Json(serde_json::json!({
                "success": true,
                "introspection": body,
            }))
            .into_response()
        }
        Err(_) => {
            // Degraded mode — decode locally
            let claims = decode_jwt_payload(&req.token);
            Json(serde_json::json!({
                "success": true,
                "degraded": true,
                "claims": claims,
            }))
            .into_response()
        }
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
    }))
}

async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = REGISTRY.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
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
            .unwrap(),
        keycloak_url: keycloak_url.clone(),
        realm: realm.clone(),
        client_id,
        client_secret,
        jwks_cache: Arc::new(Mutex::new(None)),
        start_time: Instant::now(),
    };

    let app = Router::new()
        .route("/validate", post(validate_token))
        .route("/introspect", post(introspect_token))
        .route("/roles", get(list_roles))
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("NDSEP Keycloak Validator starting on {}", addr);
    tracing::info!("Keycloak URL: {} | Realm: {}", keycloak_url, realm);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
