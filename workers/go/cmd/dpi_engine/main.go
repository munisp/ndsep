// NDSEP Layer 5 — DPI Engine Worker (Go)
// ========================================
// Simulates Suricata/Zeek deep packet inspection at IXP sites.
// Performs:
//   - Protocol decoding and traffic classification
//   - Signature-based and anomaly detection
//   - Cross-border transfer detection
//   - Data leakage prevention (DLP) rule evaluation
//   - Automated blocking mechanism triggers
//   - IXP site health monitoring
//
// Writes network_events to PostgreSQL and broadcasts via HTTP relay.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"ndsep/workers/shared"
)

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

var protocols = []string{"TCP", "UDP", "HTTP", "HTTPS", "DNS", "SMTP", "FTP", "SSH", "QUIC", "TLS"}
var alertTypes = []string{
	"SQL_INJECTION", "XSS_ATTEMPT", "PORT_SCAN", "BRUTE_FORCE",
	"DATA_EXFILTRATION", "C2_BEACON", "LATERAL_MOVEMENT", "ANOMALOUS_TRANSFER",
}
var dpiEngines = []string{"suricata", "zeek", "ndpi"}
var suricataSignatures = []string{
	"ET.POLICY.DATA_EXFIL", "ET.MALWARE.C2_BEACON", "ET.SCAN.PORTSCAN",
	"ET.EXPLOIT.BUFFER_OVERFLOW", "ET.TROJAN.GENERIC", "ET.DLP.PII_DETECTED",
}
var blockActions = []string{"BGP_BLACKHOLE", "FIREWALL_RULE_INJECT", "TRAFFIC_SHAPE", "RATE_LIMIT", "DEEP_INSPECT_QUEUE"}
var blockReasons = []string{
	"Cross-border transfer policy violation",
	"Data exfiltration signature match",
	"C2 beacon detected by Suricata",
	"DLP rule triggered — PII detected",
	"Anomalous traffic volume (>3σ from baseline)",
	"Unauthorized cross-border DNS query",
}

type IXPSite struct {
	ID      string
	Name    string
	Country string
	Lat     float64
	Lon     float64
}

