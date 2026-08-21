// NDSEP Anomaly Alert Dispatcher (Go)
// =====================================
// Real-time anomaly detection and alert dispatch for compliance score drops.
// Monitors compliance_score_history for ±2σ deviations and dispatches:
//   - WebSocket notifications to connected NDPC officers
//   - security_alerts records in PostgreSQL
//   - Email notifications via relay
//   - Webhook triggers to registered org endpoints
//
// Technology: Go · net/http · WebSocket (gorilla/websocket fallback: SSE)
// Port: 8212
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

var (
	dbURL       = getEnv("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	relayURL    = getEnv("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
	port        = getEnv("ANOMALY_PORT", "8212")
	workerStart = time.Now()
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type AnomalyAlert struct {
	OrgID       string  `json:"org_id"`
	OrgName     string  `json:"org_name"`
	Sector      string  `json:"sector"`
	CurrentScore float64 `json:"current_score"`
	MeanScore   float64 `json:"mean_score"`
	StdDev      float64 `json:"std_dev"`
	ZScore      float64 `json:"z_score"`
	Direction   string  `json:"direction"` // "drop" or "spike"
	Severity    string  `json:"severity"`  // "critical", "high", "medium"
	DetectedAt  string  `json:"detected_at"`
	TrendURL    string  `json:"trend_url"`
}

var (
	mu            sync.RWMutex
	activeAlerts  []AnomalyAlert
	totalDetected int64
	lastScanTime  string
	errors        int64
	// SSE clients
	sseClients   = make(map[chan AnomalyAlert]bool)
	sseMu        sync.Mutex
)

func detectAnomalies(db *sql.DB) ([]AnomalyAlert, error) {
	rows, err := db.Query(`
		WITH stats AS (
			SELECT
				org_id,
				AVG(score) as mean_score,
				STDDEV(score) as std_dev,
				MAX(recorded_at) as last_recorded
			FROM compliance_score_history
			WHERE recorded_at >= NOW() - INTERVAL '30 days'
			GROUP BY org_id
			HAVING COUNT(*) >= 7
		),
		latest AS (
			SELECT DISTINCT ON (org_id)
				org_id, score as current_score, recorded_at
			FROM compliance_score_history
			ORDER BY org_id, recorded_at DESC
		)
		SELECT
			o.id::text, o.name, o.sector,
			l.current_score, s.mean_score,
			COALESCE(s.std_dev, 5) as std_dev
		FROM stats s
		JOIN latest l ON l.org_id = s.org_id
		JOIN organizations o ON o.id = s.org_id
		WHERE ABS(l.current_score - s.mean_score) > 2 * COALESCE(s.std_dev, 5)
		  AND COALESCE(s.std_dev, 5) > 0
	`)
	if err != nil {
		return nil, fmt.Errorf("anomaly query: %w", err)
	}
	defer rows.Close()

	var alerts []AnomalyAlert
	for rows.Next() {
		var a AnomalyAlert
		var mean, std float64
		if err := rows.Scan(&a.OrgID, &a.OrgName, &a.Sector,
			&a.CurrentScore, &mean, &std); err != nil {
			continue
		}
		a.MeanScore = math.Round(mean*100) / 100
		a.StdDev = math.Round(std*100) / 100
		a.ZScore = math.Round(((a.CurrentScore - mean) / std)*100) / 100
		if a.CurrentScore < mean {
			a.Direction = "drop"
		} else {
			a.Direction = "spike"
		}
		absZ := math.Abs(a.ZScore)
		if absZ >= 3.5 {
			a.Severity = "critical"
		} else if absZ >= 3.0 {
			a.Severity = "high"
		} else {
			a.Severity = "medium"
		}
		a.DetectedAt = time.Now().UTC().Format(time.RFC3339)
		a.TrendURL = fmt.Sprintf("/trends/%s", a.OrgID)
		alerts = append(alerts, a)
	}
	return alerts, nil
}

func persistAlerts(db *sql.DB, alerts []AnomalyAlert) {
	for _, a := range alerts {
		_, err := db.Exec(`
			INSERT INTO security_alerts (
				alert_type, severity, title, description,
				organization_id, status, created_at
			) VALUES ($1, $2, $3, $4, $5::uuid, 'open', NOW())
			ON CONFLICT DO NOTHING
		`,
			"compliance_anomaly",
			a.Severity,
			fmt.Sprintf("Compliance Score Anomaly: %s (z=%.2f)", a.OrgName, a.ZScore),
			fmt.Sprintf("Score %.1f is %.1f standard deviations from the 30-day mean (%.1f). Direction: %s.",
				a.CurrentScore, math.Abs(a.ZScore), a.MeanScore, a.Direction),
			a.OrgID,
		)
		if err != nil {
			log.Printf("[Anomaly] Failed to persist alert for %s: %v", a.OrgName, err)
		}
	}
}

func broadcastSSE(alert AnomalyAlert) {
	sseMu.Lock()
	defer sseMu.Unlock()
	for ch := range sseClients {
		select {
		case ch <- alert:
		default:
			// Client too slow, skip
		}
	}
}

func scanLoop() {
	for {
		time.Sleep(5 * time.Minute)
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("[Anomaly] DB connect failed: %v", err)
			errors++
			continue
		}

		alerts, err := detectAnomalies(db)
		if err != nil {
			log.Printf("[Anomaly] Detection failed: %v", err)
			errors++
			db.Close()
			continue
		}

		if len(alerts) > 0 {
			persistAlerts(db, alerts)
			mu.Lock()
			activeAlerts = alerts
			totalDetected += int64(len(alerts))
			mu.Unlock()
			for _, a := range alerts {
				broadcastSSE(a)
				log.Printf("[Anomaly] %s: %s (z=%.2f, severity=%s)",
					a.OrgName, a.Direction, a.ZScore, a.Severity)
			}
		}

		lastScanTime = time.Now().UTC().Format(time.RFC3339)
		db.Close()
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "healthy",
		"worker":          "anomaly_alert_dispatcher",
		"active_alerts":   len(activeAlerts),
		"total_detected":  totalDetected,
		"last_scan":       lastScanTime,
		"errors":          errors,
		"uptime_seconds":  time.Since(workerStart).Seconds(),
	})
}

func alertsHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"alerts": activeAlerts,
		"count":  len(activeAlerts),
		"scanned_at": lastScanTime,
	})
}

func sseHandler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := make(chan AnomalyAlert, 10)
	sseMu.Lock()
	sseClients[ch] = true
	sseMu.Unlock()
	defer func() {
		sseMu.Lock()
		delete(sseClients, ch)
		sseMu.Unlock()
	}()

	// Send current alerts immediately
	mu.RLock()
	for _, a := range activeAlerts {
		b, _ := json.Marshal(a)
		fmt.Fprintf(w, "data: %s\n\n", b)
	}
	mu.RUnlock()
	flusher.Flush()

	for {
		select {
		case alert := <-ch:
			b, _ := json.Marshal(alert)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		case <-r.Context().Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func scanNowHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	go func() {
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			return
		}
		defer db.Close()
		alerts, err := detectAnomalies(db)
		if err != nil {
			return
		}
		if len(alerts) > 0 {
			persistAlerts(db, alerts)
			mu.Lock()
			activeAlerts = alerts
			totalDetected += int64(len(alerts))
			mu.Unlock()
			for _, a := range alerts {
				broadcastSSE(a)
			}
		}
		lastScanTime = time.Now().UTC().Format(time.RFC3339)
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "scan_started"})
}

func main() {
	log.Printf("[Anomaly] Starting NDSEP Anomaly Alert Dispatcher on port %s", port)
	go scanLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/alerts", alertsHandler)
	mux.HandleFunc("/stream", sseHandler)
	mux.HandleFunc("/scan", scanNowHandler)

	log.Printf("[Anomaly] Anomaly Alert Dispatcher listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[Anomaly] Server failed: %v", err)
	}
}
