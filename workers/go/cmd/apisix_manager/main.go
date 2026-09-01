// NDSEP APISIX Dynamic Route Manager — PostgreSQL-authoritative control plane.
// Port 8153. Active route policy is stored in gateway_routes; this service neither
// carries a compiled route registry nor reports successful synchronization unless
// APISIX responds successfully and the outcome is durably recorded.
package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const serviceName = "ndsep-apisix-manager"

type config struct {
	port              string
	databaseURL       string
	apisixAdminURL    string
	apisixAdminKey    string
	internalAuthToken string
}

type gatewayRoute struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	URI         string          `json:"uri"`
	Methods     []string        `json:"methods"`
	Upstream    string          `json:"upstream"`
	Plugins     json.RawMessage `json:"plugins"`
	JourneyID   sql.NullString  `json:"journey_id"`
	Description sql.NullString  `json:"description"`
	Version     int             `json:"version"`
}

type syncResult struct {
	ID         string `json:"id"`
	Version    int    `json:"version"`
	HTTPStatus int    `json:"http_status,omitempty"`
	Error      string `json:"error,omitempty"`
}

var (
	logger           = log.New(os.Stdout, "[apisix-manager] ", log.LstdFlags|log.LUTC)
	startTime        = time.Now()
	db               *sql.DB
	runtimeConfig    config
	routeCreateCount int64
	errorCount       int64
)

func requiredEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func loadConfig() (config, error) {
	databaseURL, err := requiredEnv("WORKER_DATABASE_URL")
	if err != nil {
		databaseURL, err = requiredEnv("DATABASE_URL")
		if err != nil {
			return config{}, errors.New("WORKER_DATABASE_URL or DATABASE_URL is required")
		}
	}
	apisixAdminURL, err := requiredEnv("APISIX_ADMIN_URL")
	if err != nil {
		return config{}, err
	}
	if os.Getenv("NODE_ENV") == "production" && !strings.HasPrefix(apisixAdminURL, "https://") {
		return config{}, errors.New("APISIX_ADMIN_URL must use https:// in production")
	}
	apisixAdminKey, err := requiredEnv("APISIX_ADMIN_KEY")
	if err != nil {
		return config{}, err
	}
	if len(apisixAdminKey) < 32 {
		return config{}, errors.New("APISIX_ADMIN_KEY must contain at least 32 characters")
	}
	internalAuthToken, err := requiredEnv("APISIX_MANAGER_INTERNAL_AUTH_TOKEN")
	if err != nil {
		return config{}, err
	}
	if len(internalAuthToken) < 32 {
		return config{}, errors.New("APISIX_MANAGER_INTERNAL_AUTH_TOKEN must contain at least 32 characters")
	}
	port := os.Getenv("APISIX_MANAGER_PORT")
	if port == "" {
		port = os.Getenv("APISIX_PORT")
	}
	if port == "" {
		port = "8153"
	}
	return config{port: port, databaseURL: databaseURL, apisixAdminURL: strings.TrimRight(apisixAdminURL, "/"), apisixAdminKey: apisixAdminKey, internalAuthToken: internalAuthToken}, nil
}

