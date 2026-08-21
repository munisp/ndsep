// NDSEP DPI sensor-ingestion worker.
// It consumes authoritative Suricata/Zeek observations from a configured sensor
// gateway. It never fabricates traffic, sensor health, or enforcement actions.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ndsep/workers/shared"
)

type config struct {
	listenAddr string
	sensorURL  *url.URL
	authHeader string
	pollEvery  time.Duration
	timeout    time.Duration
}

type sensorClient struct {
	endpoint   *url.URL
	authHeader string
	http       *http.Client
}
type sensorState struct {
	mu          sync.RWMutex
	lastSuccess time.Time
	lastError   string
}

type sensorEvent struct {
	OrganizationID   int       `json:"organization_id"`
	SourceIP         string    `json:"source_ip"`
	DestinationIP    string    `json:"destination_ip"`
	Protocol         string    `json:"protocol"`
	BytesTransferred int64     `json:"bytes_transferred"`
	CrossBorder      bool      `json:"is_cross_border"`
	Blocked          bool      `json:"is_blocked"`
	IXPSite          string    `json:"ixp_site"`
	Engine           string    `json:"engine"`
	Signature        string    `json:"signature"`
	ObservedAt       time.Time `json:"observed_at"`
}

type sensorStatus struct {
	SiteID           string    `json:"site_id"`
	Status           string    `json:"status"`
	ThroughputGbps   float64   `json:"throughput_gbps"`
	PacketsPerSecond int64     `json:"packets_per_second"`
	ObservedAt       time.Time `json:"observed_at"`
}

var eventsProcessed int64
var blockedCount int64
var crossBorderCount int64
var workerStart = time.Now()

