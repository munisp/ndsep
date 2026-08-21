// Package shared provides production-grade utilities for all NDSEP Go workers:
// - PostgreSQL connection pool with retry/backoff
// - Structured JSON logging
// - HTTP event broadcaster with retry
// - Graceful shutdown helpers
// - Health check HTTP handler
// - Common types and helpers
package shared

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// ─────────────────────────────────────────────────────────────────────────────
// Structured Logger
// ─────────────────────────────────────────────────────────────────────────────

// WorkerLogger provides structured JSON logging for a named worker.
type WorkerLogger struct {
	WorkerID string
}

type logEntry struct {
	Timestamp string      `json:"ts"`
	Level     string      `json:"level"`
	Worker    string      `json:"worker"`
	Msg       string      `json:"msg"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}

func (l *WorkerLogger) log(level, msg string, data interface{}, err error) {
	entry := logEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Worker:    l.WorkerID,
		Msg:       msg,
		Data:      data,
	}
	if err != nil {
		entry.Error = err.Error()
	}
	b, _ := json.Marshal(entry)
	log.Printf("[%s] %s: %s", l.WorkerID, level, string(b))
}

func (l *WorkerLogger) Info(msg string, data ...interface{}) {
	var d interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log("INFO", msg, d, nil)
}

func (l *WorkerLogger) Warn(msg string, data ...interface{}) {
	var d interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log("WARN", msg, d, nil)
}

func (l *WorkerLogger) Error(msg string, err error, data ...interface{}) {
	var d interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log("ERROR", msg, d, err)
}

func (l *WorkerLogger) Fatal(msg string, err error) {
	l.log("FATAL", msg, nil, err)
	os.Exit(1)
}

// NewLogger creates a WorkerLogger for the given worker ID.
func NewLogger(workerID string) *WorkerLogger {
	return &WorkerLogger{WorkerID: workerID}
}

// ─────────────────────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────────────────────

var DB *sql.DB

// InitDB connects to PostgreSQL with production-grade pool settings and
// exponential backoff retry (up to maxRetries attempts).
func InitDB() error {
	return InitDBWithRetry(5)
}

func InitDBWithRetry(maxRetries int) error {
	dsn := os.Getenv("WORKER_DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("failed to open DB: %w", err)
	}

	// Production pool settings
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(10 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)

	// Retry connectivity with exponential backoff
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if err := db.Ping(); err == nil {
			DB = db
			log.Printf("[DB] Connected to PostgreSQL (attempt %d/%d)", attempt, maxRetries)
			return nil
		} else {
			delay := time.Duration(attempt*attempt) * 500 * time.Millisecond
			log.Printf("[DB] Ping failed (attempt %d/%d): %v — retrying in %s", attempt, maxRetries, err, delay)
			time.Sleep(delay)
		}
	}
	return fmt.Errorf("failed to connect to PostgreSQL after %d attempts", maxRetries)
}

// WithRetry executes fn with exponential backoff for transient DB errors.
func WithRetry(fn func() error, maxAttempts int, baseDelay time.Duration) error {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
			if attempt < maxAttempts {
				delay := baseDelay * time.Duration(1<<uint(attempt-1))
				log.Printf("[DB] Retry %d/%d after %s: %v", attempt, maxAttempts, delay, err)
				time.Sleep(delay)
			}
		}
	}
	return lastErr
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Broadcasting (HTTP POST to Node.js relay endpoint)
// ─────────────────────────────────────────────────────────────────────────────

var (
	relayURL   string
	httpClient = &http.Client{Timeout: 5 * time.Second}
)

func InitRelay() {
	relayURL = os.Getenv("WORKER_RELAY_URL")
	if relayURL == "" {
		relayURL = "http://localhost:3000/api/workers/event"
	}
	log.Printf("[Relay] Broadcasting to %s\n", relayURL)
}

type BroadcastPayload struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// Broadcast sends an event to the Node.js WebSocket relay with one retry.
func Broadcast(event string, data interface{}) {
	payload := BroadcastPayload{Event: event, Data: data}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Relay] Marshal error: %v\n", err)
		return
	}
	for attempt := 1; attempt <= 2; attempt++ {
		resp, err := httpClient.Post(relayURL, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
			return
		}
		if attempt == 1 {
			time.Sleep(500 * time.Millisecond)
		}
	}
	// Silently fail — relay may be temporarily unavailable
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────────────────────────────

// WaitForShutdown blocks until SIGTERM or SIGINT is received, then calls
// the provided cleanup function and exits cleanly.
func WaitForShutdown(workerID string, cleanup func()) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit
	log.Printf("[%s] Received signal %s — shutting down gracefully", workerID, sig)
	if cleanup != nil {
		cleanup()
	}
	if DB != nil {
		DB.Close()
		log.Printf("[%s] Database connection closed", workerID)
	}
	log.Printf("[%s] Shutdown complete", workerID)
	os.Exit(0)
}

// NewShutdownContext returns a context that is cancelled on SIGTERM/SIGINT.
func NewShutdownContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
		<-quit
		cancel()
	}()
	return ctx, cancel
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Check HTTP Handler
// ─────────────────────────────────────────────────────────────────────────────

type HealthState struct {
	WorkerID    string
	StartTime   time.Time
	CyclesRun   int64
	LastRunAt   time.Time
	ExtraFields map[string]interface{}
}

// HealthHandler returns an HTTP handler for /health and /status endpoints.
// state is a pointer to a HealthState that the worker updates each cycle.
func HealthHandler(state *HealthState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dbOk := false
		if DB != nil {
			if err := DB.Ping(); err == nil {
				dbOk = true
			}
		}

		status := "healthy"
		httpCode := http.StatusOK
		if !dbOk {
			status = "degraded"
			httpCode = http.StatusServiceUnavailable
		}

		resp := map[string]interface{}{
			"status":     status,
			"worker":     state.WorkerID,
			"uptime_sec": int64(time.Since(state.StartTime).Seconds()),
			"cycles_run": state.CyclesRun,
			"last_run":   state.LastRunAt.UTC().Format(time.RFC3339),
			"database":   map[string]bool{"ok": dbOk},
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		}
		for k, v := range state.ExtraFields {
			resp[k] = v
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpCode)
		json.NewEncoder(w).Encode(resp)
	}
}

// StartHealthServer starts a lightweight HTTP server on the given port
// exposing /health and /status endpoints.
func StartHealthServer(port int, state *HealthState) {
	mux := http.NewServeMux()
	handler := HealthHandler(state)
	mux.HandleFunc("/health", handler)
	mux.HandleFunc("/status", handler)
	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
		IdleTimeout:  30 * time.Second,
	}
	log.Printf("[%s] Health server listening on %s", state.WorkerID, addr)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[%s] Health server error: %v", state.WorkerID, err)
		}
	}()
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Status (reported via HTTP GET /status)
// ─────────────────────────────────────────────────────────────────────────────

type WorkerStatus struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Layer           string    `json:"layer"`
	Language        string    `json:"language"`
	Status          string    `json:"status"`
	LastRun         time.Time `json:"lastRun"`
	EventsProcessed int64     `json:"eventsProcessed"`
	Description     string    `json:"description"`
	Technology      string    `json:"technology"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func RandomBetween(min, max int) int {
	return min + rand.Intn(max-min+1)
}

func RandomChoice(items []string) string {
	return items[rand.Intn(len(items))]
}

func RandomIP() string {
	return fmt.Sprintf("%d.%d.%d.%d",
		RandomBetween(1, 254),
		RandomBetween(0, 255),
		RandomBetween(0, 255),
		RandomBetween(1, 254),
	)
}

func RandomFloat(min, max float64) float64 {
	return min + rand.Float64()*(max-min)
}

// GetOrgIDs returns a slice of all organization IDs from the DB
func GetOrgIDs() ([]int, []string, error) {
	rows, err := DB.Query("SELECT id, name FROM organizations LIMIT 20")
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var ids []int
	var names []string
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		ids = append(ids, id)
		names = append(names, name)
	}
	return ids, names, nil
}


