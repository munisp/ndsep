// NDSEP OpenSearch Indexer — Rust
// Port 8161 | Real-time compliance document indexing and full-text search
// Indexes: institutions, AML cases, KYC records, fines, accreditations, watchlist hits

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
use serde::Deserialize;
use std::{
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use uuid::Uuid;

fn get_env(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

lazy_static! {
    static ref REGISTRY: Registry = Registry::new();
    static ref INDEX_COUNTER: Counter =
        Counter::new("ndsep_opensearch_index_total", "Total documents indexed").unwrap();
    static ref SEARCH_COUNTER: Counter =
        Counter::new("ndsep_opensearch_search_total", "Total search queries").unwrap();
    static ref ERROR_COUNTER: Counter =
        Counter::new("ndsep_opensearch_errors_total", "Total errors").unwrap();
}

fn init_metrics() {
    REGISTRY.register(Box::new(INDEX_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(SEARCH_COUNTER.clone())).ok();
    REGISTRY.register(Box::new(ERROR_COUNTER.clone())).ok();
}

// NDSEP OpenSearch index definitions
const NDSEP_INDICES: &[(&str, &str)] = &[
    (
        "ndsep-institutions",
        r#"{"mappings":{"properties":{"name":{"type":"text","analyzer":"standard"},"rcNumber":{"type":"keyword"},"sector":{"type":"keyword"},"status":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-aml-cases",
        r#"{"mappings":{"properties":{"caseNumber":{"type":"keyword"},"entityName":{"type":"text"},"riskLevel":{"type":"keyword"},"status":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-kyc-records",
        r#"{"mappings":{"properties":{"fullName":{"type":"text"},"bvn":{"type":"keyword"},"nationality":{"type":"keyword"},"status":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-fines",
        r#"{"mappings":{"properties":{"entityName":{"type":"text"},"amount":{"type":"double"},"status":{"type":"keyword"},"sector":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-accreditations",
        r#"{"mappings":{"properties":{"entityName":{"type":"text"},"accreditationType":{"type":"keyword"},"state":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-watchlist-hits",
        r#"{"mappings":{"properties":{"entityName":{"type":"text"},"matchScore":{"type":"double"},"listType":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
    (
        "ndsep-audit-trail",
        r#"{"mappings":{"properties":{"action":{"type":"keyword"},"entityType":{"type":"keyword"},"userId":{"type":"keyword"},"timestamp":{"type":"date"},"details":{"type":"text"}}}}"#,
    ),
    (
        "ndsep-breach-notifications",
        r#"{"mappings":{"properties":{"severity":{"type":"keyword"},"status":{"type":"keyword"},"affectedSystems":{"type":"keyword"},"createdAt":{"type":"date"}}}}"#,
    ),
];

#[derive(Debug, Deserialize)]
pub struct IndexRequest {
    pub index: String,
    pub id: Option<String>,
    pub document: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub index: String,
    pub query: String,
    pub filters: Option<serde_json::Value>,
    pub size: Option<u32>,
    pub from: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct BulkIndexRequest {
    pub index: String,
    pub documents: Vec<serde_json::Value>,
}

#[derive(Clone)]
pub struct AppState {
    pub client: Client,
    pub opensearch_url: String,
    pub opensearch_auth: String,
    pub start_time: Instant,
    pub index_count: Arc<AtomicU64>,
}

impl AppState {
    fn auth_header(&self) -> String {
        if self.opensearch_auth.is_empty() {
            String::new()
        } else {
            format!(
                "Basic {}",
                general_purpose::STANDARD.encode(&self.opensearch_auth)
            )
        }
    }
}

async fn ensure_indices(state: &AppState) -> Result<(), String> {
    let mut failures = Vec::new();
    for (index_name, mapping) in NDSEP_INDICES {
        let url = format!("{}/{}", state.opensearch_url, index_name);
        let mut req = state
            .client
            .put(&url)
            .header("Content-Type", "application/json")
            .body(mapping.to_string());
        if !state.opensearch_auth.is_empty() {
            req = req.header("Authorization", state.auth_header());
        }
        match req.send().await {
            Ok(resp) => {
                if !(resp.status().is_success() || resp.status().as_u16() == 400) {
                    failures.push(format!("{} returned HTTP {}", index_name, resp.status()));
                }
            }
            Err(e) => {
                failures.push(format!("{} unavailable: {}", index_name, e));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

async fn index_document(
    State(state): State<AppState>,
    Json(req): Json<IndexRequest>,
) -> impl IntoResponse {
    let doc_id = req.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut doc = req.document.clone();
    if let Some(obj) = doc.as_object_mut() {
        obj.insert(
            "_indexed_at".to_string(),
            serde_json::json!(Utc::now().to_rfc3339()),
        );
        obj.insert("_source".to_string(), serde_json::json!("ndsep-indexer"));
    }

    let url = format!("{}/{}/_doc/{}", state.opensearch_url, req.index, doc_id);
    let mut http_req = state
        .client
        .put(&url)
        .header("Content-Type", "application/json")
        .json(&doc);
    if !state.opensearch_auth.is_empty() {
        http_req = http_req.header("Authorization", state.auth_header());
    }

    match http_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            INDEX_COUNTER.inc();
            state.index_count.fetch_add(1, Ordering::Relaxed);
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            Json(serde_json::json!({
                "success": true,
                "id": doc_id,
                "index": req.index,
                "result": body,
            }))
            .into_response()
        }
        Ok(resp) => {
            ERROR_COUNTER.inc();
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            tracing::error!(
                "OpenSearch rejected index write with HTTP {}: {}",
                status,
                detail
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "success": false,
                    "id": doc_id,
                    "index": req.index,
                    "error": format!("OpenSearch returned HTTP {}", status),
                })),
            )
                .into_response()
        }
        Err(error) => {
            ERROR_COUNTER.inc();
            tracing::error!("OpenSearch index request failed: {}", error);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "success": false,
                    "id": doc_id,
                    "index": req.index,
                    "error": "OpenSearch is unavailable",
                })),
            )
                .into_response()
        }
    }
}

