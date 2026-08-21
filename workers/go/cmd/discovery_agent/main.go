// NDSEP Discovery and vulnerability-ingestion worker.
// It accepts only authoritative asset and vulnerability observations from configured
// providers; it never generates assets, CVEs, agent health, or security alerts.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ndsep/workers/shared"
)

type config struct {
	listenAddr         string
	assetProviderURL   *url.URL
	assetAuthorization string
	vulnerabilityURL   *url.URL
	vulnerabilityAuth  string
	pollEvery          time.Duration
	requestTimeout     time.Duration
}

type upstreamClient struct {
	endpoint      *url.URL
	authorization string
	http          *http.Client
}
type healthState struct {
	mu               sync.RWMutex
	lastAssetSuccess time.Time
	lastVulnSuccess  time.Time
	lastError        string
}

type assetObservation struct {
	OrganizationID     int       `json:"organization_id"`
	OrganizationName   string    `json:"organization_name"`
	ExternalID         string    `json:"external_id"`
	Name               string    `json:"name"`
	AssetType          string    `json:"asset_type"`
	DataClassification string    `json:"data_classification"`
	Status             string    `json:"status"`
	Location           string    `json:"location"`
	IPAddress          string    `json:"ip_address"`
	MACAddress         string    `json:"mac_address"`
	Hostname           string    `json:"hostname"`
	OperatingSystem    string    `json:"operating_system"`
	OSVersion          string    `json:"os_version"`
	Latitude           float64   `json:"latitude"`
	Longitude          float64   `json:"longitude"`
	CloudProvider      string    `json:"cloud_provider"`
	CloudRegion        string    `json:"cloud_region"`
	WithinBorders      bool      `json:"is_within_borders"`
	ObservedAt         time.Time `json:"observed_at"`
}

type vulnerabilityFinding struct {
	AssetExternalID string    `json:"asset_external_id"`
	CVEID           string    `json:"cve_id"`
	Severity        string    `json:"severity"`
	CVSS            float64   `json:"cvss_score"`
	Description     string    `json:"description"`
	ObservedAt      time.Time `json:"observed_at"`
}

var eventsProcessed int64
var assetsDiscovered int64
var cvesDetected int64
var workerStart = time.Now()

func loadConfig() (config, error) {
	assetsURL, err := requiredURL("DISCOVERY_ASSET_PROVIDER_URL")
	if err != nil {
		return config{}, err
	}
	vulnURL, err := requiredURL("VULNERABILITY_SOURCE_URL")
	if err != nil {
		return config{}, err
	}
	assetAuth := strings.TrimSpace(os.Getenv("DISCOVERY_ASSET_PROVIDER_AUTHORIZATION"))
	vulnAuth := strings.TrimSpace(os.Getenv("VULNERABILITY_SOURCE_AUTHORIZATION"))
	if assetAuth == "" || vulnAuth == "" {
		return config{}, errors.New("DISCOVERY_ASSET_PROVIDER_AUTHORIZATION and VULNERABILITY_SOURCE_AUTHORIZATION are required")
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8149"
	}
	interval := 60
	if raw := os.Getenv("DISCOVERY_POLL_SECONDS"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 15 || parsed > 3600 {
			return config{}, errors.New("DISCOVERY_POLL_SECONDS must be between 15 and 3600")
		}
		interval = parsed
	}
	return config{listenAddr: ":" + port, assetProviderURL: assetsURL, assetAuthorization: assetAuth, vulnerabilityURL: vulnURL, vulnerabilityAuth: vulnAuth, pollEvery: time.Duration(interval) * time.Second, requestTimeout: 15 * time.Second}, nil
}

func requiredURL(name string) (*url.URL, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return nil, errors.New(name + " is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New(name + " must be an absolute URL")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if parsed.Scheme != "https" {
			return nil, errors.New(name + " must use HTTPS in production")
		}
		host := strings.ToLower(parsed.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
			return nil, errors.New(name + " must not target a local address in production")
		}
	}
	return parsed, nil
}

func newUpstreamClient(endpoint *url.URL, authorization string, timeout time.Duration) *upstreamClient {
	return &upstreamClient{endpoint: endpoint, authorization: authorization, http: &http.Client{Timeout: timeout}}
}