// ─────────────────────────────────────────────────────────────────────────────
// OpenTelemetry Tracing (lightweight HTTP OTLP exporter, no SDK dependency)
// ─────────────────────────────────────────────────────────────────────────────

// TraceConfig holds OpenTelemetry configuration for a worker.
type TraceConfig struct {
ServiceName    string
ServiceVersion string
OTLPEndpoint   string // e.g. "http://localhost:4318/v1/traces"
}

var (
otelEndpoint string
otelService  string
otelVersion  string
otelEnabled  bool
)

// InitTracing initialises the lightweight OTLP HTTP tracing client.
func InitTracing(cfg TraceConfig) {
otelService = cfg.ServiceName
otelVersion = cfg.ServiceVersion
otelEndpoint = cfg.OTLPEndpoint
if otelEndpoint == "" {
otelEndpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
if otelEndpoint == "" {
otelEndpoint = "http://localhost:4318/v1/traces"
}
}
otelEnabled = true
log.Printf("[%s] OpenTelemetry tracing enabled → %s", otelService, otelEndpoint)
}

// StartSpan records a named span and returns an end function.
func StartSpan(name string) func(err error) {
if !otelEnabled {
return func(error) {}
}
traceID := fmt.Sprintf("%016x%016x", rand.Int63(), rand.Int63())
spanID := fmt.Sprintf("%016x", rand.Int63())
start := time.Now().UnixNano()
return func(spanErr error) {
status := "OK"
if spanErr != nil {
status = "ERROR"
}
payload := map[string]interface{}{
"traceId": traceID, "spanId": spanID, "name": name,
"startTimeUnixNano": start, "endTimeUnixNano": time.Now().UnixNano(),
"status": status, "service": otelService,
}
go func() {
b, _ := json.Marshal(map[string]interface{}{
"resourceSpans": []interface{}{map[string]interface{}{
"resource": map[string]interface{}{"attributes": []interface{}{
map[string]interface{}{"key": "service.name", "value": map[string]string{"stringValue": otelService}},
}},
"scopeSpans": []interface{}{map[string]interface{}{"spans": []interface{}{payload}}},
}},
})
client := &http.Client{Timeout: 2 * time.Second}
resp, err := client.Post(otelEndpoint, "application/json", bytes.NewReader(b))
if err == nil {
resp.Body.Close()
}
}()
}
}

