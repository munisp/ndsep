// NDSEP Dapr Sidecar Bridge — Go Worker
// Port 8150 | Bridges tRPC events to Dapr pub/sub, state store, and service invocation
// Middleware: Dapr, Redis, Kafka, PostgreSQL
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

// ─── Config ────────────────────────────────────────────────────────────────

var (
	PORT            = getEnv("DAPR_BRIDGE_PORT", "8150")
	DAPR_HTTP_PORT  = getEnv("DAPR_HTTP_PORT", "3500")
	DAPR_GRPC_PORT  = getEnv("DAPR_GRPC_PORT", "50001")
	DAPR_APP_ID     = getEnv("DAPR_APP_ID", "ndsep-dapr-bridge")
	PUBSUB_NAME     = getEnv("DAPR_PUBSUB_NAME", "ndsep-pubsub")
	STATE_STORE     = getEnv("DAPR_STATE_STORE", "ndsep-statestore")
	KAFKA_BROKER    = getEnv("KAFKA_BROKER", "localhost:9092")
	REDIS_URL       = getEnv("REDIS_URL", "redis://localhost:6379")
		PG_URL          = os.Getenv("DATABASE_URL")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Metrics ───────────────────────────────────────────────────────────────

var (
	publishCount   int64
	stateSetCount  int64
	invokeCount    int64
	subscribeCount int64
	errorCount     int64
	startTime      = time.Now()
)

// ─── Request/Response Types ────────────────────────────────────────────────

type PublishRequest struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
	PubSub  string                 `json:"pubsub,omitempty"`
}

type StateSetRequest struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
	TTL   int         `json:"ttl,omitempty"` // seconds
}

type StateGetResponse struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
	Found bool        `json:"found"`
}

type InvokeRequest struct {
	AppID     string                 `json:"appId"`
	Method    string                 `json:"method"`
	Verb      string                 `json:"verb"`
	Data      map[string]interface{} `json:"data"`
}

type SubscribeRequest struct {
	PubSub string `json:"pubsub"`
	Topic  string `json:"topic"`
}

type DaprEvent struct {
	ID          string                 `json:"id"`
	Source      string                 `json:"source"`
	Type        string                 `json:"type"`
	SpecVersion string                 `json:"specversion"`
	DataContent string                 `json:"datacontenttype"`
	Data        map[string]interface{} `json:"data"`
	Topic       string                 `json:"topic"`
	PubSubName  string                 `json:"pubsubname"`
}

// ─── Dapr HTTP Client ──────────────────────────────────────────────────────

func daprPublish(pubsub, topic string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", DAPR_HTTP_PORT, pubsub, topic)
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Body = http.NoBody

	// Use a simple HTTP client with the body
	client := &http.Client{Timeout: 5 * time.Second}
	reqWithBody, _ := http.NewRequest("POST", url, bytesReader(body))
	reqWithBody.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(reqWithBody)
	if err != nil {
		return fmt.Errorf("Dapr publish unavailable for topic %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("dapr publish failed: status=%d", resp.StatusCode)
	}
	return nil
}

func bytesReader(b []byte) *bytesReaderImpl {
	return &bytesReaderImpl{data: b, pos: 0}
}

type bytesReaderImpl struct {
	data []byte
	pos  int
}

func (r *bytesReaderImpl) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}

func (r *bytesReaderImpl) Close() error { return nil }

func daprStateSet(stateStore, key string, value interface{}, ttl int) error {
	type stateItem struct {
		Key     string      `json:"key"`
		Value   interface{} `json:"value"`
		Options interface{} `json:"options,omitempty"`
	}
	items := []stateItem{{Key: key, Value: value}}
	body, _ := json.Marshal(items)
	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s", DAPR_HTTP_PORT, stateStore)
	client := &http.Client{Timeout: 5 * time.Second}
	reqWithBody, _ := http.NewRequest("POST", url, bytesReader(body))
	reqWithBody.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(reqWithBody)
	if err != nil {
		log.Printf("[DaprBridge] Dapr state set degraded: key=%s err=%v", key, err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ─── HTTP Handlers ─────────────────────────────────────────────────────────

func handlePublish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req PublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	pubsub := req.PubSub
	if pubsub == "" {
		pubsub = PUBSUB_NAME
	}
	if err := daprPublish(pubsub, req.Topic, req.Payload); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	atomic.AddInt64(&publishCount, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"topic":   req.Topic,
		"pubsub":  pubsub,
	})
}

func handleStateSet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req StateSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := daprStateSet(STATE_STORE, req.Key, req.Value, req.TTL); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	atomic.AddInt64(&stateSetCount, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "key": req.Key})
}

func handleStateGet(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		http.Error(w, "key required", http.StatusBadRequest)
		return
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s/%s", DAPR_HTTP_PORT, STATE_STORE, key)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		// Graceful degradation
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(StateGetResponse{Key: key, Found: false})
		return
	}
	defer resp.Body.Close()
	var value interface{}
	json.NewDecoder(resp.Body).Decode(&value)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StateGetResponse{
		Key:   key,
		Value: value,
		Found: resp.StatusCode == 200 && value != nil,
	})
}

func handleInvoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req InvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	verb := req.Verb
	if verb == "" {
		verb = "POST"
	}
	body, _ := json.Marshal(req.Data)
	url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/%s/method/%s", DAPR_HTTP_PORT, req.AppID, req.Method)
	client := &http.Client{Timeout: 10 * time.Second}
	httpReq, _ := http.NewRequest(verb, url, bytesReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[DaprBridge] Dapr invoke degraded: appId=%s method=%s err=%v", req.AppID, req.Method, err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "degraded": true})
		return
	}
	defer resp.Body.Close()
	atomic.AddInt64(&invokeCount, 1)
	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": result})
}

// Dapr subscription endpoint — receives events from Dapr pub/sub
func handleSubscribe(w http.ResponseWriter, r *http.Request) {
	// Return subscription list for Dapr to know what topics to forward
	subscriptions := []map[string]interface{}{
		{"pubsubname": PUBSUB_NAME, "topic": "ndsep.compliance.events", "route": "/dapr/events"},
		{"pubsubname": PUBSUB_NAME, "topic": "ndsep.audit.events", "route": "/dapr/events"},
		{"pubsubname": PUBSUB_NAME, "topic": "ndsep.breach.notifications", "route": "/dapr/events"},
		{"pubsubname": PUBSUB_NAME, "topic": "ndsep.aml.cases", "route": "/dapr/events"},
		{"pubsubname": PUBSUB_NAME, "topic": "ndsep.accreditation.decisions", "route": "/dapr/events"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subscriptions)
}

func handleDaprEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	atomic.AddInt64(&subscribeCount, 1)
	log.Printf("[DaprBridge] Received event: topic=%s type=%s id=%s", event.Topic, event.Type, event.ID)
	// Forward to internal audit log
	go func() {
		_ = daprStateSet(STATE_STORE, fmt.Sprintf("event:%s", event.ID), event, 86400)
	}()
	// SUCCESS response to Dapr
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(startTime).Seconds()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "ndsep-dapr-bridge",
		"version": "1.0.0",
		"uptime":  uptime,
		"config": map[string]string{
			"dapr_http_port": DAPR_HTTP_PORT,
			"dapr_app_id":    DAPR_APP_ID,
			"pubsub_name":    PUBSUB_NAME,
			"state_store":    STATE_STORE,
		},
	})
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(startTime).Seconds()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP ndsep_dapr_publish_total Total Dapr publish calls\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_publish_total counter\n")
	fmt.Fprintf(w, "ndsep_dapr_publish_total %d\n", atomic.LoadInt64(&publishCount))
	fmt.Fprintf(w, "# HELP ndsep_dapr_state_set_total Total Dapr state set calls\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_state_set_total counter\n")
	fmt.Fprintf(w, "ndsep_dapr_state_set_total %d\n", atomic.LoadInt64(&stateSetCount))
	fmt.Fprintf(w, "# HELP ndsep_dapr_invoke_total Total Dapr service invocations\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_invoke_total counter\n")
	fmt.Fprintf(w, "ndsep_dapr_invoke_total %d\n", atomic.LoadInt64(&invokeCount))
	fmt.Fprintf(w, "# HELP ndsep_dapr_subscribe_total Total Dapr events received\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_subscribe_total counter\n")
	fmt.Fprintf(w, "ndsep_dapr_subscribe_total %d\n", atomic.LoadInt64(&subscribeCount))
	fmt.Fprintf(w, "# HELP ndsep_dapr_errors_total Total errors\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_errors_total counter\n")
	fmt.Fprintf(w, "ndsep_dapr_errors_total %d\n", atomic.LoadInt64(&errorCount))
	fmt.Fprintf(w, "# HELP ndsep_dapr_uptime_seconds Uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE ndsep_dapr_uptime_seconds gauge\n")
	fmt.Fprintf(w, "ndsep_dapr_uptime_seconds %.2f\n", uptime)
}

// ─── Main ──────────────────────────────────────────────────────────────────

func main() {
	mux := http.NewServeMux()

	// Dapr required endpoints
	mux.HandleFunc("/dapr/subscribe", handleSubscribe)
	mux.HandleFunc("/dapr/events", handleDaprEvents)

	// Bridge API endpoints
	mux.HandleFunc("/publish", handlePublish)
	mux.HandleFunc("/state/set", handleStateSet)
	mux.HandleFunc("/state/get", handleStateGet)
	mux.HandleFunc("/invoke", handleInvoke)

	// Observability
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/metrics", handleMetrics)

	port, _ := strconv.Atoi(PORT)
	_ = port

	log.Printf("[DaprBridge] Starting NDSEP Dapr Sidecar Bridge on port %s", PORT)
	log.Printf("[DaprBridge] Dapr HTTP port: %s | App ID: %s", DAPR_HTTP_PORT, DAPR_APP_ID)
	log.Printf("[DaprBridge] PubSub: %s | State store: %s", PUBSUB_NAME, STATE_STORE)

	server := &http.Server{
		Addr:         ":" + PORT,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_ = ctx

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("[DaprBridge] Server error: %v", err)
	}
}
