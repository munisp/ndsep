// NDSEP APISIX Dynamic Route Manager — Go Worker
// Port 8153 | Manages APISIX routes, upstreams, plugins for all NDSEP services
// Implements dynamic route registration, rate limiting, auth plugin management
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

var (
	PORT             = getEnv("APISIX_MANAGER_PORT", "8153")
	APISIX_ADMIN_URL = getEnv("APISIX_ADMIN_URL", "http://localhost:9180")
	APISIX_ADMIN_KEY = os.Getenv("APISIX_ADMIN_KEY")
	NDSEP_APP_URL    = getEnv("NDSEP_APP_URL", "http://localhost:3000")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	routeCreateCount  int64
	routeDeleteCount  int64
	pluginUpdateCount int64
	upstreamCount     int64
	errorCount        int64
	startTime         = time.Now()
)

// NDSEP APISIX route definitions
var NdsepRoutes = []map[string]interface{}{
	{
		"id":   "ndsep-trpc",
		"uri":  "/api/trpc/*",
		"name": "NDSEP tRPC API",
		"methods": []string{"GET", "POST", "OPTIONS"},
		"upstream": map[string]interface{}{
			"type": "roundrobin",
			"nodes": map[string]int{NDSEP_APP_URL: 1},
		},
		"plugins": map[string]interface{}{
			"limit-req": map[string]interface{}{
				"rate": 100, "burst": 50, "key": "consumer_name",
			},
			"cors": map[string]interface{}{
				"allow_origins": os.Getenv("ALLOWED_ORIGINS"),
				"allow_methods": "GET,POST,OPTIONS",
				"allow_headers": "Content-Type,Authorization,X-NDSEP-Tenant",
			},
			"prometheus": map[string]interface{}{},
			"request-id": map[string]interface{}{},
		},
	},
	{
		"id":   "ndsep-oauth-callback",
		"uri":  "/api/oauth/*",
		"name": "NDSEP OAuth",
		"methods": []string{"GET", "POST"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{NDSEP_APP_URL: 1},
		},
		"plugins": map[string]interface{}{
			"limit-req": map[string]interface{}{"rate": 20, "burst": 10, "key": "remote_addr"},
		},
	},
	{
		"id":   "ndsep-stripe-webhook",
		"uri":  "/api/stripe/*",
		"name": "NDSEP Stripe Webhook",
		"methods": []string{"POST"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{NDSEP_APP_URL: 1},
		},
		"plugins": map[string]interface{}{
			"limit-req": map[string]interface{}{"rate": 50, "burst": 20, "key": "remote_addr"},
		},
	},
	{
		"id":   "ndsep-dapr-bridge",
		"uri":  "/internal/dapr/*",
		"name": "NDSEP Dapr Bridge",
		"methods": []string{"GET", "POST"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{"http://localhost:8150": 1},
		},
		"plugins": map[string]interface{}{
			"ip-restriction": map[string]interface{}{
				"whitelist": []string{"127.0.0.1", "::1"},
			},
		},
	},
	{
		"id":   "ndsep-fluvio-relay",
		"uri":  "/internal/fluvio/*",
		"name": "NDSEP Fluvio Relay",
		"methods": []string{"GET", "POST"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{"http://localhost:8151": 1},
		},
	},
	{
		"id":   "ndsep-mojaloop",
		"uri":  "/internal/mojaloop/*",
		"name": "NDSEP Mojaloop Adapter",
		"methods": []string{"GET", "POST"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{"http://localhost:8152": 1},
		},
	},
	{
		"id":   "ndsep-metrics",
		"uri":  "/internal/metrics/*",
		"name": "NDSEP Prometheus Metrics",
		"methods": []string{"GET"},
		"upstream": map[string]interface{}{
			"type":  "roundrobin",
			"nodes": map[string]int{"http://localhost:9090": 1},
		},
		"plugins": map[string]interface{}{
			"ip-restriction": map[string]interface{}{
				"whitelist": []string{"127.0.0.1", "::1", "10.0.0.0/8"},
			},
		},
	},
}

