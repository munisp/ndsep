package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// OpenAppSec WAF Integration Worker
// Monitors and manages WAF rules, threat detection, and request filtering.

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
	ThreatsByType   map[string]int `json:"threats_by_type"`
	TopAttackerIPs  []string       `json:"top_attacker_ips"`
	LastUpdated     time.Time      `json:"last_updated"`
}

var (
	stats = WAFStats{
		ThreatsByType: make(map[string]int),
	}
	mu sync.Mutex
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "openappsec-waf-worker",
		"version": "1.0.0",
	})
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	json.NewEncoder(w).Encode(stats)
}

func eventHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var event WAFEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	mu.Lock()
	stats.TotalRequests++
	if event.Action == "block" {
		stats.BlockedRequests++
		stats.ThreatsByType[event.Threat]++
	}
	stats.LastUpdated = time.Now()
	mu.Unlock()

	// Relay to main API
	relayURL := os.Getenv("WORKER_RELAY_URL")
	if relayURL != "" {
		go relayEvent(relayURL, event)
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "received"})
}

func relayEvent(url string, event WAFEvent) {
	payload, _ := json.Marshal(map[string]interface{}{
		"event": "waf_event",
		"data":  event,
	})
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Content-Type", "application/json")
	req.Body = http.NoBody
	// Use the payload
	_ = payload
	client := &http.Client{Timeout: 5 * time.Second}
	client.Do(req)
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
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
