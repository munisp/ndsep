// NDSEP API Gateway Service (Go) — Real APISIX Admin API integration. Port 8130.
//
// APISIX (Admin API v3):
//   - Syncs 30 NDSEP journey routes to APISIX via PUT /apisix/admin/routes/{id}
//   - Reads live route status via GET /apisix/admin/routes
//   - Graceful degradation: in-memory route registry when APISIX is unreachable
//   - Admin key: configurable via APISIX_ADMIN_KEY env var
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
)

var logger = log.New(os.Stdout, "[api-gateway] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	apisixAdminURL  = getenv("APISIX_ADMIN_URL", "http://localhost:9180")
	apisixAdminKey  = getenv("APISIX_ADMIN_KEY", "edd1c9f034335f136f87ad84b625c8f1")
	apisixEnabled   = getenv("APISIX_ENABLED", "true") == "true"
)

var (
	mu             sync.RWMutex
	apisixOK       bool
	routesSynced   int64
	syncErrors     int64
)

type Route struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	URI         string   `json:"uri"`
	Methods     []string `json:"methods"`
	Upstream    string   `json:"upstream"`
	JourneyID   string   `json:"journey_id"`
	Description string   `json:"description"`
}

var routes = []Route{
	{"rt-j01", "org-registration", "/api/orgs/register", []string{"POST"}, "ndsep-trpc:3000", "J01", "Organisation Registration"},
	{"rt-j02", "compliance-assess", "/api/compliance/assess", []string{"POST"}, "ndsep-trpc:3000", "J02", "Compliance Assessment"},
	{"rt-j03", "violation-detect", "/api/violations", []string{"GET", "POST"}, "ndsep-trpc:3000", "J03", "Violation Detection"},
	{"rt-j04", "penalty-issue", "/api/penalties/issue", []string{"POST"}, "ndsep-trpc:3000", "J04", "Penalty Issuance"},
	{"rt-j05", "penalty-pay", "/api/penalties/pay", []string{"POST"}, "ndsep-trpc:3000", "J05", "Penalty Payment"},
	{"rt-j06", "transfer-approve", "/api/transfers", []string{"GET", "POST"}, "ndsep-trpc:3000", "J06", "Cross-Border Transfer Approval"},
	{"rt-j07", "network-block", "/api/network/block", []string{"POST"}, "ndsep-trpc:3000", "J07", "Network Traffic Blocking"},
	{"rt-j08", "bgp-hijack", "/api/bgp/hijack", []string{"POST"}, "ndsep-trpc:3000", "J08", "BGP Hijack Response"},
	{"rt-j09", "threat-intel", "/api/siem/threats", []string{"GET", "POST"}, "ndsep-trpc:3000", "J09", "Threat Intelligence Ingestion"},
	{"rt-j10", "incident-response", "/api/incidents", []string{"GET", "POST"}, "ndsep-trpc:3000", "J10", "Incident Response Workflow"},
	{"rt-j11", "residency-audit", "/api/residency/audit", []string{"POST"}, "ndsep-trpc:3000", "J11", "Data Residency Audit"},
	{"rt-j12", "ipam-allocate", "/api/ipam/allocate", []string{"POST"}, "ndsep-trpc:3000", "J12", "IPAM Allocation"},
	{"rt-j13", "residency-violation", "/api/residency/violations", []string{"GET", "POST"}, "ndsep-trpc:3000", "J13", "Data Residency Violation"},
	{"rt-j14", "ml-risk-update", "/api/ml/risk", []string{"POST"}, "ndsep-trpc:3000", "J14", "ML Risk Score Update"},
	{"rt-j15", "audit-trail", "/api/audit", []string{"GET", "POST"}, "ndsep-trpc:3000", "J15", "Compliance Audit Trail"},
	{"rt-j16", "report-generate", "/api/reports/generate", []string{"POST"}, "ndsep-trpc:3000", "J16", "Regulatory Report Generation"},
	{"rt-j17", "certificate-issue", "/api/certificates/issue", []string{"POST"}, "ndsep-trpc:3000", "J17", "Compliance Certificate Issuance"},
	{"rt-j18", "revenue-distribute", "/api/financial/distribute", []string{"POST"}, "ndsep-trpc:3000", "J18", "Revenue Distribution"},
	{"rt-j19", "workflow-trigger", "/api/workflows/trigger", []string{"POST"}, "ndsep-trpc:3000", "J19", "Temporal Workflow Execution"},
	{"rt-j20", "penalty-dispute", "/api/penalties/dispute", []string{"POST"}, "ndsep-trpc:3000", "J20", "Penalty Dispute (Escrow)"},
	{"rt-j21", "ixp-enforce", "/api/network/ixp/enforce", []string{"POST"}, "ndsep-trpc:3000", "J21", "IXP Enforcement Action"},
	{"rt-j22", "lakehouse-ingest", "/api/lakehouse/ingest", []string{"POST"}, "ndsep-trpc:3000", "J22", "Lakehouse Data Ingestion"},
	{"rt-j23", "metrics-scrape", "/api/metrics", []string{"GET"}, "ndsep-trpc:3000", "J23", "Prometheus Metrics Scrape"},
	{"rt-j24", "pcap-capture", "/api/pcap/capture", []string{"POST"}, "ndsep-trpc:3000", "J24", "Arkime PCAP Capture"},
	{"rt-j25", "reconcile", "/api/financial/reconcile", []string{"POST"}, "ndsep-trpc:3000", "J25", "Financial Reconciliation"},
	{"rt-j26", "incident-escalate", "/api/incidents/escalate", []string{"POST"}, "ndsep-trpc:3000", "J26", "Security Incident Escalation"},
	{"rt-j27", "streaming-process", "/api/streaming/events", []string{"GET", "POST"}, "ndsep-trpc:3000", "J27", "Streaming Event Processing"},
	{"rt-j28", "violation-remediate", "/api/violations/remediate", []string{"POST"}, "ndsep-trpc:3000", "J28", "Violation Remediation"},
	{"rt-j29", "sla-predict", "/api/ml/sla-predict", []string{"POST"}, "ndsep-trpc:3000", "J29", "SLA Breach Prediction"},
	{"rt-j30", "regulatory-submit", "/api/portal/submit", []string{"POST"}, "ndsep-trpc:3000", "J30", "Regulatory Submission"},
}

