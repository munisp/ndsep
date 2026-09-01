// NDSEP Fluvio Event Relay — Go Worker
// Port 8151 | Bridges tRPC events to Fluvio streaming platform
// Fluvio is a Rust-native, Kafka-compatible streaming platform
// Production delivery is fail closed when Fluvio is unavailable or unauthenticated.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

var (
	PORT            = getEnv("FLUVIO_RELAY_PORT", "8151")
	FLUVIO_ENDPOINT = strings.TrimSpace(os.Getenv("FLUVIO_ENDPOINT"))
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	produceCount int64
	consumeCount int64
	topicCount   int64
	errorCount   int64
	startTime    = time.Now()
)

// NDSEP Fluvio topics — one per compliance domain
var NdsepTopics = []string{
	"ndsep.compliance.events",
	"ndsep.audit.trail",
	"ndsep.breach.notifications",
	"ndsep.aml.cases",
	"ndsep.kyc.updates",
	"ndsep.accreditation.decisions",
	"ndsep.sector.alerts",
	"ndsep.watchlist.hits",
	"ndsep.fine.payments",
	"ndsep.dpco.enforcement",
	"ndsep.temporal.signals",
	"ndsep.cross.agency.alerts",
	"ndsep.mojaloop.payments",
	"ndsep.tigerbeetle.ledger",
	"ndsep.opensearch.index",
	"ndsep.lakehouse.ingest",
}

type ProduceRequest struct {
	Topic   string                 `json:"topic"`
	Key     string                 `json:"key,omitempty"`
	Payload map[string]interface{} `json:"payload"`
	Headers map[string]string      `json:"headers,omitempty"`
}

type ConsumeRequest struct {
	Topic      string `json:"topic"`
	Partition  int    `json:"partition,omitempty"`
	Offset     int64  `json:"offset,omitempty"`
	MaxRecords int    `json:"maxRecords,omitempty"`
}

type TopicCreateRequest struct {
	Name              string `json:"name"`
	Partitions        int    `json:"partitions,omitempty"`
	ReplicationFactor int    `json:"replicationFactor,omitempty"`
	RetentionMs       int64  `json:"retentionMs,omitempty"`
}

func isProduction() bool {
	return strings.EqualFold(os.Getenv("APP_ENV"), "production") || strings.EqualFold(os.Getenv("NODE_ENV"), "production")
}

func validateFluvioConfiguration() error {
	produceURL := strings.TrimRight(strings.TrimSpace(os.Getenv("FLUVIO_PRODUCE_URL")), "/")
	if FLUVIO_ENDPOINT == "" && produceURL == "" {
		return errors.New("FLUVIO_ENDPOINT or FLUVIO_PRODUCE_URL is required")
	}
	if isProduction() {
		if produceURL == "" {
			return errors.New("production Fluvio relay requires FLUVIO_PRODUCE_URL")
		}
		parsed, err := url.ParseRequestURI(produceURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return errors.New("production FLUVIO_PRODUCE_URL must be an absolute HTTPS endpoint")
		}
		if len(strings.TrimSpace(os.Getenv("FLUVIO_AUTH_TOKEN"))) < 32 {
			return errors.New("production Fluvio relay requires a non-placeholder FLUVIO_AUTH_TOKEN of at least 32 characters")
		}
	}
	return nil
}

func isApprovedTopic(topic string) bool {
	for _, approved := range NdsepTopics {
		if topic == approved {
			return true
		}
	}
	return false
}

