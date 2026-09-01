package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupRouteRegistryTest(t *testing.T) (*sql.DB, func()) {
	t.Helper()
	dsn := os.Getenv("APISIX_MANAGER_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("APISIX_MANAGER_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	if !strings.Contains(dsn, "127.0.0.1") && !strings.Contains(dsn, "localhost") {
		t.Fatal("APISIX_MANAGER_TEST_DATABASE_URL must point to a local disposable PostgreSQL instance")
	}
	pool, err := openDatabase(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open disposable PostgreSQL: %v", err)
	}
	migrationPath := filepath.Join("..", "..", "..", "..", "drizzle", "0041_apisix_durable_route_registry.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		pool.Close()
		t.Fatalf("read route registry migration: %v", err)
	}
	if _, err := pool.Exec(`DROP TABLE IF EXISTS gateway_route_sync_attempts CASCADE; DROP TABLE IF EXISTS gateway_routes CASCADE; DROP TYPE IF EXISTS gateway_route_sync_status;`); err != nil {
		pool.Close()
		t.Fatalf("reset disposable registry: %v", err)
	}
	if _, err := pool.Exec(string(migration)); err != nil {
		pool.Close()
		t.Fatalf("apply route registry migration: %v", err)
	}
	cleanup := func() {
		_, _ = pool.Exec(`DROP TABLE IF EXISTS gateway_route_sync_attempts CASCADE; DROP TABLE IF EXISTS gateway_routes CASCADE; DROP TYPE IF EXISTS gateway_route_sync_status;`)
		_ = pool.Close()
	}
	return pool, cleanup
}

func insertTestRoute(t *testing.T, pool *sql.DB, id string) {
	t.Helper()
	_, err := pool.Exec(`
		INSERT INTO gateway_routes (id, name, uri, methods, upstream, plugins, version)
		VALUES ($1, 'Test route', '/api/test', ARRAY['POST'], 'http://ndsep-api:3000', '{}'::jsonb, 1)`, id)
	if err != nil {
		t.Fatalf("insert test route: %v", err)
	}
}

func TestLoadActiveRoutesRequiresPersistedConfiguration(t *testing.T) {
	pool, cleanup := setupRouteRegistryTest(t)
	defer cleanup()
	if _, err := loadActiveRoutes(context.Background(), pool); err == nil {
		t.Fatal("expected an empty durable registry to fail without a compiled route fallback")
	}
	insertTestRoute(t, pool, "test-route")
	routes, err := loadActiveRoutes(context.Background(), pool)
	if err != nil {
		t.Fatalf("load persisted route: %v", err)
	}
	if len(routes) != 1 || routes[0].ID != "test-route" || routes[0].Upstream != "http://ndsep-api:3000" {
		t.Fatalf("unexpected persisted routes: %#v", routes)
	}
}

func TestSyncRouteRecordsSuccessAndFailureDurably(t *testing.T) {
	pool, cleanup := setupRouteRegistryTest(t)
	defer cleanup()
	insertTestRoute(t, pool, "test-route")
	routes, err := loadActiveRoutes(context.Background(), pool)
	if err != nil {
		t.Fatalf("load persisted route: %v", err)
	}
	if len(routes) != 1 {
		t.Fatal("expected one test route")
	}

	var receivedKey string
	successServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedKey = r.Header.Get("X-API-KEY")
		if r.Method != http.MethodPut || r.URL.Path != "/apisix/admin/routes/test-route" {
			t.Fatalf("unexpected APISIX request: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer successServer.Close()
	db = pool
	runtimeConfig = config{apisixAdminURL: successServer.URL, apisixAdminKey: strings.Repeat("k", 32), internalAuthToken: strings.Repeat("a", 32)}
	result := syncRoute(context.Background(), routes[0])
	if result.Error != "" || result.HTTPStatus != http.StatusCreated || receivedKey != runtimeConfig.apisixAdminKey {
		t.Fatalf("expected success and authenticated APISIX request, got %#v", result)
	}

	failureServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer failureServer.Close()
	runtimeConfig.apisixAdminURL = failureServer.URL
	result = syncRoute(context.Background(), routes[0])
	if result.Error == "" || result.HTTPStatus != http.StatusServiceUnavailable {
		t.Fatalf("expected non-2xx APISIX failure, got %#v", result)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := pool.QueryContext(ctx, `SELECT status, http_status FROM gateway_route_sync_attempts ORDER BY attempted_at, id`)
	if err != nil {
		t.Fatalf("query durable synchronization evidence: %v", err)
	}
	defer rows.Close()
	outcomes := make([]string, 0, 2)
	for rows.Next() {
		var status string
		var httpStatus sql.NullInt64
		if err := rows.Scan(&status, &httpStatus); err != nil {
			t.Fatalf("scan durable synchronization evidence: %v", err)
		}
		outcomes = append(outcomes, status)
	}
	if got := strings.Join(outcomes, ","); got != "succeeded,failed" {
		t.Fatalf("expected durable success and failure evidence, got %s", got)
	}
}

func TestInternalAuthRejectsMissingToken(t *testing.T) {
	runtimeConfig = config{internalAuthToken: strings.Repeat("a", 32)}
	handler := requireInternalAuth(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	request := httptest.NewRequest(http.MethodPost, "/routes/sync", nil)
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing internal authorization to be rejected, got %d", response.Code)
	}
}
