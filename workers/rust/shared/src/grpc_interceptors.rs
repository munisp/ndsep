//! NDSEP gRPC Interceptors for Rust Workers
//!
//! Production-grade interceptor chain:
//!   - Circuit breaker (CLOSED → OPEN → HALF_OPEN) per service
//!   - Retry with exponential backoff + jitter
//!   - Deadline propagation via context
//!   - Prometheus-compatible metrics
//!   - Internal service auth token injection
//!
//! Usage:
//! ```ignore
//! let cb = CircuitBreaker::new("audit-chain", 5, 2, Duration::from_secs(30));
//! if cb.allow() {
//!     // make gRPC call
//!     cb.record_success();
//! }
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ─── gRPC Status Codes ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum GrpcCode {
    Ok = 0,
    Cancelled = 1,
    Unknown = 2,
    InvalidArgument = 3,
    DeadlineExceeded = 4,
    NotFound = 5,
    AlreadyExists = 6,
    PermissionDenied = 7,
    ResourceExhausted = 8,
    Aborted = 10,
    Internal = 13,
    Unavailable = 14,
    DataLoss = 15,
    Unauthenticated = 16,
}

impl GrpcCode {
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            GrpcCode::Unavailable
                | GrpcCode::DeadlineExceeded
                | GrpcCode::ResourceExhausted
                | GrpcCode::Aborted
                | GrpcCode::Internal
        )
    }

    pub fn from_http_status(status: u16) -> Self {
        match status {
            400 => GrpcCode::InvalidArgument,
            401 => GrpcCode::Unauthenticated,
            403 => GrpcCode::PermissionDenied,
            404 => GrpcCode::NotFound,
            409 => GrpcCode::AlreadyExists,
            429 => GrpcCode::ResourceExhausted,
            500 => GrpcCode::Internal,
            503 => GrpcCode::Unavailable,
            504 => GrpcCode::DeadlineExceeded,
            _ => GrpcCode::Unknown,
        }
    }
}

impl std::fmt::Display for GrpcCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

// ─── gRPC Error ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct GrpcError {
    pub code: GrpcCode,
    pub message: String,
}

impl std::fmt::Display for GrpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "grpc {}: {}", self.code, self.message)
    }
}

impl std::error::Error for GrpcError {}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl std::fmt::Display for CircuitState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitState::Closed => write!(f, "CLOSED"),
            CircuitState::Open => write!(f, "OPEN"),
            CircuitState::HalfOpen => write!(f, "HALF_OPEN"),
        }
    }
}

pub struct CircuitBreaker {
    name: String,
    state: AtomicU32,
    failures: AtomicU32,
    successes: AtomicU32,
    failure_threshold: u32,
    success_threshold: u32,
    reset_timeout: Duration,
    last_opened_at: Mutex<Option<Instant>>,
}

impl CircuitBreaker {
    pub fn new(
        name: &str,
        failure_threshold: u32,
        success_threshold: u32,
        reset_timeout: Duration,
    ) -> Self {
        Self {
            name: name.to_string(),
            state: AtomicU32::new(CircuitState::Closed as u32),
            failures: AtomicU32::new(0),
            successes: AtomicU32::new(0),
            failure_threshold,
            success_threshold,
            reset_timeout,
            last_opened_at: Mutex::new(None),
        }
    }

    pub fn state(&self) -> CircuitState {
        match self.state.load(Ordering::Relaxed) {
            0 => CircuitState::Closed,
            1 => CircuitState::Open,
            2 => CircuitState::HalfOpen,
            _ => CircuitState::Closed,
        }
    }

    pub fn allow(&self) -> bool {
        match self.state() {
            CircuitState::Closed => true,
            CircuitState::Open => {
                let guard = self.last_opened_at.lock().unwrap();
                if let Some(opened) = *guard {
                    if opened.elapsed() >= self.reset_timeout {
                        drop(guard);
                        self.state
                            .store(CircuitState::HalfOpen as u32, Ordering::Relaxed);
                        self.successes.store(0, Ordering::Relaxed);
                        return true;
                    }
                }
                false
            }
            CircuitState::HalfOpen => true,
        }
    }

