// middleware_bridge — Go Middleware Bridge Worker
// =================================================
// Bridges tRPC router events to Kafka, Dapr, and audit log systems.
// Exposes HTTP endpoints that the Node.js tRPC server calls for:
//   POST /emit        — publish event to Kafka topic
//   POST /audit       — write structured audit log entry
//   POST /broadcast   — forward WebSocket broadcast via Dapr pub/sub
//   GET  /health      — liveness probe
//
// Port: 8140 (configurable via MIDDLEWARE_BRIDGE_PORT)
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

const defaultPort = "8140"

// ─── Request types ────────────────────────────────────────────────────────────

type EmitRequest struct {
	Topic   string                 `json:"topic"`
	Payload map[string]interface{} `json:"payload"`
}

type AuditRequest struct {
	Action       string                 `json:"action"`
	ResourceType string                 `json:"resource_type"`
	ResourceID   string                 `json:"resource_id"`
	UserID       string                 `json:"user_id"`
	Details      map[string]interface{} `json:"details"`
	IPAddress    string                 `json:"ip_address,omitempty"`
	Timestamp    string                 `json:"timestamp,omitempty"`
}

type BroadcastRequest struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
}

// ─── Kafka REST Proxy helper ──────────────────────────────────────────────────

func kafkaPublish(topic string, payload map[string]interface{}) error {
	kafkaURL := os.Getenv("KAFKA_REST_URL")
	if kafkaURL == "" {
		kafkaURL = "http://localhost:8082"
	}
	payload["ts"] = time.Now().UTC().Format(time.RFC3339)
	body := map[string]interface{}{
		"records": []map[string]interface{}{
			{"value": payload},
		},
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", fmt.Sprintf("%s/topics/%s", kafkaURL, topic), nil)
	if err != nil {
		return err
	}
	req.Body = http.NoBody
	req.ContentLength = int64(len(bodyBytes))
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Kafka] publish to %s failed: %v", topic, err)
		return nil // non-fatal
	}
	defer resp.Body.Close()
	log.Printf("[Kafka] published to %s (status %d)", topic, resp.StatusCode)
	return nil
}

// ─── Dapr pub/sub helper ──────────────────────────────────────────────────────

func daprPublish(topic string, data map[string]interface{}) {
	daprURL := os.Getenv("DAPR_HTTP_ENDPOINT")
	if daprURL == "" {
		daprURL = "http://localhost:3500"
	}
	body, _ := json.Marshal(data)
	req, err := http.NewRequest("POST",
		fmt.Sprintf("%s/v1.0/publish/ndsep-pubsub/%s", daprURL, topic), nil)
	if err != nil {
		return
	}
	req.Body = http.NoBody
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Dapr] publish to %s failed (non-fatal): %v", topic, err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[Dapr] published to %s (status %d)", topic, resp.StatusCode)
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleEmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req EmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Publish to Kafka
	go kafkaPublish(req.Topic, req.Payload)
	// Also publish via Dapr for subscribers
	go daprPublish(req.Topic, req.Payload)
	log.Printf("[Bridge] emit: topic=%s", req.Topic)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "topic": req.Topic})
}

func handleAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req AuditRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Timestamp == "" {
		req.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	// Forward audit event to Kafka audit topic
	go kafkaPublish("ndsep.audit.log", map[string]interface{}{
		"action":        req.Action,
		"resource_type": req.ResourceType,
		"resource_id":   req.ResourceID,
		"user_id":       req.UserID,
		"details":       req.Details,
		"ip_address":    req.IPAddress,
		"timestamp":     req.Timestamp,
	})
	log.Printf("[Bridge] audit: action=%s resource=%s/%s", req.Action, req.ResourceType, req.ResourceID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleBroadcast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req BroadcastRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Forward via Dapr pub/sub to WebSocket gateway
	go daprPublish("ndsep.ws.broadcast", map[string]interface{}{
		"event": req.Event,
		"data":  req.Data,
		"ts":    time.Now().UTC().Format(time.RFC3339),
	})
	log.Printf("[Bridge] broadcast: event=%s", req.Event)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "event": req.Event})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"worker": "middleware_bridge",
		"port":   os.Getenv("MIDDLEWARE_BRIDGE_PORT"),
		"ts":     time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("MIDDLEWARE_BRIDGE_PORT")
	if port == "" {
		port = defaultPort
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/emit", handleEmit)
	mux.HandleFunc("/audit", handleAudit)
	mux.HandleFunc("/broadcast", handleBroadcast)
	mux.HandleFunc("/health", handleHealth)
	// Alias endpoints for router middleware compatibility
	mux.HandleFunc("/events/relay", handleEmit)   // relay event to Kafka
	mux.HandleFunc("/audit/forward", handleAudit) // forward audit log entry
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "# HELP ndsep_middleware_bridge_up Middleware bridge is running\n")
		fmt.Fprintf(w, "# TYPE ndsep_middleware_bridge_up gauge\n")
		fmt.Fprintf(w, "ndsep_middleware_bridge_up 1\n")
		fmt.Fprintf(w, "# HELP ndsep_events_relayed_total Total events relayed to Kafka\n")
		fmt.Fprintf(w, "# TYPE ndsep_events_relayed_total counter\n")
		fmt.Fprintf(w, "ndsep_events_relayed_total 0\n")
		fmt.Fprintf(w, "# HELP ndsep_audit_logs_forwarded_total Total audit logs forwarded\n")
		fmt.Fprintf(w, "# TYPE ndsep_audit_logs_forwarded_total counter\n")
		fmt.Fprintf(w, "ndsep_audit_logs_forwarded_total 0\n")
	})

	log.Printf("[MiddlewareBridge] Starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[MiddlewareBridge] Fatal: %v", err)
	}
}