func fluvioProduce(topic, key string, payload interface{}) error {
	if !isApprovedTopic(topic) {
		return fmt.Errorf("Fluvio topic is not allow-listed: %s", topic)
	}
	if isProduction() && !strings.EqualFold(os.Getenv("FLUVIO_ENABLED"), "true") {
		return errors.New("Fluvio is disabled in production; set FLUVIO_ENABLED=true only after approved cluster validation")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal Fluvio payload: %w", err)
	}
	endpoint := fmt.Sprintf("http://%s/api/v1/produce/%s", FLUVIO_ENDPOINT, topic)
	if raw := os.Getenv("FLUVIO_PRODUCE_URL"); raw != "" {
		endpoint = fmt.Sprintf("%s/%s", strings.TrimRight(raw, "/"), topic)
	}
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("FLUVIO_PRODUCE_URL must be an absolute endpoint")
	}
	if isProduction() && parsed.Scheme != "https" {
		return errors.New("production Fluvio endpoint must use HTTPS")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Fluvio request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("X-Fluvio-Key", key)
	}
	if token := os.Getenv("FLUVIO_AUTH_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	} else if isProduction() {
		return errors.New("production Fluvio requires FLUVIO_AUTH_TOKEN")
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Fluvio required delivery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Fluvio required delivery failed with HTTP %d", resp.StatusCode)
	}
	return nil
}

func handleProduce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ProduceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !isApprovedTopic(req.Topic) {
		http.Error(w, "allow-listed topic required", http.StatusBadRequest)
		return
	}

	// Enrich payload with NDSEP metadata
	if req.Payload == nil {
		req.Payload = map[string]interface{}{}
	}
	req.Payload["_ndsep_ts"] = time.Now().UnixMilli()
	req.Payload["_ndsep_source"] = "fluvio-relay"
	req.Payload["_ndsep_topic"] = req.Topic

	if err := fluvioProduce(req.Topic, req.Key, req.Payload); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	atomic.AddInt64(&produceCount, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"topic":   req.Topic,
		"ts":      time.Now().UnixMilli(),
	})
}

func handleTopics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"topics": NdsepTopics,
		"count":  len(NdsepTopics),
	})
}

func handleTopicCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req TopicCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !isApprovedTopic(req.Name) {
		http.Error(w, "allow-listed topic required", http.StatusBadRequest)
		return
	}
	http.Error(w, "topic provisioning is disabled; use the authenticated Fluvio control plane", http.StatusNotImplemented)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "ndsep-fluvio-relay",
		"version": "1.1.0",
		"uptime":  time.Since(startTime).Seconds(),
		"config": map[string]string{
			"fluvio_endpoint": FLUVIO_ENDPOINT,
		},
		"topics": len(NdsepTopics),
	})
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP ndsep_fluvio_produce_total Total Fluvio produce calls\n")
	fmt.Fprintf(w, "# TYPE ndsep_fluvio_produce_total counter\n")
	fmt.Fprintf(w, "ndsep_fluvio_produce_total %d\n", atomic.LoadInt64(&produceCount))
	fmt.Fprintf(w, "# HELP ndsep_fluvio_errors_total Total errors\n")
	fmt.Fprintf(w, "# TYPE ndsep_fluvio_errors_total counter\n")
	fmt.Fprintf(w, "ndsep_fluvio_errors_total %d\n", atomic.LoadInt64(&errorCount))
	fmt.Fprintf(w, "# HELP ndsep_fluvio_uptime_seconds Uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE ndsep_fluvio_uptime_seconds gauge\n")
	fmt.Fprintf(w, "ndsep_fluvio_uptime_seconds %.2f\n", time.Since(startTime).Seconds())
}

func main() {
	if err := validateFluvioConfiguration(); err != nil {
		log.Fatal("[FluvioRelay] ", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/produce", handleProduce)
	mux.HandleFunc("/publish", handleProduce)
	mux.HandleFunc("/topics", handleTopics)
	mux.HandleFunc("/topics/create", handleTopicCreate)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/metrics", handleMetrics)

	log.Printf("[FluvioRelay] Starting NDSEP Fluvio Event Relay on port %s", PORT)
	log.Printf("[FluvioRelay] Fluvio endpoint: %s", FLUVIO_ENDPOINT)
	log.Printf("[FluvioRelay] Managing %d NDSEP topics", len(NdsepTopics))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_ = ctx

	server := &http.Server{
		Addr:         ":" + PORT,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("[FluvioRelay] Server error: %v", err)
	}
}