type bytesReader struct{ data []byte; pos int }
func (r *bytesReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) { return 0, fmt.Errorf("EOF") }
	n = copy(p, r.data[r.pos:]); r.pos += n; return n, nil
}
func (r *bytesReader) Close() error { return nil }

func apisixRequest(method, path string, body interface{}) (map[string]interface{}, error) {
	var bodyReader *bytesReader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = &bytesReader{data: b}
	}
	url := APISIX_ADMIN_URL + path
	client := &http.Client{Timeout: 10 * time.Second}
	var req *http.Request
	if bodyReader != nil {
		req, _ = http.NewRequest(method, url, bodyReader)
	} else {
		req, _ = http.NewRequest(method, url, nil)
	}
	req.Header.Set("X-API-KEY", APISIX_ADMIN_KEY)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[APISIXManager] APISIX degraded: %v", err)
		return map[string]interface{}{"degraded": true}, nil
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

func handleSyncRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	results := make([]map[string]interface{}, 0, len(NdsepRoutes))
	for _, route := range NdsepRoutes {
		id := route["id"].(string)
		result, err := apisixRequest("PUT", "/apisix/admin/routes/"+id, route)
		if err != nil {
			atomic.AddInt64(&errorCount, 1)
		} else {
			atomic.AddInt64(&routeCreateCount, 1)
		}
		results = append(results, map[string]interface{}{
			"id":     id,
			"result": result,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"synced":  len(results),
		"routes":  results,
	})
}

func handleListRoutes(w http.ResponseWriter, r *http.Request) {
	result, err := apisixRequest("GET", "/apisix/admin/routes", nil)
	if err != nil {
		atomic.AddInt64(&errorCount, 1)
		// Return local route definitions as fallback
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"routes":   NdsepRoutes,
			"degraded": true,
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handlePluginUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req map[string]interface{}
	json.NewDecoder(r.Body).Decode(&req)
	routeID, _ := req["routeId"].(string)
	if routeID == "" {
		http.Error(w, "routeId required", http.StatusBadRequest)
		return
	}
	result, _ := apisixRequest("PATCH", "/apisix/admin/routes/"+routeID, req)
	atomic.AddInt64(&pluginUpdateCount, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": result})
}

func handleUpstreamCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req map[string]interface{}
	json.NewDecoder(r.Body).Decode(&req)
	id, _ := req["id"].(string)
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	result, _ := apisixRequest("PUT", "/apisix/admin/upstreams/"+id, req)
	atomic.AddInt64(&upstreamCount, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": result})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "ndsep-apisix-manager",
		"version": "1.0.0",
		"uptime":  time.Since(startTime).Seconds(),
		"routes":  len(NdsepRoutes),
		"config":  map[string]string{"apisix_admin_url": APISIX_ADMIN_URL},
	})
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "ndsep_apisix_routes_created_total %d\n", atomic.LoadInt64(&routeCreateCount))
	fmt.Fprintf(w, "ndsep_apisix_routes_deleted_total %d\n", atomic.LoadInt64(&routeDeleteCount))
	fmt.Fprintf(w, "ndsep_apisix_plugin_updates_total %d\n", atomic.LoadInt64(&pluginUpdateCount))
	fmt.Fprintf(w, "ndsep_apisix_upstreams_total %d\n", atomic.LoadInt64(&upstreamCount))
	fmt.Fprintf(w, "ndsep_apisix_errors_total %d\n", atomic.LoadInt64(&errorCount))
	fmt.Fprintf(w, "ndsep_apisix_uptime_seconds %.2f\n", time.Since(startTime).Seconds())
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/routes/sync", handleSyncRoutes)
	mux.HandleFunc("/routes", handleListRoutes)
	mux.HandleFunc("/plugins/update", handlePluginUpdate)
	mux.HandleFunc("/upstreams/create", handleUpstreamCreate)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/metrics", handleMetrics)

	log.Printf("[APISIXManager] Starting NDSEP APISIX Manager on port %s", PORT)
	log.Printf("[APISIXManager] APISIX Admin URL: %s | Routes: %d", APISIX_ADMIN_URL, len(NdsepRoutes))

	server := &http.Server{
		Addr:         ":" + PORT,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("[APISIXManager] Server error: %v", err)
	}
}