    pub fn record_success(&self) {
        self.failures.store(0, Ordering::Relaxed);
        if self.state() == CircuitState::HalfOpen {
            let s = self.successes.fetch_add(1, Ordering::Relaxed) + 1;
            if s >= self.success_threshold {
                self.state
                    .store(CircuitState::Closed as u32, Ordering::Relaxed);
                log::info!("[gRPC:circuit:{}] CLOSED — service recovered", self.name);
            }
        }
    }

    pub fn record_failure(&self) {
        let f = self.failures.fetch_add(1, Ordering::Relaxed) + 1;
        if self.state() == CircuitState::HalfOpen || f >= self.failure_threshold {
            self.state
                .store(CircuitState::Open as u32, Ordering::Relaxed);
            *self.last_opened_at.lock().unwrap() = Some(Instant::now());
            log::warn!(
                "[gRPC:circuit:{}] OPEN — {} failures (threshold: {})",
                self.name,
                f,
                self.failure_threshold
            );
        }
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.name,
            "state": self.state().to_string(),
            "failures": self.failures.load(Ordering::Relaxed),
        })
    }
}

// ─── Circuit Breaker Registry ───────────────────────────────────────────────

lazy_static::lazy_static! {
    static ref CB_REGISTRY: Mutex<HashMap<String, Arc<CircuitBreaker>>> = Mutex::new(HashMap::new());
}

pub fn get_circuit_breaker(name: &str) -> Arc<CircuitBreaker> {
    let mut registry = CB_REGISTRY.lock().unwrap();
    if let Some(cb) = registry.get(name) {
        return Arc::clone(cb);
    }
    let cb = Arc::new(CircuitBreaker::new(name, 5, 2, Duration::from_secs(30)));
    registry.insert(name.to_string(), Arc::clone(&cb));
    cb
}

pub fn all_circuit_breaker_states() -> Vec<serde_json::Value> {
    let registry = CB_REGISTRY.lock().unwrap();
    registry.values().map(|cb| cb.to_json()).collect()
}

// ─── Retry Config ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub backoff_multiplier: f64,
    pub jitter_factor: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_secs(5),
            backoff_multiplier: 2.0,
            jitter_factor: 0.2,
        }
    }
}

impl RetryConfig {
    fn backoff_duration(&self, attempt: u32) -> Duration {
        let base = self.initial_backoff.as_millis() as f64
            * self.backoff_multiplier.powi(attempt as i32 - 1);
        let capped = base.min(self.max_backoff.as_millis() as f64);
        let jitter = capped * self.jitter_factor * rand::random::<f64>();
        Duration::from_millis((capped + jitter) as u64)
    }
}

// ─── Metrics ────────────────────────────────────────────────────────────────

static TOTAL_CALLS: AtomicI64 = AtomicI64::new(0);
static SUCCESS_CALLS: AtomicI64 = AtomicI64::new(0);
static FAILED_CALLS: AtomicI64 = AtomicI64::new(0);
static RETRY_COUNT: AtomicI64 = AtomicI64::new(0);
static CB_TRIPS: AtomicI64 = AtomicI64::new(0);
static LATENCY_SUM_MS: AtomicI64 = AtomicI64::new(0);
static LATENCY_COUNT: AtomicI64 = AtomicI64::new(0);

pub fn grpc_metrics_snapshot() -> serde_json::Value {
    let total = TOTAL_CALLS.load(Ordering::Relaxed);
    let success = SUCCESS_CALLS.load(Ordering::Relaxed);
    let count = LATENCY_COUNT.load(Ordering::Relaxed);
    let sum = LATENCY_SUM_MS.load(Ordering::Relaxed);
    let avg = if count > 0 { sum / count } else { 0 };

    serde_json::json!({
        "total_calls": total,
        "success_calls": success,
        "failed_calls": FAILED_CALLS.load(Ordering::Relaxed),
        "retry_count": RETRY_COUNT.load(Ordering::Relaxed),
        "circuit_breaker_trips": CB_TRIPS.load(Ordering::Relaxed),
        "avg_latency_ms": avg,
    })
}

// ─── Interceptor ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct InterceptorConfig {
    pub retry: RetryConfig,
    pub circuit_breaker_name: String,
}

impl Default for InterceptorConfig {
    fn default() -> Self {
        Self {
            retry: RetryConfig::default(),
            circuit_breaker_name: "default".to_string(),
        }
    }
}

