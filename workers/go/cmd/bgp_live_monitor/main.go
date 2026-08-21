// NDSEP BGP route-monitor worker.
// It consumes authoritative snapshots from a configured route-feed gateway and never
// generates routes or anomalies when the feed is unavailable.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

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
	Type        string    `json:"type"`
	Prefix      string    `json:"prefix"`
	Description string    `json:"description"`
	Severity    string    `json:"severity"`
	DetectedAt  time.Time `json:"detected_at"`
	Resolved    bool      `json:"resolved"`
}

type BGPEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
	At      time.Time   `json:"at"`
}

type config struct {
	databaseURL string
	listenAddr  string
	feedURL     *url.URL
	authHeader  string
	pollEvery   time.Duration
	timeout     time.Duration
}

type routeFeedClient struct {
	endpoint   *url.URL
	authHeader string
	http       *http.Client
}

type feedState struct {
	mu          sync.RWMutex
	lastSuccess time.Time
	lastError   string
}

type SSEHub struct {
	mu      sync.RWMutex
	clients map[chan BGPEvent]struct{}
}

func newSSEHub() *SSEHub { return &SSEHub{clients: make(map[chan BGPEvent]struct{})} }
func (hub *SSEHub) subscribe() chan BGPEvent {
	channel := make(chan BGPEvent, 64)
	hub.mu.Lock()
	hub.clients[channel] = struct{}{}
	hub.mu.Unlock()
	return channel
}
func (hub *SSEHub) unsubscribe(channel chan BGPEvent) {
	hub.mu.Lock()
	delete(hub.clients, channel)
	hub.mu.Unlock()
	close(channel)
}
func (hub *SSEHub) broadcast(event BGPEvent) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	for channel := range hub.clients {
		select {
		case channel <- event:
		default:
		}
	}
}

func loadConfig() (config, error) {
	databaseURL := strings.TrimSpace(os.Getenv("WORKER_DATABASE_URL"))
	rawFeedURL := strings.TrimSpace(os.Getenv("BGP_ROUTE_FEED_URL"))
	authHeader := strings.TrimSpace(os.Getenv("BGP_ROUTE_FEED_AUTHORIZATION"))
	if databaseURL == "" || rawFeedURL == "" || authHeader == "" {
		return config{}, errors.New("WORKER_DATABASE_URL, BGP_ROUTE_FEED_URL, and BGP_ROUTE_FEED_AUTHORIZATION are required")
	}
	feedURL, err := url.Parse(rawFeedURL)
	if err != nil || feedURL.Scheme == "" || feedURL.Host == "" {
		return config{}, errors.New("BGP_ROUTE_FEED_URL must be an absolute URL")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if feedURL.Scheme != "https" {
			return config{}, errors.New("BGP_ROUTE_FEED_URL must use HTTPS in production")
		}
		host := strings.ToLower(feedURL.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
			return config{}, errors.New("BGP_ROUTE_FEED_URL must not target a local address in production")
		}
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8143"
	}
	pollSeconds := 30
	if raw := os.Getenv("BGP_ROUTE_POLL_SECONDS"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 5 || parsed > 3600 {
			return config{}, errors.New("BGP_ROUTE_POLL_SECONDS must be between 5 and 3600")
		}
		pollSeconds = parsed
	}
	return config{databaseURL: databaseURL, listenAddr: ":" + port, feedURL: feedURL, authHeader: authHeader, pollEvery: time.Duration(pollSeconds) * time.Second, timeout: 10 * time.Second}, nil
}

func newRouteFeedClient(cfg config) *routeFeedClient {
	return &routeFeedClient{endpoint: cfg.feedURL, authHeader: cfg.authHeader, http: &http.Client{Timeout: cfg.timeout}}
}

