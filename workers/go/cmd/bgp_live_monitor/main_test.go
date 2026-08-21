package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoadConfigRequiresAuthoritativeRouteFeed(t *testing.T) {
	t.Setenv("WORKER_DATABASE_URL", "postgresql://worker.example.invalid/ndsep")
	t.Setenv("BGP_ROUTE_FEED_URL", "")
	t.Setenv("BGP_ROUTE_FEED_AUTHORIZATION", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing route-feed configuration to fail")
	}
}

func TestRouteFeedFetchValidatesAndPreservesSourceTimestamp(t *testing.T) {
	observedAt := time.Now().UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer route-feed-token" {
			t.Fatal("missing route-feed authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"routes":[{"prefix":"203.0.113.0/24","next_hop":"198.51.100.1","as_path":[64500,64501],"origin":"IGP","local_pref":100,"med":0,"communities":[],"timestamp":"` + observedAt + `"}]}`))
	}))
	defer server.Close()

	t.Setenv("WORKER_DATABASE_URL", "postgresql://worker.example.invalid/ndsep")
	t.Setenv("BGP_ROUTE_FEED_URL", server.URL)
	t.Setenv("BGP_ROUTE_FEED_AUTHORIZATION", "Bearer route-feed-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	routes, err := newRouteFeedClient(cfg).fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 || routes[0].Prefix != "203.0.113.0/24" || routes[0].Timestamp.IsZero() {
		t.Fatalf("unexpected authoritative route result: %#v", routes)
	}
}

func TestRouteFeedRejectsInvalidPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"routes":[{"prefix":"not-a-prefix","timestamp":"2026-08-19T00:00:00Z"}]}`))
	}))
	defer server.Close()
	t.Setenv("WORKER_DATABASE_URL", "postgresql://worker.example.invalid/ndsep")
	t.Setenv("BGP_ROUTE_FEED_URL", server.URL)
	t.Setenv("BGP_ROUTE_FEED_AUTHORIZATION", "Bearer route-feed-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := newRouteFeedClient(cfg).fetch(context.Background()); err == nil {
		t.Fatal("expected invalid route prefix to fail closed")
	}
}