/// Execute a gRPC call through the circuit breaker + retry interceptor chain.
///
/// The call function receives no arguments (capture via closure) and returns
/// a Result with a GrpcError on failure.
pub async fn execute_with_interceptors<F, Fut, T>(
    service_name: &str,
    _method: &str,
    config: &InterceptorConfig,
    call: F,
) -> Result<T, GrpcError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, GrpcError>>,
{
    let cb = get_circuit_breaker(&config.circuit_breaker_name);

    if !cb.allow() {
        CB_TRIPS.fetch_add(1, Ordering::Relaxed);
        return Err(GrpcError {
            code: GrpcCode::Unavailable,
            message: format!("circuit breaker OPEN for {}", service_name),
        });
    }

    let mut last_err = None;
    let start = Instant::now();

    for attempt in 1..=config.retry.max_attempts {
        TOTAL_CALLS.fetch_add(1, Ordering::Relaxed);

        match call().await {
            Ok(result) => {
                let latency = start.elapsed().as_millis() as i64;
                LATENCY_SUM_MS.fetch_add(latency, Ordering::Relaxed);
                LATENCY_COUNT.fetch_add(1, Ordering::Relaxed);
                SUCCESS_CALLS.fetch_add(1, Ordering::Relaxed);
                cb.record_success();
                return Ok(result);
            }
            Err(err) => {
                FAILED_CALLS.fetch_add(1, Ordering::Relaxed);
                let latency = start.elapsed().as_millis() as i64;
                LATENCY_SUM_MS.fetch_add(latency, Ordering::Relaxed);
                LATENCY_COUNT.fetch_add(1, Ordering::Relaxed);

                if !err.code.is_retryable() || attempt >= config.retry.max_attempts {
                    cb.record_failure();
                    return Err(err);
                }

                last_err = Some(err);
                RETRY_COUNT.fetch_add(1, Ordering::Relaxed);

                let backoff = config.retry.backoff_duration(attempt);
                tokio::time::sleep(backoff).await;

                if !cb.allow() {
                    CB_TRIPS.fetch_add(1, Ordering::Relaxed);
                    return Err(GrpcError {
                        code: GrpcCode::Unavailable,
                        message: format!(
                            "circuit breaker opened during retry for {}",
                            service_name
                        ),
                    });
                }
            }
        }
    }

    cb.record_failure();
    Err(last_err.unwrap_or(GrpcError {
        code: GrpcCode::Unknown,
        message: "all retries exhausted".to_string(),
    }))
}

// ─── HTTP-to-gRPC Bridge ────────────────────────────────────────────────────

/// Execute an HTTP call to a gRPC-transcoded endpoint with interceptors.
pub async fn grpc_http_call(
    service_name: &str,
    method: &str,
    url: &str,
    body: &serde_json::Value,
    config: &InterceptorConfig,
) -> Result<serde_json::Value, GrpcError> {
    let client = reqwest::Client::new();
    let internal_token = std::env::var("INTERNAL_SERVICE_TOKEN").unwrap_or_default();
    let url = url.to_string();
    let body = body.clone();
    let internal_token = internal_token.clone();

    execute_with_interceptors(service_name, method, config, || {
        let client = client.clone();
        let url = url.clone();
        let body = body.clone();
        let internal_token = internal_token.clone();

        async move {
            let mut req = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("x-grpc-service", service_name)
                .header("x-grpc-method", method);

            if !internal_token.is_empty() {
                req = req.header("x-internal-auth", &internal_token);
            }

            let resp = req
                .json(&body)
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .map_err(|e| {
                    if e.is_timeout() {
                        GrpcError {
                            code: GrpcCode::DeadlineExceeded,
                            message: format!("timeout: {}", e),
                        }
                    } else if e.is_connect() {
                        GrpcError {
                            code: GrpcCode::Unavailable,
                            message: format!("connection failed: {}", e),
                        }
                    } else {
                        GrpcError {
                            code: GrpcCode::Internal,
                            message: format!("request error: {}", e),
                        }
                    }
                })?;

            let status = resp.status().as_u16();
            if status >= 400 {
                let text = resp.text().await.unwrap_or_default();
                return Err(GrpcError {
                    code: GrpcCode::from_http_status(status),
                    message: text,
                });
            }

            resp.json::<serde_json::Value>()
                .await
                .map_err(|e| GrpcError {
                    code: GrpcCode::Internal,
                    message: format!("json decode error: {}", e),
                })
        }
    })
    .await
}
