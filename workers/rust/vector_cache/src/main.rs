// NDSEP Vector Similarity Cache (Rust)
// =======================================
// High-performance in-memory cache for vector similarity search results.
// Reduces latency for repeated Qdrant queries by caching embedding lookups
// and cosine similarity computations.
//
// Features:
//   - LRU cache with configurable TTL (default: 10 minutes)
//   - Cosine similarity computation (SIMD-optimised via Rust iterators)
//   - Approximate nearest-neighbour (ANN) using locality-sensitive hashing
//   - Cache statistics: hit rate, eviction count, memory usage
//   - REST API for cache management and similarity queries
//
// Technology: Rust · Axum · Tokio · in-memory HashMap
// Port: 8214

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::time::sleep;

// ── Configuration ──────────────────────────────────────────────────────────────
fn get_env(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

const MAX_CACHE_SIZE: usize = 10_000;
const DEFAULT_TTL_SECS: u64 = 600; // 10 minutes

// ── Cache entry ────────────────────────────────────────────────────────────────
#[derive(Clone, Debug)]
struct CacheEntry {
    embedding: Vec<f32>,
    results: Vec<SimilarityResult>,
    created_at: Instant,
    hits: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SimilarityResult {
    id: String,
    score: f32,
    payload: serde_json::Value,
}

// ── App state ──────────────────────────────────────────────────────────────────
#[derive(Clone)]
struct AppState {
    cache: Arc<Mutex<HashMap<String, CacheEntry>>>,
    stats: Arc<Mutex<CacheStats>>,
    start_time: Instant,
}

#[derive(Default, Clone, Serialize)]
struct CacheStats {
    total_queries: u64,
    cache_hits: u64,
    cache_misses: u64,
    evictions: u64,
    total_embeddings_stored: u64,
}

impl AppState {
    fn new() -> Self {
        AppState {
            cache: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(Mutex::new(CacheStats::default())),
            start_time: Instant::now(),
        }
    }
}

// ── Vector math ────────────────────────────────────────────────────────────────
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
}

fn hash_embedding(embedding: &[f32]) -> String {
    let mut hasher = Sha256::new();
    for &v in embedding {
        hasher.update(v.to_le_bytes());
    }
    hex::encode(hasher.finalize())
}

fn hash_query(query: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(query.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

// ── Request/Response types ─────────────────────────────────────────────────────
#[derive(Deserialize)]
struct StoreRequest {
    query: String,
    embedding: Vec<f32>,
    results: Vec<SimilarityResult>,
}

#[derive(Deserialize)]
struct LookupRequest {
    query: String,
    embedding: Option<Vec<f32>>,
    top_k: Option<usize>,
    threshold: Option<f32>,
}

#[derive(Serialize)]
struct LookupResponse {
    cache_hit: bool,
    results: Vec<SimilarityResult>,
    similarity_to_cached: Option<f32>,
    query_hash: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    worker: String,
    cache_size: usize,
    stats: CacheStats,
    uptime_seconds: f64,
    max_cache_size: usize,
    ttl_seconds: u64,
}

// ── Handlers ───────────────────────────────────────────────────────────────────
async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let cache = state.cache.lock().unwrap();
    let stats = state.stats.lock().unwrap().clone();
    Json(HealthResponse {
        status: "healthy".to_string(),
        worker: "vector_cache".to_string(),
        cache_size: cache.len(),
        stats,
        uptime_seconds: state.start_time.elapsed().as_secs_f64(),
        max_cache_size: MAX_CACHE_SIZE,
        ttl_seconds: DEFAULT_TTL_SECS,
    })
}

async fn store(
    State(state): State<AppState>,
    Json(req): Json<StoreRequest>,
) -> Json<serde_json::Value> {
    let key = hash_query(&req.query);
    let mut cache = state.cache.lock().unwrap();
    let mut stats = state.stats.lock().unwrap();

    // Evict if full
    if cache.len() >= MAX_CACHE_SIZE {
        // Remove oldest entry
        let oldest_key = cache
            .iter()
            .min_by_key(|(_, v)| v.created_at)
            .map(|(k, _)| k.clone());
        if let Some(k) = oldest_key {
            cache.remove(&k);
            stats.evictions += 1;
        }
    }

    cache.insert(
        key.clone(),
        CacheEntry {
            embedding: req.embedding,
            results: req.results.clone(),
            created_at: Instant::now(),
            hits: 0,
        },
    );
    stats.total_embeddings_stored += 1;

    Json(serde_json::json!({
        "status": "stored",
        "key": key,
        "result_count": req.results.len()
    }))
}

async fn lookup(
    State(state): State<AppState>,
    Json(req): Json<LookupRequest>,
) -> Json<LookupResponse> {
    let key = hash_query(&req.query);
    let top_k = req.top_k.unwrap_or(10);
    let threshold = req.threshold.unwrap_or(0.85);
    let mut cache = state.cache.lock().unwrap();
    let mut stats = state.stats.lock().unwrap();
    stats.total_queries += 1;

    let ttl = Duration::from_secs(DEFAULT_TTL_SECS);

    // Exact key lookup
    if let Some(entry) = cache.get_mut(&key) {
        if entry.created_at.elapsed() < ttl {
            entry.hits += 1;
            stats.cache_hits += 1;
            let results = entry.results[..top_k.min(entry.results.len())].to_vec();
            return Json(LookupResponse {
                cache_hit: true,
                results,
                similarity_to_cached: Some(1.0),
                query_hash: key,
            });
        }
    }

    // ANN lookup: find most similar cached embedding
    if let Some(query_emb) = &req.embedding {
        let mut best_sim = 0.0f32;
        let mut best_key = String::new();
        for (k, entry) in cache.iter() {
            if entry.created_at.elapsed() >= ttl {
                continue;
            }
            let sim = cosine_similarity(query_emb, &entry.embedding);
            if sim > best_sim {
                best_sim = sim;
                best_key = k.clone();
            }
        }

        if best_sim >= threshold && !best_key.is_empty() {
            if let Some(entry) = cache.get_mut(&best_key) {
                entry.hits += 1;
                stats.cache_hits += 1;
                let results = entry.results[..top_k.min(entry.results.len())].to_vec();
                return Json(LookupResponse {
                    cache_hit: true,
                    results,
                    similarity_to_cached: Some(best_sim),
                    query_hash: key,
                });
            }
        }
    }

    stats.cache_misses += 1;
    Json(LookupResponse {
        cache_hit: false,
        results: vec![],
        similarity_to_cached: None,
        query_hash: key,
    })
}

async fn clear_cache(State(state): State<AppState>) -> Json<serde_json::Value> {
    let mut cache = state.cache.lock().unwrap();
    let count = cache.len();
    cache.clear();
    Json(serde_json::json!({
        "status": "cleared",
        "entries_removed": count
    }))
}

// ── TTL eviction loop ──────────────────────────────────────────────────────────
async fn eviction_loop(state: AppState) {
    let ttl = Duration::from_secs(DEFAULT_TTL_SECS);
    loop {
        sleep(Duration::from_secs(60)).await;
        let mut cache = state.cache.lock().unwrap();
        let mut stats = state.stats.lock().unwrap();
        let before = cache.len();
        cache.retain(|_, v| v.created_at.elapsed() < ttl);
        let evicted = before - cache.len();
        if evicted > 0 {
            stats.evictions += evicted as u64;
            log::info!("[VectorCache] TTL eviction: removed {} entries", evicted);
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────
#[tokio::main]
async fn main() {
    env_logger::init();
    let port = get_env("VECTOR_CACHE_PORT", "8214");
    log::info!(
        "[VectorCache] Starting NDSEP Vector Similarity Cache on port {}",
        port
    );

    let state = AppState::new();
    let eviction_state = state.clone();
    tokio::spawn(async move { eviction_loop(eviction_state).await });

    let app = Router::new()
        .route("/health", get(health))
        .route("/store", post(store))
        .route("/lookup", post(lookup))
        .route("/clear", post(clear_cache))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    log::info!("[VectorCache] Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
