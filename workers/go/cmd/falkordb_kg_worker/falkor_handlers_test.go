package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestFalkorRebuildHandlerRequiresPost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/rebuild", nil)
	res := httptest.NewRecorder()
	falkorRebuildHandler(res, req)
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected POST gate to reject GET with %d, got %d", http.StatusMethodNotAllowed, res.Code)
	}
}

func TestFalkorRebuildHandlerRequiresExplicitEnablement(t *testing.T) {
	prior, wasSet := os.LookupEnv("FALKORDB_REBUILD_ENABLED")
	t.Cleanup(func() {
		if wasSet {
			_ = os.Setenv("FALKORDB_REBUILD_ENABLED", prior)
			return
		}
		_ = os.Unsetenv("FALKORDB_REBUILD_ENABLED")
	})
	_ = os.Unsetenv("FALKORDB_REBUILD_ENABLED")

	req := httptest.NewRequest(http.MethodPost, "/rebuild", nil)
	res := httptest.NewRecorder()
	falkorRebuildHandler(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected disabled rebuild to return %d, got %d", http.StatusForbidden, res.Code)
	}
}
