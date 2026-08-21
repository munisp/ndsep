// bgp_live_monitor — NDSEP Enhancement
// Real-time BGP route monitoring daemon with SSE stream support.
// Polls GoBGP/ExaBGP via gRPC/REST, detects anomalies (route leaks, hijacks,
// unexpected withdrawals), and pushes events to PostgreSQL + SSE clients.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// ─── Config ──────────────────────────────────────────────────────────────────

var (
	dbURL   = envOrDefault("NDSEP_PG_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	listenAddr = envOrDefault("BGP_MONITOR_ADDR", ":8765")
	pollInterval = 30 * time.Second
)

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Data Types ───────────────────────────────────────────────────────────────

type BGPRoute struct {
	Prefix      string    `json:"prefix"`
	NextHop     string    `json:"next_hop"`
	ASPath      []int     `json:"as_path"`
	Origin      string    `json:"origin"`
	LocalPref   int       `json:"local_pref"`
	MED         int       `json:"med"`
	Communities []string  `json:"communities"`
	Timestamp   time.Time `json:"timestamp"`
}

type BGPAnomaly struct {
	ID          int64     `json:"id"`
	Type        string    `json:"type"`        // route_leak, hijack, withdrawal, flap
	Prefix      string    `json:"prefix"`
	Description string    `json:"description"`
	Severity    string    `json:"severity"`    // low, medium, high, critical
	DetectedAt  time.Time `json:"detected_at"`
	Resolved    bool      `json:"resolved"`
}

type BGPEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
	At      time.Time   `json:"at"`
}

// ─── SSE Hub ─────────────────────────────────────────────────────────────────

type SSEHub struct {
	mu      sync.RWMutex
	clients map[chan BGPEvent]struct{}
}

func newSSEHub() *SSEHub {
	return &SSEHub{clients: make(map[chan BGPEvent]struct{})}
}

func (h *SSEHub) subscribe() chan BGPEvent {
	ch := make(chan BGPEvent, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *SSEHub) unsubscribe(ch chan BGPEvent) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *SSEHub) broadcast(ev BGPEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- ev:
		default:
			// slow client — drop event
		}
	}
}

// ─── Database ─────────────────────────────────────────────────────────────────

func ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS bgp_route_snapshots (
			id SERIAL PRIMARY KEY,
			prefix TEXT NOT NULL,
			next_hop TEXT,
			as_path JSONB,
			origin TEXT,
			local_pref INTEGER,
			med INTEGER,
			communities JSONB,
			snapshot_at TIMESTAMPTZ DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_bgp_snap_prefix ON bgp_route_snapshots(prefix);
		CREATE INDEX IF NOT EXISTS idx_bgp_snap_at ON bgp_route_snapshots(snapshot_at);

		CREATE TABLE IF NOT EXISTS bgp_anomalies (
			id SERIAL PRIMARY KEY,
			type TEXT NOT NULL,
			prefix TEXT,
			description TEXT,
			severity TEXT DEFAULT 'medium',
			detected_at TIMESTAMPTZ DEFAULT NOW(),
			resolved BOOLEAN DEFAULT FALSE,
			resolved_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_bgp_anom_type ON bgp_anomalies(type);
		CREATE INDEX IF NOT EXISTS idx_bgp_anom_resolved ON bgp_anomalies(resolved);
	`)
	return err
}

func persistAnomaly(db *sql.DB, a BGPAnomaly) (int64, error) {
	var id int64
	err := db.QueryRow(`
		INSERT INTO bgp_anomalies (type, prefix, description, severity, detected_at)
		VALUES ($1, $2, $3, $4, NOW())
		RETURNING id
	`, a.Type, a.Prefix, a.Description, a.Severity).Scan(&id)
	return id, err
}

func getRecentAnomalies(db *sql.DB, limit int) ([]BGPAnomaly, error) {
	rows, err := db.Query(`
		SELECT id, type, prefix, description, severity, detected_at, resolved
		FROM bgp_anomalies
		ORDER BY detected_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var anomalies []BGPAnomaly
	for rows.Next() {
		var a BGPAnomaly
		if err := rows.Scan(&a.ID, &a.Type, &a.Prefix, &a.Description, &a.Severity, &a.DetectedAt, &a.Resolved); err != nil {
			continue
		}
		anomalies = append(anomalies, a)
	}
	return anomalies, nil
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

// Nigerian IP space prefixes (simplified — production would use RPKI/IRR)
var nigerianASNs = map[int]string{
	37148:  "MTN Nigeria",
	29465:  "Airtel Nigeria",
	37076:  "Glo Mobile",
	36873:  "9mobile",
	37282:  "NITEL",
	328205: "NITDA",
}

func detectAnomalies(routes []BGPRoute, prev map[string]BGPRoute) []BGPAnomaly {
	var anomalies []BGPAnomaly
	seen := make(map[string]bool)

	for _, r := range routes {
		seen[r.Prefix] = true

		// Route hijack: Nigerian prefix announced by non-Nigerian ASN
		if len(r.ASPath) > 0 {
			originASN := r.ASPath[len(r.ASPath)-1]
			if _, isNigerian := nigerianASNs[originASN]; !isNigerian {
				// Check if this prefix was previously announced by a Nigerian ASN
				if prev, ok := prev[r.Prefix]; ok && len(prev.ASPath) > 0 {
					prevOrigin := prev.ASPath[len(prev.ASPath)-1]
					if _, wasNigerian := nigerianASNs[prevOrigin]; wasNigerian {
						anomalies = append(anomalies, BGPAnomaly{
							Type:        "hijack",
							Prefix:      r.Prefix,
							Description: fmt.Sprintf("Prefix %s previously originated from Nigerian ASN %d, now from ASN %d", r.Prefix, prevOrigin, originASN),
							Severity:    "critical",
						})
					}
				}
			}
		}

		// Route leak: unusually long AS path (> 8 hops)
		if len(r.ASPath) > 8 {
			anomalies = append(anomalies, BGPAnomaly{
				Type:        "route_leak",
				Prefix:      r.Prefix,
				Description: fmt.Sprintf("Suspiciously long AS path (%d hops) for prefix %s", len(r.ASPath), r.Prefix),
				Severity:    "medium",
			})
		}
	}

	// Unexpected withdrawal: prefix in prev but not in current
	for prefix := range prev {
		if !seen[prefix] {
			anomalies = append(anomalies, BGPAnomaly{
				Type:        "withdrawal",
				Prefix:      prefix,
				Description: fmt.Sprintf("Prefix %s unexpectedly withdrawn from routing table", prefix),
				Severity:    "high",
			})
		}
	}

	return anomalies
}

// ─── Mock Route Fetcher (replace with GoBGP gRPC in production) ──────────────

func fetchRoutes() []BGPRoute {
	// In production: connect to GoBGP via gRPC or ExaBGP via JSON API
	// Here we return a realistic mock of Nigerian IP space
	return []BGPRoute{
		{Prefix: "197.210.0.0/20", NextHop: "196.216.2.1", ASPath: []int{37148, 6453, 3356}, Origin: "IGP", LocalPref: 100, Timestamp: time.Now()},
		{Prefix: "41.58.0.0/17", NextHop: "196.216.2.1", ASPath: []int{29465, 6453}, Origin: "IGP", LocalPref: 100, Timestamp: time.Now()},
		{Prefix: "105.112.0.0/14", NextHop: "196.216.2.5", ASPath: []int{36873, 4637}, Origin: "IGP", LocalPref: 100, Timestamp: time.Now()},
		{Prefix: "154.120.0.0/16", NextHop: "196.216.2.9", ASPath: []int{328205, 37282, 6453}, Origin: "IGP", LocalPref: 100, Timestamp: time.Now()},
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func sseHandler(hub *SSEHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		ch := hub.subscribe()
		defer hub.unsubscribe(ch)

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		// Send initial ping
		fmt.Fprintf(w, "event: ping\ndata: {\"ts\":\"%s\"}\n\n", time.Now().Format(time.RFC3339))
		flusher.Flush()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-ch:
				if !ok {
					return
				}
				data, _ := json.Marshal(ev)
				fmt.Fprintf(w, "event: bgp\ndata: %s\n\n", data)
				flusher.Flush()
			case <-time.After(30 * time.Second):
				// Heartbeat
				fmt.Fprintf(w, "event: ping\ndata: {\"ts\":\"%s\"}\n\n", time.Now().Format(time.RFC3339))
				flusher.Flush()
			}
		}
	}
}

func anomaliesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		anomalies, err := getRecentAnomalies(db, 100)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(anomalies)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "bgp_live_monitor"})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.Printf("[bgp_live_monitor] Starting on %s", listenAddr)

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("DB open: %v", err)
	}
	defer db.Close()

	if err := ensureSchema(db); err != nil {
		log.Fatalf("Schema setup: %v", err)
	}

	hub := newSSEHub()
	prevRoutes := make(map[string]BGPRoute)

	// Background polling goroutine
	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for range ticker.C {
			routes := fetchRoutes()
			anomalies := detectAnomalies(routes, prevRoutes)

			// Update prev routes
			newPrev := make(map[string]BGPRoute)
			for _, r := range routes {
				newPrev[r.Prefix] = r
			}
			prevRoutes = newPrev

			// Broadcast route update
			hub.broadcast(BGPEvent{
				Type:    "routes_update",
				Payload: routes,
				At:      time.Now(),
			})

			// Persist and broadcast anomalies
			for _, a := range anomalies {
				id, err := persistAnomaly(db, a)
				if err != nil {
					log.Printf("Persist anomaly: %v", err)
					continue
				}
				a.ID = id
				hub.broadcast(BGPEvent{
					Type:    "anomaly",
					Payload: a,
					At:      time.Now(),
				})
				log.Printf("[ANOMALY] %s: %s (severity: %s)", a.Type, a.Description, a.Severity)
			}
		}
	}()

	// HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/stream", sseHandler(hub))
	mux.HandleFunc("/anomalies", anomaliesHandler(db))
	mux.HandleFunc("/health", healthHandler)

	srv := &http.Server{Addr: listenAddr, Handler: mux}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[bgp_live_monitor] Shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutCtx)
}
