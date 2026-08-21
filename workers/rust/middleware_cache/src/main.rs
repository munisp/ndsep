/// middleware_cache — Rust Middleware Cache Worker
/// =================================================
/// High-performance in-memory cache manager and rate limiter for NDSEP routers.
/// Falls back to local memory when Redis is unavailable.
///
/// Endpoints:
///   POST /cache/set      — set a key with TTL (JSON: {key, value, ttl?})
///   POST /cache/get      — get a key (JSON: {key})
///   POST /cache/del      — delete a key (JSON: {key})
///   POST /ratelimit/check — sliding window rate limit (JSON: {key, limit, window_secs})
///   GET  /health         — liveness probe
///   GET  /metrics        — Prometheus metrics
///
/// Port: 8141 (MIDDLEWARE_CACHE_PORT env)
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ─── In-memory cache ──────────────────────────────────────────────────────────
struct CacheEntry {
    value: String,
    expires_at: Option<Instant>,
}

struct LocalCache {
    store: HashMap<String, CacheEntry>,
}

impl LocalCache {
    fn new() -> Self {
        Self {
            store: HashMap::new(),
        }
    }

    fn set(&mut self, key: String, value: String, ttl_secs: Option<u64>) {
        let expires_at = ttl_secs.map(|s| Instant::now() + Duration::from_secs(s));
        self.store.insert(key, CacheEntry { value, expires_at });
    }

    fn get(&self, key: &str) -> Option<String> {
        self.store.get(key).and_then(|e| {
            if let Some(exp) = e.expires_at {
                if Instant::now() > exp {
                    return None;
                }
            }
            Some(e.value.clone())
        })
    }

    fn del(&mut self, key: &str) {
        self.store.remove(key);
    }

    fn evict_expired(&mut self) {
        let now = Instant::now();
        self.store
            .retain(|_, e| e.expires_at.map(|exp| now < exp).unwrap_or(true));
    }
}

// ─── Rate limiter (sliding window) ───────────────────────────────────────────
struct RateLimiter {
    windows: HashMap<String, Vec<Instant>>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
        }
    }

    fn check(&mut self, key: &str, limit: usize, window_secs: u64) -> (bool, usize, u64) {
        let now = Instant::now();
        let window = Duration::from_secs(window_secs);
        let timestamps = self.windows.entry(key.to_string()).or_default();
        timestamps.retain(|t| now.duration_since(*t) < window);
        let count = timestamps.len();
        if count < limit {
            timestamps.push(now);
            (true, limit - count - 1, window_secs)
        } else {
            let oldest = timestamps[0];
            let reset = window_secs.saturating_sub(now.duration_since(oldest).as_secs());
            (false, 0, reset)
        }
    }
}

// ─── Shared state ─────────────────────────────────────────────────────────────
struct AppState {
    cache: Mutex<LocalCache>,
    limiter: Mutex<RateLimiter>,
    requests_total: Mutex<u64>,
    cache_hits: Mutex<u64>,
    cache_misses: Mutex<u64>,
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
fn read_request(stream: &mut TcpStream) -> (String, String, String) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line);
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    let method = parts.get(0).copied().unwrap_or("").to_string();
    let path = parts.get(1).copied().unwrap_or("").to_string();
    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        let _ = reader.read_line(&mut header);
        if header.trim().is_empty() {
            break;
        }
        if header.to_lowercase().starts_with("content-length:") {
            content_length = header
                .split(':')
                .nth(1)
                .unwrap_or("0")
                .trim()
                .parse()
                .unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.get_mut().read_exact(&mut body);
    }
    (method, path, String::from_utf8_lossy(&body).to_string())
}

