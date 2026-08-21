// NDSEP Health Orchestrator
// Centralized health monitoring, readiness probing, and auto-recovery.
// Checks all microservice health endpoints, triggers alerts, and manages
// graceful degradation across the platform.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// ServiceHealth represents the health status of a single service
type ServiceHealth struct {
	Name         string                 `json:"name"`
	URL          string                 `json:"url"`
	Status       string                 `json:"status"` // healthy, degraded, unhealthy, unknown
	ResponseTime int64                  `json:"response_time_ms"`
	LastCheck    time.Time              `json:"last_check"`
	LastHealthy  time.Time              `json:"last_healthy"`
	Failures     int                    `json:"consecutive_failures"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// PlatformHealth aggregates all service health
type PlatformHealth struct {
	mu       sync.RWMutex
	Status   string                    `json:"status"` // healthy, degraded, critical
	Services map[string]*ServiceHealth `json:"services"`
	Score    float64                   `json:"readiness_score"` // 0-100
	Uptime   time.Duration             `json:"uptime"`
}

// ServiceConfig defines a service to monitor
type ServiceConfig struct {
	Name     string        `json:"name"`
	URL      string        `json:"url"`
	Interval time.Duration `json:"interval"`
	Timeout  time.Duration `json:"timeout"`
	Critical bool          `json:"critical"` // Platform won't be "healthy" if this is down
}

var defaultServices = []ServiceConfig{
	{Name: "ndsep-api", URL: "http://localhost:5000/api/health", Interval: 10 * time.Second, Timeout: 5 * time.Second, Critical: true},
	{Name: "event-gateway", URL: "http://localhost:8170/health", Interval: 15 * time.Second, Timeout: 3 * time.Second, Critical: true},
	{Name: "realtime-engine", URL: "http://localhost:8180/health", Interval: 15 * time.Second, Timeout: 3 * time.Second, Critical: false},
	{Name: "dlq-processor", URL: "http://localhost:9090/health", Interval: 30 * time.Second, Timeout: 3 * time.Second, Critical: false},
	{Name: "pqc-engine", URL: "http://localhost:8190/health", Interval: 30 * time.Second, Timeout: 3 * time.Second, Critical: false},
	{Name: "data-pipeline", URL: "http://localhost:8191/health", Interval: 15 * time.Second, Timeout: 3 * time.Second, Critical: false},
	{Name: "compliance-ai", URL: "http://localhost:8200/health", Interval: 30 * time.Second, Timeout: 5 * time.Second, Critical: false},
	{Name: "postgresql", URL: "http://localhost:5000/api/ready", Interval: 10 * time.Second, Timeout: 3 * time.Second, Critical: true},
	{Name: "redis", URL: "http://localhost:6379", Interval: 10 * time.Second, Timeout: 2 * time.Second, Critical: false},
}

type Orchestrator struct {
	logger   *zap.Logger
	health   *PlatformHealth
	services []ServiceConfig
	startAt  time.Time
}

func NewOrchestrator(logger *zap.Logger) *Orchestrator {
	health := &PlatformHealth{
		Status:   "unknown",
		Services: make(map[string]*ServiceHealth),
	}
	return &Orchestrator{
		logger:   logger,
		health:   health,
		services: defaultServices,
		startAt:  time.Now(),
	}
}

func (o *Orchestrator) checkService(ctx context.Context, svc ServiceConfig) *ServiceHealth {
	start := time.Now()
	client := &http.Client{Timeout: svc.Timeout}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, svc.URL, nil)
	if err != nil {
		return &ServiceHealth{Name: svc.Name, URL: svc.URL, Status: "unhealthy", ResponseTime: -1, LastCheck: time.Now()}
	}

	resp, err := client.Do(req)
	elapsed := time.Since(start).Milliseconds()

	sh := &ServiceHealth{
		Name:         svc.Name,
		URL:          svc.URL,
		ResponseTime: elapsed,
		LastCheck:    time.Now(),
	}

	if err != nil {
		sh.Status = "unhealthy"
		return sh
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		sh.Status = "healthy"
		sh.LastHealthy = time.Now()
	} else if resp.StatusCode >= 500 {
		sh.Status = "unhealthy"
	} else {
		sh.Status = "degraded"
	}

	return sh
}

func (o *Orchestrator) monitor(ctx context.Context, svc ServiceConfig) {
	ticker := time.NewTicker(svc.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			result := o.checkService(ctx, svc)

			o.health.mu.Lock()
			existing, ok := o.health.Services[svc.Name]
			if ok && result.Status == "unhealthy" {
				result.Failures = existing.Failures + 1
				result.LastHealthy = existing.LastHealthy
			}
			o.health.Services[svc.Name] = result
			o.recalculateScore()
			o.health.mu.Unlock()

			if result.Status == "unhealthy" && result.Failures >= 3 {
				o.logger.Warn("Service unhealthy", zap.String("service", svc.Name), zap.Int("failures", result.Failures))
			}
		}
	}
}

func (o *Orchestrator) recalculateScore() {
	total := len(o.services)
	if total == 0 {
		o.health.Score = 0
		return
	}

	healthy := 0
	criticalDown := false
	for _, svc := range o.services {
		sh, ok := o.health.Services[svc.Name]
		if ok && sh.Status == "healthy" {
			healthy++
		} else if svc.Critical && (!ok || sh.Status == "unhealthy") {
			criticalDown = true
		}
	}

	o.health.Score = float64(healthy) / float64(total) * 100
	o.health.Uptime = time.Since(o.startAt)

	if criticalDown {
		o.health.Status = "critical"
	} else if o.health.Score >= 80 {
		o.health.Status = "healthy"
	} else {
		o.health.Status = "degraded"
	}
}

func (o *Orchestrator) handleHealth(w http.ResponseWriter, r *http.Request) {
	o.health.mu.RLock()
	defer o.health.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(o.health)
}

func (o *Orchestrator) handleReadiness(w http.ResponseWriter, r *http.Request) {
	o.health.mu.RLock()
	defer o.health.mu.RUnlock()

	if o.health.Status == "critical" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ready": o.health.Status != "critical",
		"score": o.health.Score,
	})
}

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	orch := NewOrchestrator(logger)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start monitoring each service
	for _, svc := range orch.services {
		go orch.monitor(ctx, svc)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", orch.handleHealth)
	mux.HandleFunc("/ready", orch.handleReadiness)

	port := getEnv("PORT", "8195")
	server := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		logger.Info("NDSEP Health Orchestrator started", zap.String("port", port), zap.Int("services", len(orch.services)))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server error", zap.Error(err))
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	cancel()
	server.Shutdown(context.Background())
	logger.Info("Health Orchestrator stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