func (client *routeFeedClient) fetch(ctx context.Context) ([]BGPRoute, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", client.authHeader)
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("BGP route feed returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	var envelope struct {
		Routes []BGPRoute `json:"routes"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(&envelope); err != nil {
		return nil, err
	}
	for index, route := range envelope.Routes {
		if _, err := netip.ParsePrefix(route.Prefix); err != nil {
			return nil, errors.New("route feed returned invalid prefix at index " + strconv.Itoa(index))
		}
		if route.Timestamp.IsZero() {
			return nil, errors.New("route feed returned route without source timestamp")
		}
	}
	return envelope.Routes, nil
}

func ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS bgp_route_snapshots (
			id BIGSERIAL PRIMARY KEY, prefix TEXT NOT NULL, next_hop TEXT, as_path JSONB,
			origin TEXT, local_pref INTEGER, med INTEGER, communities JSONB,
			snapshot_at TIMESTAMPTZ NOT NULL, source_observed_at TIMESTAMPTZ NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_bgp_snap_prefix ON bgp_route_snapshots(prefix);
		CREATE INDEX IF NOT EXISTS idx_bgp_snap_at ON bgp_route_snapshots(snapshot_at);
		CREATE TABLE IF NOT EXISTS bgp_anomalies (
			id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, prefix TEXT, description TEXT,
			severity TEXT DEFAULT 'medium', detected_at TIMESTAMPTZ DEFAULT NOW(),
			resolved BOOLEAN DEFAULT FALSE, resolved_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_bgp_anom_type ON bgp_anomalies(type);
		CREATE INDEX IF NOT EXISTS idx_bgp_anom_resolved ON bgp_anomalies(resolved);
	`)
	return err
}

func persistRoutes(db *sql.DB, routes []BGPRoute) error {
	transaction, err := db.Begin()
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	for _, route := range routes {
		asPath, err := json.Marshal(route.ASPath)
		if err != nil {
			return err
		}
		communities, err := json.Marshal(route.Communities)
		if err != nil {
			return err
		}
		if _, err = transaction.Exec(`INSERT INTO bgp_route_snapshots (prefix,next_hop,as_path,origin,local_pref,med,communities,snapshot_at,source_observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)`, route.Prefix, route.NextHop, asPath, route.Origin, route.LocalPref, route.MED, communities, route.Timestamp); err != nil {
			return err
		}
	}
	return transaction.Commit()
}

func persistAnomaly(db *sql.DB, anomaly BGPAnomaly) (int64, error) {
	var id int64
	err := db.QueryRow(`INSERT INTO bgp_anomalies (type,prefix,description,severity,detected_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING id`, anomaly.Type, anomaly.Prefix, anomaly.Description, anomaly.Severity).Scan(&id)
	return id, err
}

