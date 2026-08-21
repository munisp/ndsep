// NDSEP GitOps Config Sync Worker (Go)
package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"context"
	"os/signal"
	"syscall"
	_ "github.com/lib/pq"
)

const (
workerID     = "gitops-sync"
listenPort   = ":8112"
syncInterval = 10 * time.Minute
)

var (
db         *sql.DB
syncCount  int64
driftCount int64
lastSyncAt time.Time
)

type ConfigState struct {
PolicyCount      int     `json:"policy_count"`
OrgCount         int     `json:"org_count"`
ActiveViolations int     `json:"active_violations"`
AvgCompliance    float64 `json:"avg_compliance"`
}

func captureSnapshot() {
if db == nil {
return
}
var state ConfigState
db.QueryRow(`SELECT COUNT(*) FROM compliance_policies WHERE is_active = true`).Scan(&state.PolicyCount)
db.QueryRow(`SELECT COUNT(*) FROM organizations`).Scan(&state.OrgCount)
db.QueryRow(`SELECT COUNT(*) FROM compliance_violations WHERE status != 'compliant'`).Scan(&state.ActiveViolations)
db.QueryRow(`SELECT COALESCE(AVG(compliance_score), 0) FROM organizations`).Scan(&state.AvgCompliance)

data, _ := json.Marshal(state)
hash := fmt.Sprintf("%x", sha256.Sum256(data))

// Check last snapshot for drift
var lastHash string
var lastData []byte
db.QueryRow(`SELECT commit_hash, config_data FROM config_snapshots ORDER BY created_at DESC LIMIT 1`).Scan(&lastHash, &lastData)

status := "synced"
var driftSummary interface{}
if lastHash != "" && lastHash != hash {
status = "drifted"
driftCount++
var lastState ConfigState
json.Unmarshal(lastData, &lastState)
driftSummary = map[string]interface{}{
"policy_count_delta":      state.PolicyCount - lastState.PolicyCount,
"org_count_delta":         state.OrgCount - lastState.OrgCount,
"violations_delta":        state.ActiveViolations - lastState.ActiveViolations,
"avg_compliance_delta":    state.AvgCompliance - lastState.AvgCompliance,
}
}

driftJSON, _ := json.Marshal(driftSummary)
db.Exec(`
INSERT INTO config_snapshots (snapshot_name, source, config_data, status, drift_summary, commit_hash, created_at)
VALUES ($1, 'scheduled', $2, $3, $4, $5, NOW())
`, fmt.Sprintf("auto-snapshot-%s", time.Now().Format("20060102-150405")),
string(data), status, string(driftJSON), hash)

syncCount++
lastSyncAt = time.Now()
log.Printf("[%s] Snapshot captured, status=%s", workerID, status)
}

// gracefulShutdown wraps http.Server with SIGTERM/SIGINT handling
func gracefulShutdown(workerID, port string, handler http.Handler) {
srv := &http.Server{
Addr:         ":" + port,
Handler:      handler,
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
log.Printf("[%s] Shutdown complete", workerID)
}

func main() {
log.Printf("[%s] Starting on %s", workerID, listenPort)
dbURL := os.Getenv("WORKER_DATABASE_URL")
if dbURL == "" {
dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
}
var err error
db, err = sql.Open("postgres", dbURL)
if err == nil {
if err = db.Ping(); err != nil {
db = nil
} else {
log.Printf("[%s] Connected to PostgreSQL", workerID)
}
}

go captureSnapshot()
go func() {
t := time.NewTicker(syncInterval)
defer t.Stop()
for range t.C {
captureSnapshot()
}
}()

mux := http.NewServeMux()
mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
json.NewEncoder(w).Encode(map[string]interface{}{
"status": "ok", "worker": workerID,
"sync_count": syncCount, "drift_count": driftCount,
})
})
mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
json.NewEncoder(w).Encode(map[string]interface{}{
"sync_count": syncCount, "drift_count": driftCount,
"last_sync_at": lastSyncAt.Unix(),
})
})
mux.HandleFunc("/api/sync/trigger", func(w http.ResponseWriter, r *http.Request) {
go captureSnapshot()
json.NewEncoder(w).Encode(map[string]interface{}{"status": "triggered"})
})
log.Fatal(http.ListenAndServe(listenPort, mux))
}
