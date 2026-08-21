// NDSEP Arkime Full Packet Capture Worker (Layer 5)
// Simulates Arkime (formerly Moloch) full packet capture and indexing
// 600TB rolling buffer, session indexing, PCAP storage, and forensic search
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
	PORT    = "8099"
	VERSION = "1.0.0"
)

var (
	mu      sync.RWMutex
	metrics = map[string]interface{}{
		"sessions_captured":     0,
		"packets_indexed":       0,
		"bytes_captured_gb":     0.0,
		"buffer_used_tb":        0.0,
		"buffer_capacity_tb":    600.0,
		"sessions_per_second":   0,
		"forensic_queries":      0,
		"pcap_files_stored":     0,
		"tls_decrypted":         0,
		"anomalous_sessions":    0,
		"uptime_seconds":        0,
	}
	startTime = time.Now()
)

var PROTOCOLS = []string{"TCP", "UDP", "ICMP", "TLS", "HTTP", "HTTPS", "DNS", "SMTP", "SSH", "FTP"}
var IXP_SITES = []string{"IXP-NGA-LAG", "IXP-GHA-ACC", "IXP-KEN-NAI", "IXP-ZAF-JNB"}
var ORG_NAMES = []string{
	"National Bank of Finance", "Federal Ministry of Health",
	"Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
}

func getDB() (*sql.DB, error) {
	dbURL := os.Getenv("WORKER_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

func runPacketCapture(db *sql.DB) {
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		sessionsThisTick := rand.Intn(500) + 50
		packetsThisTick := sessionsThisTick * (rand.Intn(100) + 10)
		bytesGB := float64(packetsThisTick*1500) / 1e9
		ixp := IXP_SITES[rand.Intn(len(IXP_SITES))]
		protocol := PROTOCOLS[rand.Intn(len(PROTOCOLS))]
		isAnomalous := rand.Float32() < 0.05

		mu.Lock()
		metrics["sessions_captured"] = metrics["sessions_captured"].(int) + sessionsThisTick
		metrics["packets_indexed"] = metrics["packets_indexed"].(int) + packetsThisTick
		metrics["bytes_captured_gb"] = metrics["bytes_captured_gb"].(float64) + bytesGB
		bufferUsed := metrics["bytes_captured_gb"].(float64) / 1000.0
		if bufferUsed > 600.0 {
			bufferUsed = 600.0
		}
		metrics["buffer_used_tb"] = bufferUsed
		metrics["sessions_per_second"] = sessionsThisTick / 4
		metrics["pcap_files_stored"] = metrics["pcap_files_stored"].(int) + 1
		if isAnomalous {
			metrics["anomalous_sessions"] = metrics["anomalous_sessions"].(int) + 1
		}
		mu.Unlock()

		if isAnomalous {
			srcIP := fmt.Sprintf("196.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1)
			dstIP := fmt.Sprintf("52.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1)
			log.Printf("[NDSEP-Arkime] [ANOMALY] Suspicious session: %s -> %s | %s | %s",
				srcIP, dstIP, protocol, ixp)

			_, err := db.Exec(`
				INSERT INTO network_events (event_type, source_ip, destination_ip, protocol, bytes_transferred, is_cross_border, ixp_site, detected_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
				"anomaly",
				srcIP,
				dstIP,
				protocol,
				int64(bytesGB*1e9),
				true,
				ixp,
			)
			if err != nil {
				log.Printf("[Arkime] DB write error: %v", err)
			}
		} else {
			log.Printf("[NDSEP-Arkime] [PCAP] Captured %d sessions (%d pkts, %.2f GB) @ %s | proto=%s",
				sessionsThisTick, packetsThisTick, bytesGB, ixp, protocol)
		}
	}
}

func runTLSDecryptor(db *sql.DB) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		decrypted := rand.Intn(200) + 10
		mu.Lock()
		metrics["tls_decrypted"] = metrics["tls_decrypted"].(int) + decrypted
		mu.Unlock()
		log.Printf("[NDSEP-Arkime] [TLS] Decrypted %d TLS sessions for DPI analysis", decrypted)
	}
}

func runForensicSearch(db *sql.DB) {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		queryType := []string{"ip_search", "protocol_filter", "time_range", "payload_search", "geo_filter"}[rand.Intn(5)]
		resultCount := rand.Intn(10000) + 100
		mu.Lock()
		metrics["forensic_queries"] = metrics["forensic_queries"].(int) + 1
		mu.Unlock()
		log.Printf("[NDSEP-Arkime] [Forensic] Query type=%s for %s: %d sessions found", queryType, org, resultCount)
	}
}

func runBufferManager() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		mu.RLock()
		bufferUsed := metrics["buffer_used_tb"].(float64)
		mu.RUnlock()
		log.Printf("[NDSEP-Arkime] [Buffer] Rolling buffer: %.2f TB / 600 TB (%.1f%% full)",
			bufferUsed, bufferUsed/600.0*100.0)
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
		"service": "arkime-pcap",
		"version": VERSION,
		"layer":   "L5",
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

func sessionsHandler(w http.ResponseWriter, r *http.Request) {
	// Return mock PCAP session data for UI
	sessions := make([]map[string]interface{}, 10)
	for i := range sessions {
		sessions[i] = map[string]interface{}{
			"id":        fmt.Sprintf("pcap-%d-%d", time.Now().Unix(), i),
			"src_ip":    fmt.Sprintf("196.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1),
			"dst_ip":    fmt.Sprintf("52.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1),
			"protocol":  PROTOCOLS[rand.Intn(len(PROTOCOLS))],
			"bytes":     rand.Intn(10000000) + 1000,
			"packets":   rand.Intn(1000) + 10,
			"duration":  rand.Intn(300) + 1,
			"ixp":       IXP_SITES[rand.Intn(len(IXP_SITES))],
			"anomalous": rand.Float32() < 0.1,
			"timestamp": time.Now().Add(-time.Duration(rand.Intn(3600)) * time.Second).UTC().Format(time.RFC3339),
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"sessions": sessions})
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
	log.Printf("[NDSEP-Arkime] === NDSEP Arkime Full Packet Capture Worker (Go) ===")
	log.Printf("[NDSEP-Arkime] Version: %s | Port: %s | Buffer: 600TB", VERSION, PORT)

	db, err := getDB()
	if err != nil {
		log.Fatalf("[Arkime] DB connection failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("[Arkime] DB ping failed: %v", err)
	}
	log.Printf("[NDSEP-Arkime] [DB] Connected to PostgreSQL")

	go runUptimeTracker()
	go runPacketCapture(db)
	go runTLSDecryptor(db)
	go runForensicSearch(db)
	go runBufferManager()

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/metrics", metricsHandler)
	http.HandleFunc("/sessions", sessionsHandler)

	log.Printf("[NDSEP-Arkime] [PCAP] Arkime packet capture worker listening on :%s", PORT)
	if err := http.ListenAndServe(":"+PORT, nil); err != nil {
		log.Fatalf("[Arkime] Server error: %v", err)
	}
}
