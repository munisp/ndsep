package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OpenAppSec WAF Integration Worker monitors WAF rules, threat detection and request filtering.
// It sends authenticated operational events to the NDSEP worker-event boundary. Events are
// telemetry only: downstream services must independently validate policy and evidence before
// taking any enforcement action.
const (
	workerEventSignatureVersion = "ndsep-worker-event-v1"
	workerID                    = "openappsec-waf"
)

type WAFEvent struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	SourceIP  string    `json:"source_ip"`
	Path      string    `json:"path"`
	Action    string    `json:"action"` // block, allow, log
	Threat    string    `json:"threat"` // sqli, xss, rce, etc.
	Severity  string    `json:"severity"`
	Details   string    `json:"details"`
}

type WAFStats struct {
	TotalRequests   int64          `json:"total_requests"`
	BlockedRequests int64          `json:"blocked_requests"`
	RelayFailures   int64          `json:"relay_failures"`
	ThreatsByType   map[string]int `json:"threats_by_type"`
	TopAttackerIPs  []string       `json:"top_attacker_ips"`
	LastUpdated     time.Time      `json:"last_updated"`
}

var (
	stats = WAFStats{ThreatsByType: make(map[string]int)}
	mu    sync.Mutex
)

func isProduction() bool {
	return strings.EqualFold(os.Getenv("APP_ENV"), "production") || strings.EqualFold(os.Getenv("NODE_ENV"), "production")
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	mu.Lock()
	degraded := isProduction() && (os.Getenv("WORKER_RELAY_URL") == "" || len(os.Getenv("WORKER_EVENT_HMAC_SECRET")) < 32)
	mu.Unlock()
	if degraded {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "degraded", "reason": "authenticated relay is not configured"})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "openappsec-waf-worker",
		"version": "1.1.0",
	})
}

func statsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	_ = json.NewEncoder(w).Encode(stats)
}

func eventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var event WAFEvent
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&event); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if event.ID == "" || event.Action == "" || event.Threat == "" || event.Severity == "" {
		http.Error(w, "event id, action, threat and severity are required", http.StatusBadRequest)
		return
	}

	mu.Lock()
	stats.TotalRequests++
	if event.Action == "block" {
		stats.BlockedRequests++
		stats.ThreatsByType[event.Threat]++
	}
	stats.LastUpdated = time.Now().UTC()
	mu.Unlock()

	relayURL := os.Getenv("WORKER_RELAY_URL")
	secret := os.Getenv("WORKER_EVENT_HMAC_SECRET")
	if relayURL == "" || len(secret) < 32 {
		if isProduction() {
			mu.Lock()
			stats.RelayFailures++
			mu.Unlock()
			http.Error(w, "authenticated event relay is not configured", http.StatusServiceUnavailable)
			return
		}
		log.Printf("relay skipped outside production: authenticated relay is not configured event_id=%s", event.ID)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "received", "relay": "not_configured"})
		return
	}

	go func() {
		if err := relayEvent(relayURL, secret, event); err != nil {
			mu.Lock()
			stats.RelayFailures++
			mu.Unlock()
			log.Printf("authenticated WAF event relay failed event_id=%s: %v", event.ID, err)
		}
	}()
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "received", "relay": "queued"})
}

func createNonce() (string, error) {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate relay nonce: %w", err)
	}
	return hex.EncodeToString(value), nil
}

func signWorkerEvent(secret, timestamp, nonce string, payload []byte) string {
	bodyHash := sha256.Sum256(payload)
	material := strings.Join([]string{workerEventSignatureVersion, workerID, timestamp, nonce, hex.EncodeToString(bodyHash[:])}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(material))
	return hex.EncodeToString(mac.Sum(nil))
}

func validateRelayURL(rawURL string) (*url.URL, error) {
	endpoint, err := url.ParseRequestURI(rawURL)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, errors.New("WORKER_RELAY_URL must be an absolute URL")
	}
	if isProduction() && endpoint.Scheme != "https" {
		return nil, errors.New("WORKER_RELAY_URL must use HTTPS in production")
	}
	return endpoint, nil
}

func relayEvent(rawURL, secret string, event WAFEvent) error {
	if len(secret) < 32 {
		return errors.New("WORKER_EVENT_HMAC_SECRET must be at least 32 characters")
	}
	endpoint, err := validateRelayURL(rawURL)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]interface{}{"event": "waf_event", "data": event})
	if err != nil {
		return fmt.Errorf("marshal WAF event: %w", err)
	}
	nonce, err := createNonce()
	if err != nil {
		return err
	}
	timestamp := strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create relay request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NDSEP-Worker-ID", workerID)
	req.Header.Set("X-NDSEP-Event-Timestamp", timestamp)
	req.Header.Set("X-NDSEP-Event-Nonce", nonce)
	req.Header.Set("X-NDSEP-Event-Signature", signWorkerEvent(secret, timestamp, nonce, payload))

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("deliver signed relay event: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("relay endpoint rejected event with HTTP %d", response.StatusCode)
	}
	return nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/stats", statsHandler)
	mux.HandleFunc("/event", eventHandler)

	log.Printf("OpenAppSec WAF Worker starting on :%s", port)
	server := &http.Server{
		Addr:              fmt.Sprintf(":%s", port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Server failed: %v", err)
	}
}
