// NDSEP Workflow Engine (Go) — Real Temporal Go SDK integration. Port 8170.
//
// Temporal (go.temporal.io/sdk):
//   - Connects to Temporal server via gRPC (TEMPORAL_HOST:7233)
//   - Executes enforcement workflows: ComplianceEnforcement, PenaltyDispute,
//     IncidentResponse, CrossBorderApproval, NightlyMLRetrain
//   - Queries workflow status via Temporal client
//   - Rejects workflow operations when Temporal is unreachable; durable execution is required.
//
// Nightly ML Retrain cron:
//   - Registered as Temporal schedule "ndsep-ml-nightly-retrain"
//   - Runs at 02:00 UTC daily
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"go.temporal.io/sdk/client"
)

var logger = log.New(os.Stdout, "[workflow-engine] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	temporalHost    = getenv("TEMPORAL_HOST", "localhost:7233")
	temporalEnabled = getenv("TEMPORAL_ENABLED", "true") == "true"
	taskQueue       = getenv("TEMPORAL_TASK_QUEUE", "ndsep-enforcement")
)

var (
	mu               sync.RWMutex
	temporalClient   client.Client
	temporalOK       bool
	workflowsStarted int64
	workflowErrors   int64
)

// ─── Temporal Init ────────────────────────────────────────────────────────────

func initTemporal() {
	if !temporalEnabled {
		logger.Println("[Temporal] Disabled")
		return
	}
	go func() {
		for {
			c, err := client.Dial(client.Options{
				HostPort:  temporalHost,
				Namespace: "default",
			})
			if err != nil {
				logger.Printf("[Temporal] Connect failed (%v), retry in 15s", err)
				mu.Lock()
				temporalOK = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			mu.Lock()
			temporalClient = c
			temporalOK = true
			mu.Unlock()
			logger.Printf("[Temporal] Connected to %s", temporalHost)
			// Register nightly ML retrain schedule
			go registerNightlyRetrainSchedule(c)
			return
		}
	}()
}

func registerNightlyRetrainSchedule(c client.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	scheduleID := "ndsep-ml-nightly-retrain"
	sc := c.ScheduleClient()
	_, err := sc.Create(ctx, client.ScheduleOptions{
		ID: scheduleID,
		Spec: client.ScheduleSpec{
			CronExpressions: []string{"0 2 * * *"},
		},
		Action: &client.ScheduleWorkflowAction{
			Workflow:  "NightlyMLRetrainWorkflow",
			TaskQueue: taskQueue,
		},
	})
	if err != nil {
		// Schedule may already exist — not an error
		logger.Printf("[Temporal] Schedule %s: %v (may already exist)", scheduleID, err)
	} else {
		logger.Printf("[Temporal] Registered schedule: %s (02:00 UTC daily)", scheduleID)
	}
}

// ─── Workflow Execution ───────────────────────────────────────────────────────

func executeWorkflow(workflowType, workflowID string, input map[string]interface{}) (string, error) {
	mu.RLock()
	c := temporalClient
	ok := temporalOK
	mu.RUnlock()

	if ok && c != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		opts := client.StartWorkflowOptions{
			ID:        workflowID,
			TaskQueue: taskQueue,
		}
		run, err := c.ExecuteWorkflow(ctx, opts, workflowType, input)
		if err != nil {
			atomic.AddInt64(&workflowErrors, 1)
			return "", fmt.Errorf("temporal: %w", err)
		}
		atomic.AddInt64(&workflowsStarted, 1)
		return run.GetRunID(), nil
	}

	atomic.AddInt64(&workflowErrors, 1)
	return "", fmt.Errorf("temporal workflow service is unavailable")
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	tOK := temporalOK
	mu.RUnlock()
	status := "healthy"
	if !tOK {
		status = "degraded"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":            "workflow-engine",
		"status":             status,
		"temporal_host":      temporalHost,
		"temporal_connected": tOK,
		"task_queue":         taskQueue,
		"workflows_started":  atomic.LoadInt64(&workflowsStarted),
		"workflow_errors":    atomic.LoadInt64(&workflowErrors),
		"uptime_seconds":     time.Since(startTime).Seconds(),
		"timestamp":          time.Now().UTC(),
	})
}

func startWorkflowHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkflowType string                 `json:"workflowType"`
		WorkflowID   string                 `json:"workflowId"`
		Input        map[string]interface{} `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if req.WorkflowID == "" {
		req.WorkflowID = uuid.New().String()
	}
	if req.WorkflowType == "" {
		http.Error(w, `{"error":"workflowType required"}`, http.StatusBadRequest)
		return
	}
	runID, err := executeWorkflow(req.WorkflowType, req.WorkflowID, req.Input)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	mu.RLock()
	tOK := temporalOK
	mu.RUnlock()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":                 true,
		"workflow_id":        req.WorkflowID,
		"run_id":             runID,
		"status":             "running",
		"temporal_connected": tOK,
		"temporal_url":       fmt.Sprintf("http://%s/namespaces/default/workflows/%s", temporalHost, req.WorkflowID),
	})
}

func listWorkflowsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	tOK := temporalOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	if !tOK {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "temporal workflow service is unavailable"})
		return
	}
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]interface{}{"error": "workflow listing must be queried from Temporal visibility; local workflow mirrors are intentionally disabled"})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	tOK := temporalOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"temporalConnected": tOK,
		"workflowsStarted":  atomic.LoadInt64(&workflowsStarted),
		"workflowErrors":    atomic.LoadInt64(&workflowErrors),
		"uptimeSeconds":     time.Since(startTime).Seconds(),
	})
}

func main() {
	port := getenv("PORT", "8170")
	initTemporal()

	r := mux.NewRouter()
	r.HandleFunc("/health", healthHandler).Methods(http.MethodGet)
	r.HandleFunc("/workflows/start", startWorkflowHandler).Methods(http.MethodPost)
	r.HandleFunc("/workflows", listWorkflowsHandler).Methods(http.MethodGet)
	r.HandleFunc("/metrics", metricsHandler).Methods(http.MethodGet)

	logger.Printf("NDSEP Workflow Engine starting on :%s (Temporal=%s, Queue=%s)", port, temporalHost, taskQueue)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		logger.Fatalf("Server failed: %v", err)
	}
}