// ─── APISIX Admin API ─────────────────────────────────────────────────────────

func apisixRequest(method, path string, body interface{}) (*http.Response, error) {
	var buf *bytes.Buffer
	if body != nil {
		data, _ := json.Marshal(body)
		buf = bytes.NewBuffer(data)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req, err := http.NewRequest(method, apisixAdminURL+path, buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-KEY", apisixAdminKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	return client.Do(req)
}

func syncRoutesToApisix() {
	if !apisixEnabled {
		return
	}
	// Check APISIX connectivity
	resp, err := apisixRequest("GET", "/apisix/admin/routes", nil)
	if err != nil || resp.StatusCode >= 400 {
		mu.Lock()
		apisixOK = false
		mu.Unlock()
		logger.Printf("[APISIX] Not reachable at %s, retry in 30s", apisixAdminURL)
		return
	}
	resp.Body.Close()
	mu.Lock()
	apisixOK = true
	mu.Unlock()
	logger.Printf("[APISIX] Connected to %s — syncing %d routes", apisixAdminURL, len(routes))

	// Sync all routes via PUT /apisix/admin/routes/{id}
	for _, rt := range routes {
		apisixRoute := map[string]interface{}{
			"id":   rt.ID,
			"name": rt.Name,
			"uri":  rt.URI,
			"methods": rt.Methods,
			"upstream": map[string]interface{}{
				"type": "roundrobin",
				"nodes": map[string]int{
					rt.Upstream: 1,
				},
			},
			"plugins": map[string]interface{}{
				"proxy-rewrite": map[string]interface{}{},
			},
		}
		r, err := apisixRequest("PUT", "/apisix/admin/routes/"+rt.ID, apisixRoute)
		if err != nil {
			atomic.AddInt64(&syncErrors, 1)
			logger.Printf("[APISIX] Failed to sync route %s: %v", rt.ID, err)
			continue
		}
		r.Body.Close()
		atomic.AddInt64(&routesSynced, 1)
	}
	logger.Printf("[APISIX] Synced %d routes (%d errors)", atomic.LoadInt64(&routesSynced), atomic.LoadInt64(&syncErrors))
}

func initApisix() {
	go func() {
		// Initial sync
		syncRoutesToApisix()
		// Periodic re-sync every 5 minutes
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			syncRoutesToApisix()
		}
	}()
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	ok := apisixOK
	mu.RUnlock()
	status := "healthy"
	if !ok {
		status = "degraded"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":        "api-gateway",
		"status":         status,
		"apisix_url":     apisixAdminURL,
		"apisix_connected": ok,
		"routes":         len(routes),
		"routes_synced":  atomic.LoadInt64(&routesSynced),
		"sync_errors":    atomic.LoadInt64(&syncErrors),
		"uptime_seconds": time.Since(startTime).Seconds(),
		"timestamp":      time.Now().UTC(),
	})
}

func listRoutesHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	ok := apisixOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"routes":           routes,
		"total":            len(routes),
		"apisix_connected": ok,
		"routes_synced":    atomic.LoadInt64(&routesSynced),
	})
}

func syncHandler(w http.ResponseWriter, _ *http.Request) {
	go syncRoutesToApisix()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "message": "sync triggered"})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	ok := apisixOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"apisixConnected": ok,
		"routesSynced":    atomic.LoadInt64(&routesSynced),
		"syncErrors":      atomic.LoadInt64(&syncErrors),
		"totalRoutes":     len(routes),
		"uptimeSeconds":   time.Since(startTime).Seconds(),
	})
}

func main() {
	port := getenv("PORT", "8130")
	initApisix()

	r := mux.NewRouter()
	r.HandleFunc("/health", healthHandler).Methods(http.MethodGet)
	r.HandleFunc("/routes", listRoutesHandler).Methods(http.MethodGet)
	r.HandleFunc("/routes/sync", syncHandler).Methods(http.MethodPost)
	r.HandleFunc("/metrics", metricsHandler).Methods(http.MethodGet)

	logger.Printf("NDSEP API Gateway starting on :%s (APISIX=%s, routes=%d)", port, apisixAdminURL, len(routes))
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		logger.Fatalf("Server failed: %v", err)
	}
}
