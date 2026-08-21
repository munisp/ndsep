// NDSEP Agent Worker (Go)
package main

import (
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
workerID          = "ndsep-agent"
listenPort        = ":8111"
heartbeatInterval = 30 * time.Second
)

var (
db             *sql.DB
heartbeatCount int64
lastHeartbeat  time.Time
)

func sendHeartbeats() {
if db == nil {
return
}
rows, err := db.Query(`SELECT id FROM organizations WHERE agent_installed = true LIMIT 20`)
if err != nil {
return
}
defer rows.Close()
for rows.Next() {
var orgID int
rows.Scan(&orgID)
db.Exec(`UPDATE organizations SET last_agent_heartbeat = NOW() WHERE id = $1`, orgID)
heartbeatCount++
}
lastHeartbeat = time.Now()
}

func handleAgentRegister(w http.ResponseWriter, r *http.Request) {
var body struct {
OrgID    int    `json:"org_id"`
AgentVer string `json:"agent_version"`
}
json.NewDecoder(r.Body).Decode(&body)
if db != nil && body.OrgID > 0 {
db.Exec(`UPDATE organizations SET agent_installed=true, agent_version=$1, last_agent_heartbeat=NOW(), updated_at=NOW() WHERE id=$2`,
body.AgentVer, body.OrgID)
}
json.NewEncoder(w).Encode(map[string]interface{}{"status": "registered", "org_id": body.OrgID})
}

func handleInstallScript(w http.ResponseWriter, r *http.Request) {
orgID := r.URL.Query().Get("org_id")
serverURL := os.Getenv("NDSEP_SERVER_URL")
if serverURL == "" {
serverURL = "https://ndsep.gov.ng"
}
script := fmt.Sprintf("#!/bin/bash\n# NDSEP Agent Install Script\n# Org: %s\ncurl -sSL %s/api/agent/download -o /usr/local/bin/ndsep-agent\nchmod +x /usr/local/bin/ndsep-agent\necho 'org_id=%s\nserver_url=%s' > /etc/ndsep/agent.conf\necho 'Agent installed'\n", orgID, serverURL, orgID, serverURL)
w.Header().Set("Content-Type", "text/plain")
w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=install-ndsep-agent-org%s.sh", orgID))
fmt.Fprint(w, script)
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
go func() {
t := time.NewTicker(heartbeatInterval)
defer t.Stop()
for range t.C {
sendHeartbeats()
}
}()
mux := http.NewServeMux()
mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "worker": workerID, "heartbeat_count": heartbeatCount})
})
mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
json.NewEncoder(w).Encode(map[string]interface{}{"heartbeat_count": heartbeatCount, "last_heartbeat": lastHeartbeat.Unix()})
})
mux.HandleFunc("/api/agent/register", handleAgentRegister)
mux.HandleFunc("/api/agent/install-script", handleInstallScript)
log.Fatal(http.ListenAndServe(listenPort, mux))
}
