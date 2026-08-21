// NDSEP NetBox IPAM Worker (Layer 1)
// Simulates NetBox network topology mapping and IP Address Management (IPAM)
// Tracks subnets, VLANs, IP allocations, and network topology for national asset registry
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
	"context"
	"os/signal"
	"syscall"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

const (
	PORT    = "8091"
	VERSION = "1.0.0"
)

var (
	mu      sync.RWMutex
	metrics = map[string]interface{}{
		"subnets_tracked":   0,
		"ips_allocated":     0,
		"vlans_discovered":  0,
		"prefixes_scanned":  0,
		"topology_nodes":    0,
		"ipam_utilization":  0.0,
		"uptime_seconds":    0,
	}
	startTime = time.Now()
)

var AFRICAN_SUBNETS = []string{
	"196.201.0.0/16", "196.202.0.0/16", "196.203.0.0/16",
	"105.0.0.0/8", "41.0.0.0/8", "197.0.0.0/8",
	"154.0.0.0/8", "102.0.0.0/8", "196.0.0.0/8",
	"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
}

var VLAN_NAMES = []string{
	"MGMT", "DATA", "VOICE", "GUEST", "DMZ", "STORAGE",
	"BACKUP", "MONITORING", "COMPLIANCE", "RESTRICTED",
}

var DC_SITES = []string{
	"Lagos-DC1", "Abuja-DC2", "Kano-DC3", "Port-Harcourt-DC4",
	"Ibadan-DC5", "Enugu-DC6", "Kaduna-DC7", "Benin-DC8",
}

var ORG_NAMES = []string{
	"National Bank of Finance", "Federal Ministry of Health",
	"Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
	"National Insurance Co", "Federal Revenue Service", "National Broadcasting Corp",
}

func getDB() (*sql.DB, error) {
	dbURL := os.Getenv("WORKER_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

func broadcastWS(eventType string, payload map[string]interface{}) {
	wsURL := os.Getenv("WORKER_WS_URL")
	if wsURL == "" {
		wsURL = "http://localhost:3000/api/workers/event"
	}
	payload["type"] = eventType
	payload["source"] = "netbox-ipam"
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	data, _ := json.Marshal(payload)
	http.Post(wsURL, "application/json", nil)
	_ = data
}

func runIPAMScanner(db *sql.DB) {
	ticker := time.NewTicker(6 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		subnet := AFRICAN_SUBNETS[rand.Intn(len(AFRICAN_SUBNETS))]
		vlan := VLAN_NAMES[rand.Intn(len(VLAN_NAMES))]
		site := DC_SITES[rand.Intn(len(DC_SITES))]
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		ipsAllocated := rand.Intn(200) + 10
		utilization := float64(ipsAllocated) / 254.0 * 100.0

		mu.Lock()
		metrics["subnets_tracked"] = metrics["subnets_tracked"].(int) + 1
		metrics["ips_allocated"] = metrics["ips_allocated"].(int) + ipsAllocated
		metrics["vlans_discovered"] = metrics["vlans_discovered"].(int) + 1
		metrics["prefixes_scanned"] = metrics["prefixes_scanned"].(int) + rand.Intn(5) + 1
		metrics["topology_nodes"] = metrics["topology_nodes"].(int) + rand.Intn(3)
		metrics["ipam_utilization"] = utilization
		mu.Unlock()

		// Write to network_events as IPAM discovery event
		_, err := db.Exec(`
			INSERT INTO network_events (event_type, source_ip, destination_ip, protocol, bytes_transferred, is_cross_border, ixp_site, detected_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			"normal",
			fmt.Sprintf("10.%d.%d.1", rand.Intn(255), rand.Intn(255)),
			fmt.Sprintf("10.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1),
			"TCP",
			int64(ipsAllocated*48),
			false,
			site,
		)
		if err != nil {
			log.Printf("[NetBox] DB write error: %v", err)
		}

		log.Printf("[NDSEP-NetBox] [IPAM] Subnet %s | VLAN %s | %d IPs @ %s for %s | Util: %.1f%%",
			subnet, vlan, ipsAllocated, site, org, utilization)

		broadcastWS("normal", map[string]interface{}{
			"subnet": subnet, "vlan": vlan, "site": site, "org": org,
			"ips_allocated": ipsAllocated, "utilization": utilization,
		})
	}
}

func runTopologyMapper(db *sql.DB) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		nodeCount := rand.Intn(20) + 5
		edgeCount := nodeCount + rand.Intn(10)
		site := DC_SITES[rand.Intn(len(DC_SITES))]
		log.Printf("[NDSEP-NetBox] [Topology] Mapped %d nodes, %d edges at %s", nodeCount, edgeCount, site)
		mu.Lock()
		metrics["topology_nodes"] = metrics["topology_nodes"].(int) + nodeCount
		mu.Unlock()
	}
}

func runVLANDiscovery(db *sql.DB) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		vlanID := rand.Intn(4094) + 1
		vlanName := VLAN_NAMES[rand.Intn(len(VLAN_NAMES))]
		site := DC_SITES[rand.Intn(len(DC_SITES))]
		log.Printf("[NDSEP-NetBox] [VLAN] Discovered VLAN %d (%s) at %s", vlanID, vlanName, site)
	}
}

func runUptimeTracker() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		mu.Lock()
		metrics["uptime_seconds"] = int(time.Since(startTime).Seconds())
		mu.Unlock()
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "netbox-ipam",
		"version": VERSION,
		"layer":   "L1",
		"lang":    "Go",
		"metrics": metrics,
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
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
	log.SetFlags(log.LstdFlags)
	log.Printf("[NDSEP-NetBox] === NDSEP NetBox IPAM Worker (Go) ===")
	log.Printf("[NDSEP-NetBox] Version: %s | Port: %s", VERSION, PORT)

	db, err := getDB()
	if err != nil {
		log.Fatalf("[NetBox] DB connection failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("[NetBox] DB ping failed: %v", err)
	}
	log.Printf("[NDSEP-NetBox] [DB] Connected to PostgreSQL")

	_ = uuid.New()

	go runUptimeTracker()
	go runIPAMScanner(db)
	go runTopologyMapper(db)
	go runVLANDiscovery(db)

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/metrics", metricsHandler)

	log.Printf("[NDSEP-NetBox] [IPAM] NetBox IPAM worker listening on :%s", PORT)
	if err := http.ListenAndServe(":"+PORT, nil); err != nil {
		log.Fatalf("[NetBox] Server error: %v", err)
	}
}
