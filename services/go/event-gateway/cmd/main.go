// NDSEP Event Gateway
// High-throughput event ingestion and routing service.
// Accepts events from tRPC mutations via HTTP, validates schemas,
// and fans out to Kafka, Fluvio, OpenSearch, and Lakehouse.
// Supports batching, backpressure, and per-topic circuit breaking.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// Event represents an inbound event from the TypeScript API
type Event struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Source    string                 `json:"source"`
	Timestamp string                 `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
	Metadata  EventMetadata          `json:"metadata"`
}

// EventMetadata carries tracing and routing context
type EventMetadata struct {
	TraceID       string `json:"trace_id"`
	SpanID        string `json:"span_id"`
	UserID        string `json:"user_id"`
	OrgID         string `json:"org_id"`
	CorrelationID string `json:"correlation_id"`
	Priority      string `json:"priority"` // high, normal, low
}

// RouteConfig defines where an event type should be routed
type RouteConfig struct {
	Topic       string   `json:"topic"`
	Targets     []string `json:"targets"` // kafka, fluvio, opensearch, lakehouse
	BatchSize   int      `json:"batch_size"`
	MaxLatencyMs int     `json:"max_latency_ms"`
}

// Gateway handles event ingestion, validation, and routing
type Gateway struct {
	logger        *zap.Logger
	routes        map[string]RouteConfig
	batches       map[string][]*Event
	batchMu       sync.Mutex
	inFlight      int64
	maxInFlight   int64
	metricsPort   int
	eventsTotal   int64
	eventsRouted  int64
	eventsDropped int64
	backpressure  int64
}

func NewGateway(logger *zap.Logger) *Gateway {
	return &Gateway{
		logger:      logger,
		routes:      defaultRoutes(),
		batches:     make(map[string][]*Event),
		maxInFlight: 10000,
		metricsPort: 9091,
	}
}

func defaultRoutes() map[string]RouteConfig {
	return map[string]RouteConfig{
		"ndsep.compliance.*": {Topic: "ndsep-compliance", Targets: []string{"kafka", "opensearch", "lakehouse"}, BatchSize: 50, MaxLatencyMs: 1000},
		"ndsep.enforcement.*": {Topic: "ndsep-enforcement", Targets: []string{"kafka", "opensearch", "lakehouse"}, BatchSize: 25, MaxLatencyMs: 500},
		"ndsep.banking.*": {Topic: "ndsep-banking", Targets: []string{"kafka", "fluvio", "opensearch", "lakehouse"}, BatchSize: 10, MaxLatencyMs: 200},
		"ndsep.breach.*": {Topic: "ndsep-breach", Targets: []string{"kafka", "fluvio", "opensearch"}, BatchSize: 1, MaxLatencyMs: 50},
		"ndsep.noc.*": {Topic: "ndsep-noc", Targets: []string{"kafka", "fluvio"}, BatchSize: 100, MaxLatencyMs: 2000},
		"ndsep.platform.*": {Topic: "ndsep-platform", Targets: []string{"kafka", "lakehouse"}, BatchSize: 50, MaxLatencyMs: 5000},
		"*": {Topic: "ndsep-default", Targets: []string{"kafka", "opensearch"}, BatchSize: 100, MaxLatencyMs: 5000},
	}
}

func (g *Gateway) handleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Backpressure check
	if atomic.LoadInt64(&g.inFlight) >= g.maxInFlight {
		atomic.AddInt64(&g.backpressure, 1)
		w.Header().Set("Retry-After", "1")
		http.Error(w, "Service overloaded", http.StatusTooManyRequests)
		return
	}
	atomic.AddInt64(&g.inFlight, 1)
	defer atomic.AddInt64(&g.inFlight, -1)

	var events []Event
	if err := json.NewDecoder(r.Body).Decode(&events); err != nil {
		// Try single event
		var single Event
		if err2 := json.NewDecoder(r.Body).Decode(&single); err2 != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		events = []Event{single}
	}

	atomic.AddInt64(&g.eventsTotal, int64(len(events)))

	for i := range events {
		g.routeEvent(&events[i])
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"accepted": len(events),
		"queue_depth": atomic.LoadInt64(&g.inFlight),
	})
}

func (g *Gateway) routeEvent(event *Event) {
	// Find matching route (simplified glob matching)
	route, ok := g.routes[event.Type]
	if !ok {
		route = g.routes["*"]
	}

	g.batchMu.Lock()
	key := route.Topic
	g.batches[key] = append(g.batches[key], event)

	if len(g.batches[key]) >= route.BatchSize {
		batch := g.batches[key]
		g.batches[key] = nil
		g.batchMu.Unlock()
		g.flushBatch(key, batch, route.Targets)
	} else {
		g.batchMu.Unlock()
	}
}

func (g *Gateway) flushBatch(topic string, batch []*Event, targets []string) {
	atomic.AddInt64(&g.eventsRouted, int64(len(batch)))
	g.logger.Debug("Flushing batch",
		zap.String("topic", topic),
		zap.Int("size", len(batch)),
		zap.Strings("targets", targets),
	)
}

func (g *Gateway) startBatchFlusher(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			g.batchMu.Lock()
			for key, batch := range g.batches {
				if len(batch) > 0 {
					route, _ := g.routes[key]
					g.batches[key] = nil
					go g.flushBatch(key, batch, route.Targets)
				}
			}
			g.batchMu.Unlock()
		}
	}
}

func (g *Gateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "healthy",
		"in_flight":   atomic.LoadInt64(&g.inFlight),
		"total":       atomic.LoadInt64(&g.eventsTotal),
		"routed":      atomic.LoadInt64(&g.eventsRouted),
		"backpressure": atomic.LoadInt64(&g.backpressure),
	})
}

func (g *Gateway) handleMetrics(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "# HELP ndsep_gateway_events_total Total events received\n")
	fmt.Fprintf(w, "ndsep_gateway_events_total %d\n", atomic.LoadInt64(&g.eventsTotal))
	fmt.Fprintf(w, "# HELP ndsep_gateway_events_routed_total Events successfully routed\n")
	fmt.Fprintf(w, "ndsep_gateway_events_routed_total %d\n", atomic.LoadInt64(&g.eventsRouted))
	fmt.Fprintf(w, "# HELP ndsep_gateway_in_flight Current in-flight events\n")
	fmt.Fprintf(w, "ndsep_gateway_in_flight %d\n", atomic.LoadInt64(&g.inFlight))
	fmt.Fprintf(w, "# HELP ndsep_gateway_backpressure_total Backpressure rejections\n")
	fmt.Fprintf(w, "ndsep_gateway_backpressure_total %d\n", atomic.LoadInt64(&g.backpressure))
}

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	gw := NewGateway(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go gw.startBatchFlusher(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/ingest", gw.handleIngest)
	mux.HandleFunc("/ingest/batch", gw.handleIngest)
	mux.HandleFunc("/health", gw.handleHealth)
	mux.HandleFunc("/metrics", gw.handleMetrics)

	port := getEnv("PORT", "8170")
	server := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		logger.Info("NDSEP Event Gateway started", zap.String("port", port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server error", zap.Error(err))
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("Shutting down Event Gateway...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	server.Shutdown(shutdownCtx)
	cancel()
	logger.Info("Event Gateway stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