fn send_json(stream: &mut TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn send_text(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

// ─── Request handler ─────────────────────────────────────────────────────────
fn handle_connection(mut stream: TcpStream, state: Arc<AppState>) {
    let (method, path, body) = read_request(&mut stream);
    *state.requests_total.lock().unwrap() += 1;

    match (method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            send_json(
                &mut stream,
                200,
                r#"{"status":"ok","worker":"middleware_cache"}"#,
            );
        }
        ("GET", "/metrics") => {
            let total = *state.requests_total.lock().unwrap();
            let hits = *state.cache_hits.lock().unwrap();
            let misses = *state.cache_misses.lock().unwrap();
            let metrics = format!(
                "# HELP ndsep_cache_requests_total Total requests\n\
                 # TYPE ndsep_cache_requests_total counter\n\
                 ndsep_cache_requests_total {total}\n\
                 # HELP ndsep_cache_hits_total Cache hits\n\
                 # TYPE ndsep_cache_hits_total counter\n\
                 ndsep_cache_hits_total {hits}\n\
                 # HELP ndsep_cache_misses_total Cache misses\n\
                 # TYPE ndsep_cache_misses_total counter\n\
                 ndsep_cache_misses_total {misses}\n"
            );
            send_text(&mut stream, &metrics);
        }
        ("POST", "/cache/set") => {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                let key = v["key"].as_str().unwrap_or("").to_string();
                let value = v["value"].as_str().unwrap_or("").to_string();
                let ttl = v["ttl"].as_u64();
                state.cache.lock().unwrap().set(key, value, ttl);
            }
            send_json(&mut stream, 200, r#"{"ok":true}"#);
        }
        ("POST", "/cache/get") => {
            let result = if let Ok(v) = serde_json::from_str::<Value>(&body) {
                let key = v["key"].as_str().unwrap_or("");
                if let Some(val) = state.cache.lock().unwrap().get(key) {
                    *state.cache_hits.lock().unwrap() += 1;
                    json!({"ok": true, "value": val}).to_string()
                } else {
                    *state.cache_misses.lock().unwrap() += 1;
                    r#"{"ok":false,"value":null}"#.to_string()
                }
            } else {
                r#"{"ok":false,"value":null}"#.to_string()
            };
            send_json(&mut stream, 200, &result);
        }
        ("POST", "/cache/del") => {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                let key = v["key"].as_str().unwrap_or("");
                state.cache.lock().unwrap().del(key);
            }
            send_json(&mut stream, 200, r#"{"ok":true}"#);
        }
        ("POST", "/ratelimit/check") => {
            let (allowed, remaining, reset) = if let Ok(v) = serde_json::from_str::<Value>(&body) {
                let key = v["key"].as_str().unwrap_or("default").to_string();
                let limit = v["limit"].as_u64().unwrap_or(100) as usize;
                let window = v["window_secs"].as_u64().unwrap_or(60);
                state.limiter.lock().unwrap().check(&key, limit, window)
            } else {
                (true, 99, 60)
            };
            let result =
                json!({"allowed": allowed, "remaining": remaining, "reset_in": reset}).to_string();
            send_json(&mut stream, 200, &result);
        }
        _ => {
            send_json(&mut stream, 404, r#"{"error":"not found"}"#);
        }
    }
}

fn main() {
    let port = env::var("MIDDLEWARE_CACHE_PORT").unwrap_or_else(|_| "8141".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).expect("Failed to bind port");
    println!("[MiddlewareCache] Listening on {addr}");

    let state = Arc::new(AppState {
        cache: Mutex::new(LocalCache::new()),
        limiter: Mutex::new(RateLimiter::new()),
        requests_total: Mutex::new(0),
        cache_hits: Mutex::new(0),
        cache_misses: Mutex::new(0),
    });

    // Background eviction thread (every 60s)
    let evict_state = state.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        evict_state.cache.lock().unwrap().evict_expired();
    });

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let state = state.clone();
                std::thread::spawn(move || handle_connection(s, state));
            }
            Err(e) => eprintln!("[MiddlewareCache] Connection error: {e}"),
        }
    }
}