func openDatabase(ctx context.Context, databaseURL string) (*sql.DB, error) {
	pool, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(5 * time.Minute)
	if err := pool.PingContext(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func requireInternalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("X-Internal-Auth")
		if len(provided) != len(runtimeConfig.internalAuthToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(runtimeConfig.internalAuthToken)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func loadActiveRoutes(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}) ([]gatewayRoute, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT id, name, uri, methods, upstream, plugins, journey_id, description, version
		  FROM gateway_routes
		 WHERE is_active = true
		 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := make([]gatewayRoute, 0)
	for rows.Next() {
		var route gatewayRoute
		var plugins []byte
		if err := rows.Scan(&route.ID, &route.Name, &route.URI, pq.Array(&route.Methods), &route.Upstream, &plugins, &route.JourneyID, &route.Description, &route.Version); err != nil {
			return nil, err
		}
		if !json.Valid(plugins) {
			return nil, fmt.Errorf("route %s has invalid PostgreSQL plugins JSON", route.ID)
		}
		route.Plugins = append(json.RawMessage(nil), plugins...)
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(routes) == 0 {
		return nil, errors.New("no active gateway_routes are configured")
	}
	return routes, nil
}

func apisixRequest(ctx context.Context, method, path string, body any) (int, error) {
	var payload *strings.Reader
	if body == nil {
		payload = strings.NewReader("")
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		payload = strings.NewReader(string(encoded))
	}
	req, err := http.NewRequestWithContext(ctx, method, runtimeConfig.apisixAdminURL+path, payload)
	if err != nil {
		return 0, err
	}
	req.Header.Set("X-API-KEY", runtimeConfig.apisixAdminKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return response.StatusCode, fmt.Errorf("APISIX returned HTTP %d", response.StatusCode)
	}
	return response.StatusCode, nil
}

func toApisixRoute(route gatewayRoute) (map[string]any, error) {
	var plugins map[string]any
	if err := json.Unmarshal(route.Plugins, &plugins); err != nil {
		return nil, fmt.Errorf("route %s plugins cannot be decoded: %w", route.ID, err)
	}
	return map[string]any{
		"id":      route.ID,
		"name":    route.Name,
		"uri":     route.URI,
		"methods": route.Methods,
		"upstream": map[string]any{
			"type":  "roundrobin",
			"nodes": map[string]int{route.Upstream: 1},
		},
		"plugins": plugins,
	}, nil
}

func recordSyncAttempt(ctx context.Context, route gatewayRoute, status string, httpStatus int, syncErr error) error {
	var errorMessage any
	if syncErr != nil {
		errorMessage = syncErr.Error()
	}
	var statusValue any
	if httpStatus > 0 {
		statusValue = httpStatus
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO gateway_route_sync_attempts (id, route_id, route_version, status, http_status, error_message)
		VALUES ($1, $2, $3, $4::gateway_route_sync_status, $5, $6)`,
		uuid.NewString(), route.ID, route.Version, status, statusValue, errorMessage)
	return err
}

func syncRoute(ctx context.Context, route gatewayRoute) syncResult {
	result := syncResult{ID: route.ID, Version: route.Version}
	apisixRoute, err := toApisixRoute(route)
	if err == nil {
		result.HTTPStatus, err = apisixRequest(ctx, http.MethodPut, "/apisix/admin/routes/"+route.ID, apisixRoute)
	}
	if err != nil {
		result.Error = err.Error()
		atomic.AddInt64(&errorCount, 1)
		if recordErr := recordSyncAttempt(ctx, route, "failed", result.HTTPStatus, err); recordErr != nil {
			result.Error = result.Error + "; failed to persist synchronization evidence: " + recordErr.Error()
		}
		return result
	}
	if err := recordSyncAttempt(ctx, route, "succeeded", result.HTTPStatus, nil); err != nil {
		result.Error = "APISIX accepted route but synchronization evidence was not persisted: " + err.Error()
		atomic.AddInt64(&errorCount, 1)
		return result
	}
	atomic.AddInt64(&routeCreateCount, 1)
	return result
}

func syncRoutes(ctx context.Context) ([]syncResult, error) {
	routes, err := loadActiveRoutes(ctx, db)
	if err != nil {
		return nil, err
	}
	results := make([]syncResult, 0, len(routes))
	failed := false
	for _, route := range routes {
		result := syncRoute(ctx, route)
		if result.Error != "" {
			failed = true
		}
		results = append(results, result)
	}
	if failed {
		return results, errors.New("one or more APISIX route synchronization attempts failed")
	}
	return results, nil
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	databaseHealthy := db != nil && db.PingContext(ctx) == nil
	apisixStatus, apisixErr := apisixRequest(ctx, http.MethodGet, "/apisix/admin/routes", nil)
	apisixHealthy := apisixErr == nil
	status := http.StatusOK
	if !databaseHealthy || !apisixHealthy {
		status = http.StatusServiceUnavailable
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"service":            serviceName,
		"status":             map[bool]string{true: "healthy", false: "unavailable"}[status == http.StatusOK],
		"database_healthy":   databaseHealthy,
		"apisix_healthy":     apisixHealthy,
		"apisix_http_status": apisixStatus,
		"routes_synced":      atomic.LoadInt64(&routeCreateCount),
		"sync_errors":        atomic.LoadInt64(&errorCount),
		"uptime_seconds":     time.Since(startTime).Seconds(),
	})
}

func listRoutesHandler(w http.ResponseWriter, r *http.Request) {
	routes, err := loadActiveRoutes(r.Context(), db)
	if err != nil {
		http.Error(w, "gateway route registry unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"routes": routes, "total": len(routes), "source_of_truth": "postgresql"})
}

func syncHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	results, err := syncRoutes(ctx)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{"accepted": false, "results": results, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"accepted": true, "results": results})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = fmt.Fprintf(w, "ndsep_apisix_routes_synced_total %d\n", atomic.LoadInt64(&routeCreateCount))
	_, _ = fmt.Fprintf(w, "ndsep_apisix_sync_errors_total %d\n", atomic.LoadInt64(&errorCount))
	_, _ = fmt.Fprintf(w, "ndsep_apisix_uptime_seconds %.2f\n", time.Since(startTime).Seconds())
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		logger.Fatal(err)
	}
	runtimeConfig = cfg
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err = openDatabase(ctx, cfg.databaseURL)
	if err != nil {
		logger.Fatalf("PostgreSQL route registry is required: %v", err)
	}
	defer db.Close()
	if _, err := syncRoutes(ctx); err != nil {
		logger.Fatalf("initial APISIX route synchronization failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/routes", requireInternalAuth(listRoutesHandler))
	mux.HandleFunc("/routes/sync", requireInternalAuth(syncHandler))
	server := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	logger.Printf("starting %s on :%s with PostgreSQL route registry", serviceName, cfg.port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatalf("server failed: %v", err)
	}
}
