// NDSEP Nmap/ZMap/Masscan Network Scanner Worker (Layer 1)
// Simulates active network scanning to detect undeclared devices
// Covers Nmap (detailed), ZMap (internet-scale), Masscan (high-speed) scanning
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

	_ "github.com/lib/pq"
)

const (
	PORT    = "8092"
	VERSION = "1.0.0"
)

var (
	mu      sync.RWMutex
	metrics = map[string]interface{}{
		"nmap_scans_completed":    0,
		"zmap_hosts_discovered":   0,
		"masscan_ports_open":      0,
		"undeclared_devices":      0,
		"shodan_exposed_assets":   0,
		"critical_exposures":      0,
		"scan_rate_pps":           0,
		"uptime_seconds":          0,
	}
	startTime = time.Now()
)

var SCAN_TARGETS = []string{
	"196.201.0.0/24", "196.202.0.0/24", "41.58.0.0/24",
	"105.112.0.0/24", "154.120.0.0/24", "197.210.0.0/24",
	"102.89.0.0/24", "41.184.0.0/24",
}

var SERVICES = []string{
	"ssh", "http", "https", "ftp", "smtp", "rdp", "vnc",
	"mysql", "postgresql", "mongodb", "redis", "elasticsearch",
	"kafka", "zookeeper", "etcd", "kubernetes-api",
}

var DEVICE_TYPES = []string{
	"router", "switch", "firewall", "server", "workstation",
	"iot-device", "printer", "camera", "nas", "vpn-gateway",
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

func runNmapScanner(db *sql.DB) {
	ticker := time.NewTicker(7 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		target := SCAN_TARGETS[rand.Intn(len(SCAN_TARGETS))]
		hostsUp := rand.Intn(50) + 5
		openPorts := rand.Intn(200) + 10
		service := SERVICES[rand.Intn(len(SERVICES))]
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		isUndeclared := rand.Float32() < 0.15
		isCritical := isUndeclared && rand.Float32() < 0.3

		mu.Lock()
		metrics["nmap_scans_completed"] = metrics["nmap_scans_completed"].(int) + 1
		if isUndeclared {
			metrics["undeclared_devices"] = metrics["undeclared_devices"].(int) + 1
		}
		if isCritical {
			metrics["critical_exposures"] = metrics["critical_exposures"].(int) + 1
		}
		mu.Unlock()

		flag := ""
		if isUndeclared {
			flag = " [UNDECLARED]"
		}
		if isCritical {
			flag = " [CRITICAL EXPOSURE]"
		}

		log.Printf("[NDSEP-Nmap] [Nmap] Scan %s: %d hosts up, %d open ports, service=%s, org=%s%s",
			target, hostsUp, openPorts, service, org, flag)

		// Write network event for undeclared devices
		if isUndeclared {
			srcIP := fmt.Sprintf("196.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1)
			_, err := db.Exec(`
				INSERT INTO network_events (event_type, source_ip, destination_ip, protocol, bytes_transferred, is_cross_border, ixp_site, detected_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
				"anomaly",
				srcIP,
				"0.0.0.0",
				service,
				int64(rand.Intn(10000)),
				false,
				"IXP-NGA-LAG",
			)
			if err != nil {
				log.Printf("[Nmap] DB write error: %v", err)
			}
		}
	}
}

func runZMapScanner(db *sql.DB) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		hostsDiscovered := rand.Intn(5000) + 100
		scanRate := rand.Intn(1000000) + 100000
		port := []int{80, 443, 22, 25, 3306, 5432, 27017, 6379}[rand.Intn(8)]

		mu.Lock()
		metrics["zmap_hosts_discovered"] = metrics["zmap_hosts_discovered"].(int) + hostsDiscovered
		metrics["scan_rate_pps"] = scanRate
		mu.Unlock()

		log.Printf("[NDSEP-Nmap] [ZMap] Internet scan port %d: %d hosts discovered @ %d pps",
			port, hostsDiscovered, scanRate)
	}
}

func runMasscanScanner(db *sql.DB) {
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		openPorts := rand.Intn(10000) + 500
		shodanExposed := rand.Intn(50) + 5

		mu.Lock()
		metrics["masscan_ports_open"] = metrics["masscan_ports_open"].(int) + openPorts
		metrics["shodan_exposed_assets"] = metrics["shodan_exposed_assets"].(int) + shodanExposed
		mu.Unlock()

		log.Printf("[NDSEP-Nmap] [Masscan] High-speed scan: %d open ports | Shodan cross-ref: %d exposed assets",
			openPorts, shodanExposed)
	}
}

func runShodanIntegration(db *sql.DB) {
	ticker := time.NewTicker(18 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		exposedCount := rand.Intn(20) + 1
		deviceType := DEVICE_TYPES[rand.Intn(len(DEVICE_TYPES))]
		cveCount := rand.Intn(5)

		log.Printf("[NDSEP-Nmap] [Shodan] Passive recon: %s has %d exposed %s devices, %d CVEs",
			org, exposedCount, deviceType, cveCount)

		mu.Lock()
		metrics["shodan_exposed_assets"] = metrics["shodan_exposed_assets"].(int) + exposedCount
		mu.Unlock()
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
		"service": "nmap-scanner",
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
	log.Printf("[NDSEP-Nmap] === NDSEP Nmap/ZMap/Masscan Scanner Worker (Go) ===")
	log.Printf("[NDSEP-Nmap] Version: %s | Port: %s", VERSION, PORT)

	db, err := getDB()
	if err != nil {
		log.Fatalf("[Nmap] DB connection failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("[Nmap] DB ping failed: %v", err)
	}
	log.Printf("[NDSEP-Nmap] [DB] Connected to PostgreSQL")

	go runUptimeTracker()
	go runNmapScanner(db)
	go runZMapScanner(db)
	go runMasscanScanner(db)
	go runShodanIntegration(db)

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/metrics", metricsHandler)

	log.Printf("[NDSEP-Nmap] [Scanner] Nmap/ZMap/Masscan scanner listening on :%s", PORT)
	if err := http.ListenAndServe(":"+PORT, nil); err != nil {
		log.Fatalf("[Nmap] Server error: %v", err)
	}
}