async fn search_documents(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> impl IntoResponse {
    let size = req.size.unwrap_or(20);
    let from = req.from.unwrap_or(0);

    let query = serde_json::json!({
        "from": from,
        "size": size,
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": req.query,
                            "fields": ["*"],
                            "type": "best_fields",
                            "fuzziness": "AUTO"
                        }
                    }
                ],
                "filter": req.filters.unwrap_or(serde_json::json!([])),
            }
        },
        "highlight": {
            "fields": {"*": {}}
        }
    });

    let url = format!("{}/{}/_search", state.opensearch_url, req.index);
    let mut http_req = state
        .client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&query);
    if !state.opensearch_auth.is_empty() {
        http_req = http_req.header("Authorization", state.auth_header());
    }

    match http_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            SEARCH_COUNTER.inc();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            Json(serde_json::json!({
                "success": true,
                "results": body,
                "query": req.query,
                "index": req.index,
            }))
            .into_response()
        }
        Ok(resp) => {
            ERROR_COUNTER.inc();
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            tracing::error!(
                "OpenSearch rejected search with HTTP {}: {}",
                status,
                detail
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("OpenSearch returned HTTP {}", status),
                })),
            )
                .into_response()
        }
        Err(e) => {
            ERROR_COUNTER.inc();
            tracing::error!("OpenSearch search request failed: {}", e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "success": false,
                    "error": "OpenSearch is unavailable",
                })),
            )
                .into_response()
        }
    }
}

