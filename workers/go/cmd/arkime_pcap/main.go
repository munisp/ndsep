// NDSEP Arkime packet-capture proxy worker.
// It retrieves authoritative session data from a configured Arkime Viewer and never
// synthesizes sessions, capture rates, packets, or anomaly events.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultPort = "8142"

type config struct {
	listenAddr string
	viewerURL  *url.URL
	authHeader string
	timeout    time.Duration
}

type arkimeClient struct {
	baseURL    *url.URL
	authHeader string
	http       *http.Client
}

type upstreamHealth struct {
	mu          sync.RWMutex
	lastSuccess time.Time
	lastError   string
}

func loadConfig() (config, error) {
	rawURL := strings.TrimSpace(os.Getenv("ARKIME_URL"))
	authHeader := strings.TrimSpace(os.Getenv("ARKIME_AUTHORIZATION"))
	if rawURL == "" || authHeader == "" {
		return config{}, errors.New("ARKIME_URL and ARKIME_AUTHORIZATION are required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return config{}, errors.New("ARKIME_URL must be an absolute URL")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if parsed.Scheme != "https" {
			return config{}, errors.New("ARKIME_URL must use HTTPS in production")
		}
		host := strings.ToLower(parsed.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
			return config{}, errors.New("ARKIME_URL must not target a local address in production")
		}
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultPort
	}
	return config{
		listenAddr: ":" + port,
		viewerURL:  parsed,
		authHeader: authHeader,
		timeout:    8 * time.Second,
	}, nil
}

func newArkimeClient(cfg config) *arkimeClient {
	return &arkimeClient{
		baseURL:    cfg.viewerURL,
		authHeader: cfg.authHeader,
		http:       &http.Client{Timeout: cfg.timeout},
	}
}

func (client *arkimeClient) sessions(ctx context.Context, length, start int, expression string) (json.RawMessage, error) {
	endpoint := client.baseURL.ResolveReference(&url.URL{Path: "/api/sessions"})
	query := endpoint.Query()
	query.Set("date", "-1")
	query.Set("length", strconv.Itoa(length))
	query.Set("start", strconv.Itoa(start))
	if expression != "" {
		query.Set("expression", expression)
	}
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	// Direct Arkime Viewer uses digest auth. NDSEP therefore requires an approved
	// authentication proxy that exchanges this secret-backed header for Arkime's
	// configured upstream authentication; this worker never attempts a fake login.
	request.Header.Set("Authorization", client.authHeader)
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("Arkime Viewer returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	var payload struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Data == nil {
		return nil, errors.New("Arkime Viewer response omitted session data")
	}
	return payload.Data, nil
}

func (client *arkimeClient) probe(ctx context.Context) error {
	endpoint := client.baseURL.ResolveReference(&url.URL{Path: "/api/eshealth"})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", client.authHeader)
	response, err := client.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("Arkime Viewer health returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	return nil
}

func serviceUnavailable(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "unavailable",
		"service": "arkime_viewer",
		"error":   err.Error(),
	})
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	client := newArkimeClient(cfg)
	health := &upstreamHealth{}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		length, err := boundedInt(r.URL.Query().Get("limit"), 10, 1, 1000)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		start, err := boundedInt(r.URL.Query().Get("start"), 0, 0, 1_000_000)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		sessions, err := client.sessions(r.Context(), length, start, r.URL.Query().Get("expression"))
		if err != nil {
			health.mu.Lock()
			health.lastError = err.Error()
			health.mu.Unlock()
			serviceUnavailable(w, err)
			return
		}
		health.mu.Lock()
		health.lastSuccess = time.Now().UTC()
		health.lastError = ""
		health.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]json.RawMessage{"sessions": sessions})
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := client.probe(ctx); err != nil {
			health.mu.Lock()
			health.lastError = err.Error()
			health.mu.Unlock()
			serviceUnavailable(w, err)
			return
		}
		health.mu.Lock()
		health.lastSuccess = time.Now().UTC()
		health.lastError = ""
		lastSuccess := health.lastSuccess
		health.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":       "ready",
			"service":      "arkime-pcap",
			"last_success": lastSuccess.Format(time.RFC3339),
		})
	})

	server := &http.Server{
		Addr:              cfg.listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Arkime session proxy listening on %s", cfg.listenAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func boundedInt(raw string, fallback, minimum, maximum int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, errors.New("invalid integer query parameter")
	}
	return value, nil
}