// ─────────────────────────────────────────────────────────────────────────────
// GracefulHTTPServer — wraps http.Server with SIGTERM/SIGINT shutdown
// ─────────────────────────────────────────────────────────────────────────────

// RunGracefulServer starts an HTTP server and shuts it down gracefully on signal.
func RunGracefulServer(workerID, port string, handler http.Handler, cleanup func()) {
mux := handler
if mux == nil {
mux = http.DefaultServeMux
}
srv := &http.Server{
Addr:         ":" + port,
Handler:      mux,
ReadTimeout:  15 * time.Second,
WriteTimeout: 30 * time.Second,
IdleTimeout:  60 * time.Second,
}
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
go func() {
log.Printf("[%s] HTTP server listening on :%s", workerID, port)
if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
log.Fatalf("[%s] Server error: %v", workerID, err)
}
}()
sig := <-quit
log.Printf("[%s] Received %s — shutting down gracefully", workerID, sig)
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil {
log.Printf("[%s] Forced shutdown: %v", workerID, err)
}
if cleanup != nil {
cleanup()
}
log.Printf("[%s] Shutdown complete", workerID)
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter — token bucket per IP (in-memory)
// ─────────────────────────────────────────────────────────────────────────────

type rateBucket struct {
tokens   float64
lastSeen time.Time
}

var (
rateMu      sync.Mutex
rateBuckets = make(map[string]*rateBucket)
workerRateLimit float64 = 120 // requests per minute per IP
workerBurst     float64 = 20  // burst size
)

// RateLimitMiddleware is an HTTP middleware that limits requests per IP.
func RateLimitMiddleware(next http.Handler) http.Handler {
return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
ip := r.RemoteAddr
if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
ip = xff
}
rateMu.Lock()
b, ok := rateBuckets[ip]
if !ok {
b = &rateBucket{tokens: workerBurst, lastSeen: time.Now()}
rateBuckets[ip] = b
}
elapsed := time.Since(b.lastSeen).Minutes()
b.tokens += elapsed * workerRateLimit
if b.tokens > workerBurst {
b.tokens = workerBurst
}
b.lastSeen = time.Now()
allowed := b.tokens >= 1
if allowed {
b.tokens--
}
rateMu.Unlock()
if !allowed {
w.Header().Set("Retry-After", "60")
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusTooManyRequests)
w.Write([]byte(`{"error":"rate limit exceeded","retryAfter":60}`))
return
}
next.ServeHTTP(w, r)
})
}


// Log is a convenience wrapper for structured logging to stdout
func Log(level, event string, data interface{}) {
entry := map[string]interface{}{
"level":  level,
"event":  event,
"data":   data,
"ts":     time.Now().UTC().Format(time.RFC3339),
}
b, _ := json.Marshal(entry)
fmt.Println(string(b))
}

// PublishEvent publishes an event to the relay (alias for Broadcast)
func PublishEvent(event string, data interface{}) {
Broadcast(event, data)
}