func (client *upstreamClient) getJSON(ctx context.Context, query url.Values, destination interface{}) error {
	endpoint := *client.endpoint
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", client.authorization)
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("authoritative source returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	return json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(destination)
}

func fetchAssets(ctx context.Context, client *upstreamClient) ([]assetObservation, error) {
	var envelope struct {
		Assets []assetObservation `json:"assets"`
	}
	if err := client.getJSON(ctx, url.Values{}, &envelope); err != nil {
		return nil, err
	}
	for index, asset := range envelope.Assets {
		if asset.OrganizationID <= 0 || strings.TrimSpace(asset.ExternalID) == "" || strings.TrimSpace(asset.Name) == "" || asset.ObservedAt.IsZero() {
			return nil, errors.New("asset provider returned incomplete asset at index " + strconv.Itoa(index))
		}
	}
	return envelope.Assets, nil
}
func fetchFindings(ctx context.Context, client *upstreamClient) ([]vulnerabilityFinding, error) {
	var envelope struct {
		Findings []vulnerabilityFinding `json:"findings"`
	}
	if err := client.getJSON(ctx, url.Values{}, &envelope); err != nil {
		return nil, err
	}
	for index, finding := range envelope.Findings {
		if strings.TrimSpace(finding.AssetExternalID) == "" || strings.TrimSpace(finding.CVEID) == "" || strings.TrimSpace(finding.Severity) == "" || finding.ObservedAt.IsZero() {
			return nil, errors.New("vulnerability source returned incomplete finding at index " + strconv.Itoa(index))
		}
	}
	return envelope.Findings, nil
}

func persistAsset(asset assetObservation) (int, error) {
	var id int
	err := shared.DB.QueryRow(`SELECT id FROM assets WHERE organization_id=$1 AND hostname=$2 ORDER BY id DESC LIMIT 1`, asset.OrganizationID, asset.Hostname).Scan(&id)
	if err == nil {
		_, err = shared.DB.Exec(`UPDATE assets SET name=$1,asset_type=$2,data_classification=$3,status=$4,location=$5,ip_address=$6,mac_address=$7,operating_system=$8,os_version=$9,latitude=$10,longitude=$11,cloud_provider=$12,cloud_region=$13,is_within_borders=$14,last_seen=$15 WHERE id=$16`, asset.Name, asset.AssetType, asset.DataClassification, asset.Status, asset.Location, asset.IPAddress, asset.MACAddress, asset.OperatingSystem, asset.OSVersion, asset.Latitude, asset.Longitude, asset.CloudProvider, asset.CloudRegion, asset.WithinBorders, asset.ObservedAt, id)
		return id, err
	}
	if !errors.Is(err, sqlErrNoRows()) {
		return 0, err
	}
	err = shared.DB.QueryRow(`INSERT INTO assets (organization_id,name,asset_type,data_classification,status,location,ip_address,mac_address,hostname,operating_system,os_version,latitude,longitude,cloud_provider,cloud_region,is_within_borders,vulnerability_count,discovered_at,last_seen,created_at) VALUES ($1,$2,$3::asset_type,$4::data_classification,$5::asset_status,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,$17,$17,NOW()) RETURNING id`, asset.OrganizationID, asset.Name, asset.AssetType, asset.DataClassification, asset.Status, asset.Location, asset.IPAddress, asset.MACAddress, asset.Hostname, asset.OperatingSystem, asset.OSVersion, asset.Latitude, asset.Longitude, asset.CloudProvider, asset.CloudRegion, asset.WithinBorders, asset.ObservedAt).Scan(&id)
	return id, err
}

// sqlErrNoRows is isolated to avoid broad error suppression in provider ingestion.
func sqlErrNoRows() error { return sql.ErrNoRows }

func process(ctx context.Context, assetsClient, vulnerabilityClient *upstreamClient, state *healthState) {
	assets, err := fetchAssets(ctx, assetsClient)
	if err != nil {
		recordError(state, err)
		return
	}
	lookup := make(map[string]assetObservation, len(assets))
	for _, asset := range assets {
		id, saveErr := persistAsset(asset)
		if saveErr != nil {
			recordError(state, saveErr)
			return
		}
		lookup[asset.ExternalID] = asset
		atomic.AddInt64(&assetsDiscovered, 1)
		shared.Broadcast("asset_observed", map[string]interface{}{"type": "asset_observed", "assetId": id, "externalId": asset.ExternalID, "organizationId": asset.OrganizationID, "observedAt": asset.ObservedAt.UTC().Format(time.RFC3339)})
	}
	state.mu.Lock()
	state.lastAssetSuccess = time.Now().UTC()
	state.mu.Unlock()
	findings, err := fetchFindings(ctx, vulnerabilityClient)
	if err != nil {
		recordError(state, err)
		return
	}
	for _, finding := range findings {
		asset, ok := lookup[finding.AssetExternalID]
		if !ok {
			recordError(state, errors.New("vulnerability source referenced asset absent from authoritative asset snapshot"))
			return
		}
		atomic.AddInt64(&cvesDetected, 1)
		_, err := shared.DB.Exec(`UPDATE assets SET vulnerability_count=vulnerability_count+1,last_seen=$1 WHERE organization_id=$2 AND hostname=$3`, finding.ObservedAt, asset.OrganizationID, asset.Hostname)
		if err != nil {
			recordError(state, err)
			return
		}
		if strings.EqualFold(finding.Severity, "critical") {
			_, err = shared.DB.Exec(`INSERT INTO security_alerts (organization_id,title,description,severity,source,alert_type,detected_at) VALUES ($1,$2,$3,'critical'::severity,'authoritative-vulnerability-source','vulnerability',$4)`, asset.OrganizationID, "[CVE] "+finding.CVEID+" on "+asset.Name, finding.Description, finding.ObservedAt)
			if err != nil {
				recordError(state, err)
				return
			}
		}
		shared.Broadcast("vulnerability_observed", map[string]interface{}{"type": "vulnerability_observed", "assetExternalId": finding.AssetExternalID, "cveId": finding.CVEID, "severity": finding.Severity, "cvssScore": finding.CVSS, "observedAt": finding.ObservedAt.UTC().Format(time.RFC3339)})
	}
	state.mu.Lock()
	state.lastVulnSuccess = time.Now().UTC()
	state.lastError = ""
	state.mu.Unlock()
	atomic.AddInt64(&eventsProcessed, 1)
}

func recordError(state *healthState, err error) {
	state.mu.Lock()
	state.lastError = err.Error()
	state.mu.Unlock()
	log.Printf("Discovery dependency unavailable: %v", err)
}
func healthHandler(state *healthState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		assets, vulns, lastError := state.lastAssetSuccess, state.lastVulnSuccess, state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if assets.IsZero() || vulns.IsZero() || time.Since(assets) > 3*time.Minute || time.Since(vulns) > 3*time.Minute {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable", "last_error": lastError})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "service": "discovery-agent", "asset_source_last_success": assets.Format(time.RFC3339), "vulnerability_source_last_success": vulns.Format(time.RFC3339)})
	}
}
func statusHandler(state *healthState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastError := state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "authoritative_only", "eventsProcessed": atomic.LoadInt64(&eventsProcessed), "assetsObserved": atomic.LoadInt64(&assetsDiscovered), "cvesObserved": atomic.LoadInt64(&cvesDetected), "uptimeSeconds": time.Since(workerStart).Seconds(), "last_error": lastError})
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
	assetsClient := newUpstreamClient(cfg.assetProviderURL, cfg.assetAuthorization, cfg.requestTimeout)
	vulnerabilityClient := newUpstreamClient(cfg.vulnerabilityURL, cfg.vulnerabilityAuth, cfg.requestTimeout)
	state := &healthState{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(cfg.pollEvery)
		defer ticker.Stop()
		for {
			processCtx, processCancel := context.WithTimeout(ctx, 2*cfg.requestTimeout)
			process(processCtx, assetsClient, vulnerabilityClient, state)
			processCancel()
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
			log.Printf("Discovery server: %v", err)
			cancel()
		}
	}()
	wait := make(chan os.Signal, 1)
	signal.Notify(wait, os.Interrupt)
	select {
	case <-ctx.Done():
	case <-wait:
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}