func loadConfig() (config, error) {
	rawURL := strings.TrimSpace(os.Getenv("DPI_SENSOR_URL"))
	auth := strings.TrimSpace(os.Getenv("DPI_SENSOR_AUTHORIZATION"))
	if rawURL == "" || auth == "" {
		return config{}, errors.New("DPI_SENSOR_URL and DPI_SENSOR_AUTHORIZATION are required")
	}
	endpoint, err := url.Parse(rawURL)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return config{}, errors.New("DPI_SENSOR_URL must be an absolute URL")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if endpoint.Scheme != "https" {
			return config{}, errors.New("DPI_SENSOR_URL must use HTTPS in production")
		}
		host := strings.ToLower(endpoint.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
			return config{}, errors.New("DPI_SENSOR_URL must not target a local address in production")
		}
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8150"
	}
	seconds := 15
	if raw := os.Getenv("DPI_SENSOR_POLL_SECONDS"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 5 || parsed > 3600 {
			return config{}, errors.New("DPI_SENSOR_POLL_SECONDS must be between 5 and 3600")
		}
		seconds = parsed
	}
	return config{listenAddr: ":" + port, sensorURL: endpoint, authHeader: auth, pollEvery: time.Duration(seconds) * time.Second, timeout: 10 * time.Second}, nil
}
func newSensorClient(cfg config) *sensorClient {
	return &sensorClient{endpoint: cfg.sensorURL, authHeader: cfg.authHeader, http: &http.Client{Timeout: cfg.timeout}}
}
func (client *sensorClient) fetch(ctx context.Context) ([]sensorEvent, []sensorStatus, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.endpoint.String(), nil)
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Authorization", client.authHeader)
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, nil, errors.New("DPI sensor gateway returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	var envelope struct {
		Events []sensorEvent  `json:"events"`
		Sites  []sensorStatus `json:"sites"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(&envelope); err != nil {
		return nil, nil, err
	}
	for index, event := range envelope.Events {
		if event.OrganizationID <= 0 || event.Protocol == "" || event.IXPSite == "" || event.ObservedAt.IsZero() || event.BytesTransferred < 0 {
			return nil, nil, errors.New("sensor returned incomplete event at index " + strconv.Itoa(index))
		}
		if _, err := netip.ParseAddr(event.SourceIP); err != nil {
			return nil, nil, errors.New("sensor returned invalid source IP")
		}
		if _, err := netip.ParseAddr(event.DestinationIP); err != nil {
			return nil, nil, errors.New("sensor returned invalid destination IP")
		}
	}
	for index, site := range envelope.Sites {
		if site.SiteID == "" || site.Status == "" || site.ObservedAt.IsZero() {
			return nil, nil, errors.New("sensor returned incomplete site status at index " + strconv.Itoa(index))
		}
	}
	return envelope.Events, envelope.Sites, nil
}

func ingest(events []sensorEvent, sites []sensorStatus) error {
	transaction, err := shared.DB.Begin()
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	for _, event := range events {
		var eventID int
		err = transaction.QueryRow(`INSERT INTO network_events (organization_id,source_ip,destination_ip,protocol,bytes_transferred,is_cross_border,is_blocked,ixp_site,detected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, event.OrganizationID, event.SourceIP, event.DestinationIP, event.Protocol, event.BytesTransferred, event.CrossBorder, event.Blocked, event.IXPSite, event.ObservedAt).Scan(&eventID)
		if err != nil {
			return err
		}
		atomic.AddInt64(&eventsProcessed, 1)
		if event.Blocked {
			atomic.AddInt64(&blockedCount, 1)
		}
		if event.CrossBorder {
			atomic.AddInt64(&crossBorderCount, 1)
		}
		shared.Broadcast("network_event_observed", map[string]interface{}{"type": "network_event_observed", "id": eventID, "organizationId": event.OrganizationID, "sourceIp": event.SourceIP, "destinationIp": event.DestinationIP, "protocol": event.Protocol, "bytesTransferred": event.BytesTransferred, "isCrossBorder": event.CrossBorder, "isBlocked": event.Blocked, "ixpSite": event.IXPSite, "engine": event.Engine, "signature": event.Signature, "observedAt": event.ObservedAt.UTC().Format(time.RFC3339)})
	}
	for _, site := range sites {
		shared.Broadcast("dpi_sensor_status", map[string]interface{}{"type": "dpi_sensor_status", "siteId": site.SiteID, "status": site.Status, "throughputGbps": site.ThroughputGbps, "packetsPerSecond": site.PacketsPerSecond, "observedAt": site.ObservedAt.UTC().Format(time.RFC3339)})
	}
	return transaction.Commit()
}
func recordError(state *sensorState, err error) {
	state.mu.Lock()
	state.lastError = err.Error()
	state.mu.Unlock()
	log.Printf("DPI sensor unavailable: %v", err)
}
func healthHandler(state *sensorState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastSuccess, lastError := state.lastSuccess, state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if lastSuccess.IsZero() || time.Since(lastSuccess) > 2*time.Minute {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable", "dependency": "dpi_sensor_gateway", "last_error": lastError})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "service": "dpi_engine", "last_success": lastSuccess.Format(time.RFC3339)})
	}
}
func statusHandler(state *sensorState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastError := state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "authoritative_only", "eventsProcessed": atomic.LoadInt64(&eventsProcessed), "blockedCount": atomic.LoadInt64(&blockedCount), "crossBorderCount": atomic.LoadInt64(&crossBorderCount), "uptimeSeconds": time.Since(workerStart).Seconds(), "lastError": lastError})
	}
}
func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	shared.InitRelay()
	if err := shared.InitDB(); err != nil {
		log.Fatal(err)
	}
	defer shared.DB.Close()
	client, state := newSensorClient(cfg), &sensorState{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(cfg.pollEvery)
		defer ticker.Stop()
		for {
			pollCtx, pollCancel := context.WithTimeout(ctx, 2*cfg.timeout)
			events, sites, fetchErr := client.fetch(pollCtx)
			pollCancel()
			if fetchErr != nil {
				recordError(state, fetchErr)
			} else if ingestErr := ingest(events, sites); ingestErr != nil {
				recordError(state, ingestErr)
			} else {
				state.mu.Lock()
				state.lastSuccess = time.Now().UTC()
				state.lastError = ""
				state.mu.Unlock()
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler(state))
	mux.HandleFunc("GET /status", statusHandler(state))
	server := &http.Server{Addr: cfg.listenAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("DPI server: %v", err)
			cancel()
		}
	}()
	select {}
}