async fn bulk_index(
    State(state): State<AppState>,
    Json(req): Json<BulkIndexRequest>,
) -> impl IntoResponse {
    let mut ndjson = String::new();
    for doc in &req.documents {
        let id = Uuid::new_v4().to_string();
        ndjson.push_str(&format!(
            "{{\"index\":{{\"_index\":\"{}\",\"_id\":\"{}\"}}}}\n{}\n",
            req.index, id, doc
        ));
    }

    let url = format!("{}/_bulk", state.opensearch_url);
    let mut http_req = state
        .client
        .post(&url)
        .header("Content-Type", "application/x-ndjson")
        .body(ndjson);
    if !state.opensearch_auth.is_empty() {
        http_req = http_req.header("Authorization", state.auth_header());
    }

    match http_req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let count = req.documents.len() as u64;
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let rejected = body
                .get("errors")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            if rejected {
                ERROR_COUNTER.inc();
                tracing::error!("OpenSearch bulk write returned per-document failures");
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({
                        "success": false,
                        "indexed": 0,
                        "error": "OpenSearch bulk write rejected one or more documents",
                    })),
                )
                    .into_response();
            }
            INDEX_COUNTER.inc_by(count as f64);
            state.index_count.fetch_add(count, Ordering::Relaxed);
            Json(serde_json::json!({
                "success": true,
                "indexed": count,
                "index": req.index,
                "result": body,
            }))
            .into_response()
        }
        Ok(resp) => {
            ERROR_COUNTER.inc();
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            tracing::error!(
                "OpenSearch rejected bulk write with HTTP {}: {}",
                status,
                detail
            );
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "success": false,
                    "indexed": 0,
                    "error": format!("OpenSearch returned HTTP {}", status),
                })),
            )
                .into_response()
        }
        Err(e) => {
            ERROR_COUNTER.inc();
            tracing::error!("OpenSearch bulk request failed: {}", e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "success": false,
                    "indexed": 0,
                    "error": "OpenSearch is unavailable",
                })),
            )
                .into_response()
        }
    }
}