func recentAnomalies(db *sql.DB, limit int) ([]BGPAnomaly, error) {
	rows, err := db.Query(`SELECT id,type,prefix,description,severity,detected_at,resolved FROM bgp_anomalies ORDER BY detected_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []BGPAnomaly
	for rows.Next() {
		var anomaly BGPAnomaly
		if err := rows.Scan(&anomaly.ID, &anomaly.Type, &anomaly.Prefix, &anomaly.Description, &anomaly.Severity, &anomaly.DetectedAt, &anomaly.Resolved); err != nil {
			return nil, err
		}
		result = append(result, anomaly)
	}
	return result, rows.Err()
}

var NigerianASNs = map[int]string{37148: "MTN Nigeria", 29465: "Airtel Nigeria", 37076: "Glo Mobile", 36873: "9mobile", 37282: "NITEL", 328205: "NITDA"}

func detectAnomalies(routes []BGPRoute, previous map[string]BGPRoute) []BGPAnomaly {
	var anomalies []BGPAnomaly
	seen := make(map[string]bool)
	for _, route := range routes {
		seen[route.Prefix] = true
		if len(route.ASPath) > 0 {
			origin := route.ASPath[len(route.ASPath)-1]
			if _, isNigerian := NigerianASNs[origin]; !isNigerian {
				if previousRoute, found := previous[route.Prefix]; found && len(previousRoute.ASPath) > 0 {
					oldOrigin := previousRoute.ASPath[len(previousRoute.ASPath)-1]
					if _, wasNigerian := NigerianASNs[oldOrigin]; wasNigerian {
						anomalies = append(anomalies, BGPAnomaly{Type: "hijack", Prefix: route.Prefix, Description: "authoritative route feed reports origin ASN transition from " + strconv.Itoa(oldOrigin) + " to " + strconv.Itoa(origin), Severity: "critical"})
					}
				}
			}
		}
		if len(route.ASPath) > 8 {
			anomalies = append(anomalies, BGPAnomaly{Type: "route_leak", Prefix: route.Prefix, Description: "authoritative route feed reports an AS path longer than eight hops", Severity: "medium"})
		}
	}
	for prefix := range previous {
		if !seen[prefix] {
			anomalies = append(anomalies, BGPAnomaly{Type: "withdrawal", Prefix: prefix, Description: "authoritative route feed no longer reports the prefix", Severity: "high"})
		}
	}
	return anomalies
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("postgres", cfg.databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}
	if err := ensureSchema(db); err != nil {
		log.Fatal(err)
	}
	client, hub, state := newRouteFeedClient(cfg), newSSEHub(), &feedState{}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go pollRoutes(ctx, client, db, hub, state, cfg.pollEvery)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /stream", sseHandler(hub))
	mux.HandleFunc("GET /anomalies", anomaliesHandler(db))
	mux.HandleFunc("GET /health", healthHandler(state))
	server := &http.Server{Addr: cfg.listenAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("BGP server: %v", err)
			cancel()
		}
	}()
	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}

func pollRoutes(ctx context.Context, client *routeFeedClient, db *sql.DB, hub *SSEHub, state *feedState, every time.Duration) {
	previous := make(map[string]BGPRoute)
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		pollCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		routes, err := client.fetch(pollCtx)
		cancel()
		if err != nil {
			state.mu.Lock()
			state.lastError = err.Error()
			state.mu.Unlock()
			hub.broadcast(BGPEvent{Type: "dependency_unavailable", Payload: map[string]string{"dependency": "bgp_route_feed"}, At: time.Now().UTC()})
		} else if err := persistRoutes(db, routes); err != nil {
			state.mu.Lock()
			state.lastError = err.Error()
			state.mu.Unlock()
		} else {
			anomalies := detectAnomalies(routes, previous)
			next := make(map[string]BGPRoute)
			for _, route := range routes {
				next[route.Prefix] = route
			}
			previous = next
			state.mu.Lock()
			state.lastSuccess = time.Now().UTC()
			state.lastError = ""
			state.mu.Unlock()
			hub.broadcast(BGPEvent{Type: "routes_update", Payload: routes, At: time.Now().UTC()})
			for _, anomaly := range anomalies {
				if id, err := persistAnomaly(db, anomaly); err == nil {
					anomaly.ID = id
					hub.broadcast(BGPEvent{Type: "anomaly", Payload: anomaly, At: time.Now().UTC()})
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func sseHandler(hub *SSEHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE is unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		ch := hub.subscribe()
		defer hub.unsubscribe(ch)
		for {
			select {
			case <-r.Context().Done():
				return
			case event := <-ch:
				data, _ := json.Marshal(event)
				_, _ = w.Write([]byte("event: bgp\ndata: " + string(data) + "\n\n"))
				flusher.Flush()
			}
		}
	}
}
func anomaliesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		anomalies, err := recentAnomalies(db, 100)
		if err != nil {
			http.Error(w, "anomaly store unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(anomalies)
	}
}
func healthHandler(state *feedState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastSuccess, lastError := state.lastSuccess, state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if lastSuccess.IsZero() || (!lastSuccess.IsZero() && time.Since(lastSuccess) > 2*time.Minute) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable", "dependency": "bgp_route_feed", "last_error": lastError})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "service": "bgp_live_monitor", "last_success": lastSuccess.Format(time.RFC3339)})
	}
}