var ixpSites = []IXPSite{
	{ID: "IXP-NGN-LAG", Name: "Lagos IXP", Country: "NG", Lat: 6.5244, Lon: 3.3792},
	{ID: "IXP-KEN-NBI", Name: "Nairobi IXP", Country: "KE", Lat: -1.2921, Lon: 36.8219},
	{ID: "IXP-ZAF-JHB", Name: "Johannesburg IXP", Country: "ZA", Lat: -26.2041, Lon: 28.0473},
	{ID: "IXP-GHA-ACC", Name: "Accra IXP", Country: "GH", Lat: 5.6037, Lon: -0.1870},
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker State
// ─────────────────────────────────────────────────────────────────────────────

var (
	eventsProcessed int64
	blockedCount    int64
	crossBorderCount int64
	mu              sync.RWMutex
	workerStart     = time.Now()
)

// ─────────────────────────────────────────────────────────────────────────────
// DPI Engine — Core Packet Inspection Loop
// ─────────────────────────────────────────────────────────────────────────────

func runDPIEngine() {
	log.Println("[DPI] Starting Suricata/Zeek DPI simulation engine...")
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		orgIDs, orgNames, err := shared.GetOrgIDs()
		if err != nil || len(orgIDs) == 0 {
			continue
		}

		idx := rand.Intn(len(orgIDs))
		orgID := orgIDs[idx]
		orgName := orgNames[idx]
		ixp := ixpSites[rand.Intn(len(ixpSites))]
		protocol := shared.RandomChoice(protocols)
		isCrossBorder := rand.Float64() < 0.22
		isBlocked := isCrossBorder && rand.Float64() < 0.45
		bytesTransferred := shared.RandomBetween(512, 50*1024*1024) // 512B to 50MB
		engine := shared.RandomChoice(dpiEngines)

		var signatureMatched *string
		if isBlocked {
			sig := shared.RandomChoice(suricataSignatures)
			signatureMatched = &sig
		}

		// Insert into network_events
		var eventID int
		err = shared.DB.QueryRow(`
			INSERT INTO network_events 
				(organization_id, source_ip, destination_ip, protocol, bytes_transferred, 
				 is_cross_border, is_blocked, ixp_site, detected_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
			RETURNING id`,
			orgID,
			shared.RandomIP(),
			shared.RandomIP(),
			protocol,
			bytesTransferred,
			isCrossBorder,
			isBlocked,
			ixp.ID,
		).Scan(&eventID)

		if err != nil {
			log.Printf("[DPI] DB insert error: %v\n", err)
			continue
		}

		atomic.AddInt64(&eventsProcessed, 1)
		if isBlocked {
			atomic.AddInt64(&blockedCount, 1)
		}
		if isCrossBorder {
			atomic.AddInt64(&crossBorderCount, 1)
		}

		// Build broadcast payload
		payload := map[string]interface{}{
			"type":             "new_network_event",
			"id":               eventID,
			"organizationId":   orgID,
			"organizationName": orgName,
			"sourceIp":         shared.RandomIP(),
			"destinationIp":    shared.RandomIP(),
			"protocol":         protocol,
			"bytesTransferred": bytesTransferred,
			"isCrossBorder":    isCrossBorder,
			"isBlocked":        isBlocked,
			"ixpSiteId":        ixp.ID,
			"ixpName":          ixp.Name,
			"ixpCountry":       ixp.Country,
			"dpiEngine":        engine,
			"signatureMatched": signatureMatched,
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
		}
		shared.Broadcast("new_network_event", payload)

		// Trigger blocking action if blocked
		if isBlocked {
			runBlockingAction(ixp, orgName, signatureMatched)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocking Mechanism Engine
// ─────────────────────────────────────────────────────────────────────────────

func runBlockingAction(ixp IXPSite, orgName string, signature *string) {
	action := shared.RandomChoice(blockActions)
	reason := shared.RandomChoice(blockReasons)
	if signature != nil {
		reason = fmt.Sprintf("Suricata signature: %s", *signature)
	}

	payload := map[string]interface{}{
		"type":      "blocking_action",
		"actionId":  fmt.Sprintf("BLK-%d", time.Now().UnixMilli()),
		"ixpId":     ixp.ID,
		"ixpName":   ixp.Name,
		"action":    action,
		"targetIp":  shared.RandomIP(),
		"orgName":   orgName,
		"reason":    reason,
		"status":    "executed",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	shared.Broadcast("blocking_action", payload)
	log.Printf("[BLOCK] %s → %s at %s (%s)\n", action, orgName, ixp.ID, reason)
}

// ─────────────────────────────────────────────────────────────────────────────
// IXP Site Monitor
// ─────────────────────────────────────────────────────────────────────────────

func runIXPMonitor() {
	log.Println("[IXP] Starting IXP site health monitor...")
	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		for _, ixp := range ixpSites {
			crossBorderRatio := rand.Float64() * 0.45
			throughputGbps := 10.0 + rand.Float64()*100.0
			status := "healthy"
			if rand.Float64() < 0.04 {
				status = "degraded"
			}

			payload := map[string]interface{}{
				"type":               "ixp_health",
				"ixpId":              ixp.ID,
				"ixpName":            ixp.Name,
				"country":            ixp.Country,
				"lat":                ixp.Lat,
				"lon":                ixp.Lon,
				"status":             status,
				"throughputGbps":     math.Round(throughputGbps*100) / 100,
				"crossBorderRatio":   math.Round(crossBorderRatio*10000) / 10000,
				"crossBorderAlerted": crossBorderRatio > 0.30,
				"connectedOrgs":      shared.RandomBetween(50, 500),
				"packetsPerSec":      shared.RandomBetween(100000, 5000000),
				"timestamp":          time.Now().UTC().Format(time.RFC3339),
			}
			shared.Broadcast("ixp_health", payload)
		}
		log.Printf("[IXP] Health broadcast for %d sites\n", len(ixpSites))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// DPI Status Aggregator
// ─────────────────────────────────────────────────────────────────────────────

func runDPIStatusBroadcast() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		for _, ixp := range ixpSites {
			payload := map[string]interface{}{
				"type":             "dpi_status",
				"ixpId":            ixp.ID,
				"ixpName":          ixp.Name,
				"packetsInspected": shared.RandomBetween(100000, 5000000),
				"flowsAnalyzed":    shared.RandomBetween(1000, 50000),
				"threatsBlocked":   shared.RandomBetween(0, 50),
				"bytesInspected":   shared.RandomBetween(1000000, 1000000000),
				"suricataAlerts":   shared.RandomBetween(0, 20),
				"zeekConnections":  shared.RandomBetween(500, 10000),
				"dlpTriggered":     shared.RandomBetween(0, 5),
				"timestamp":        time.Now().UTC().Format(time.RFC3339),
			}
			shared.Broadcast("dpi_status", payload)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Status Server
// ─────────────────────────────────────────────────────────────────────────────

func startStatusServer(port string) {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "worker": "dpi_engine"})
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(shared.WorkerStatus{
			ID:              "dpi-engine",
			Name:            "Layer 5 DPI Engine",
			Layer:           "L5",
			Language:        "Go",
			Status:          "running",
			LastRun:         time.Now(),
			EventsProcessed: atomic.LoadInt64(&eventsProcessed),
			Description:     "Suricata/Zeek DPI simulation at 4 IXP sites. Performs protocol decoding, signature matching, anomaly detection, DLP enforcement, and automated blocking.",
			Technology:      "Go · Suricata · Zeek · nDPI · BGP Blackholing",
		})
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"eventsProcessed":  atomic.LoadInt64(&eventsProcessed),
			"blockedCount":     atomic.LoadInt64(&blockedCount),
			"crossBorderCount": atomic.LoadInt64(&crossBorderCount),
			"uptimeSeconds":    time.Since(workerStart).Seconds(),
			"ixpSites":         len(ixpSites),
		})
	})

	log.Printf("[DPI] Status server listening on :%s\n", port)
	shared.RunGracefulServer("dpi_engine", port, nil, func() { shared.DB.Close() })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[NDSEP-DPI] ")

	port := os.Getenv("DPI_PORT")
	if port == "" {
		port = "8081"
	}

	log.Println("=== NDSEP Layer 5 DPI Engine (Go) ===")
	log.Printf("Version: 1.0.0 | Port: %s\n", port)

	// Initialize shared resources
	shared.InitRelay()
shared.InitTracing(shared.TraceConfig{
ServiceName:    "dpi_engine",
ServiceVersion: "3.0.0",
})
	if err := shared.InitDB(); err != nil {
		log.Fatalf("DB init failed: %v\n", err)
	}
	defer shared.DB.Close()

	// Broadcast startup event
	shared.Broadcast("worker_started", map[string]interface{}{
		"worker":    "dpi_engine",
		"layer":     "L5",
		"language":  "Go",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	// Start all goroutines
	go runDPIEngine()
	go runIXPMonitor()
	go runDPIStatusBroadcast()

	// Start HTTP status server (blocks)
	startStatusServer(port)
}