async fn list_indices(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "indices": NDSEP_INDICES.iter().map(|(name, _)| name).collect::<Vec<_>>(),
        "count": NDSEP_INDICES.len(),
    }))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.client.get(&state.opensearch_url).send().await {
        Ok(response) if response.status().is_success() => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "healthy",
                "service": "ndsep-opensearch-indexer",
                "version": "1.0.0",
                "uptime": state.start_time.elapsed().as_secs(),
                "indexed": state.index_count.load(Ordering::Relaxed),
                "indices": NDSEP_INDICES.len(),
                "opensearch_url": state.opensearch_url,
            })),
        )
            .into_response(),
        Ok(response) => {
            ERROR_COUNTER.inc();
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "unhealthy",
                    "service": "ndsep-opensearch-indexer",
                    "error": format!("OpenSearch returned HTTP {}", response.status()),
                })),
            )
                .into_response()
        }
        Err(_error) => {
            ERROR_COUNTER.inc();
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "unhealthy",
                    "service": "ndsep-opensearch-indexer",
                    "error": "OpenSearch is unavailable",
                })),
            )
                .into_response()
        }
    }
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

    let port = get_env("OPENSEARCH_INDEXER_PORT", "8161");
    let opensearch_url = get_env("OPENSEARCH_URL", "http://localhost:9200");
    let opensearch_user = get_env("OPENSEARCH_USER", "");
    let opensearch_pass = get_env("OPENSEARCH_PASSWORD", "");
    let production = env::var("APP_ENV").map(|value| value.eq_ignore_ascii_case("production")).unwrap_or(false)
        || env::var("NODE_ENV").map(|value| value.eq_ignore_ascii_case("production")).unwrap_or(false);
    if production && !opensearch_url.starts_with("https://") {
        tracing::error!("production OpenSearch requires an https:// OPENSEARCH_URL");
        std::process::exit(1);
    }
    if production && (opensearch_user.is_empty() || opensearch_pass.is_empty()) {
        tracing::error!("production OpenSearch requires OPENSEARCH_USER and OPENSEARCH_PASSWORD");
        std::process::exit(1);
    }
    if !opensearch_user.is_empty() && opensearch_pass.is_empty() {
        tracing::error!("OPENSEARCH_PASSWORD must be configured when OPENSEARCH_USER is set");
        std::process::exit(1);
    }
    let opensearch_auth = if opensearch_user.is_empty() {
        String::new()
    } else {
        format!("{}:{}", opensearch_user, opensearch_pass)
    };

    let client = Client::builder()
        .https_only(production)
        .build()
        .unwrap_or_else(|error| {
            tracing::error!("create OpenSearch HTTP client: {}", error);
            std::process::exit(1);
        });
    let state = AppState {
        client,
        opensearch_url: opensearch_url.clone(),
        opensearch_auth,
        start_time: Instant::now(),
        index_count: Arc::new(AtomicU64::new(0)),
    };

    // A production indexer is not ready until the authenticated upstream is reachable.
    if let Err(error) = ensure_indices(&state).await {
        if production {
            tracing::error!("OpenSearch index initialization failed: {}", error);
            std::process::exit(1);
        }
        tracing::warn!("OpenSearch index initialization deferred outside production: {}", error);
    }

    let app = Router::new()
        .route("/index", post(index_document))
        .route("/search", post(search_documents))
        .route("/bulk", post(bulk_index))
        .route("/indices", get(list_indices))
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("NDSEP OpenSearch Indexer starting on {}", addr);
    tracing::info!("OpenSearch URL: {}", opensearch_url);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
        routing::any,
    };
    use tower::ServiceExt;

    fn state(url: String) -> AppState {
        AppState {
            client: Client::new(),
            opensearch_url: url,
            opensearch_auth: String::new(),
            start_time: Instant::now(),
            index_count: Arc::new(AtomicU64::new(0)),
        }
    }

    async fn response_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn upstream(status: StatusCode, payload: serde_json::Value) -> String {
        let app = Router::new().fallback(any(move || {
            let payload = payload.clone();
            async move { (status, Json(payload)) }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    fn json_request(uri: &str, payload: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn index_write_rejection_is_reported_as_gateway_failure() {
        let url = upstream(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({"error": "rejected"}),
        )
        .await;
        let app = Router::new()
            .route("/index", post(index_document))
            .with_state(state(url));
        let response = app
            .oneshot(json_request(
                "/index",
                serde_json::json!({
                    "index": "ndsep-audit-logs",
                    "id": "audit-1",
                    "document": {"action": "write"}
                }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body = response_json(response).await;
        assert_eq!(body["success"], false);
    }

    #[tokio::test]
    async fn bulk_per_document_rejection_is_not_acknowledged() {
        let url = upstream(
            StatusCode::OK,
            serde_json::json!({
                "errors": true,
                "items": [{"index": {"status": 400, "error": "mapping rejected"}}]
            }),
        )
        .await;
        let app = Router::new()
            .route("/bulk", post(bulk_index))
            .with_state(state(url));
        let response = app
            .oneshot(json_request(
                "/bulk",
                serde_json::json!({
                    "index": "ndsep-audit-logs",
                    "documents": [{"action": "write"}]
                }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body = response_json(response).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["indexed"], 0);
    }

    #[tokio::test]
    async fn unavailable_search_returns_service_unavailable_not_empty_success() {
        let app = Router::new()
            .route("/search", post(search_documents))
            .with_state(state("http://127.0.0.1:9".to_string()));
        let response = app
            .oneshot(json_request(
                "/search",
                serde_json::json!({
                    "index": "ndsep-audit-logs",
                    "query": "breach"
                }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_json(response).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "OpenSearch is unavailable");
    }

    #[tokio::test]
    async fn health_returns_unhealthy_when_upstream_is_unreachable() {
        let app = Router::new()
            .route("/health", get(health))
            .with_state(state("http://127.0.0.1:9".to_string()));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_json(response).await;
        assert_eq!(body["status"], "unhealthy");
        assert_eq!(body["error"], "OpenSearch is unavailable");
    }

    #[tokio::test]
    async fn accepted_index_write_is_acknowledged_only_after_upstream_success() {
        let url = upstream(
            StatusCode::CREATED,
            serde_json::json!({"result": "created"}),
        )
        .await;
        let app = Router::new()
            .route("/index", post(index_document))
            .with_state(state(url));
        let response = app
            .oneshot(json_request(
                "/index",
                serde_json::json!({
                    "index": "ndsep-audit-logs",
                    "id": "audit-2",
                    "document": {"action": "create"}
                }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["id"], "audit-2");
    }
}
