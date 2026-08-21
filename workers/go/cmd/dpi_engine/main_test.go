package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoadConfigRequiresAuthenticatedSensor(t *testing.T) {
	t.Setenv("DPI_SENSOR_URL", "")
	t.Setenv("DPI_SENSOR_AUTHORIZATION", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing DPI sensor configuration to fail")
	}
}

func TestSensorFetchAcceptsOnlyCompleteAuthoritativeEvents(t *testing.T) {
	observedAt := time.Now().UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer dpi-token" {
			t.Fatal("missing sensor authorization")
		}
		_, _ = w.Write([]byte(`{"events":[{"organization_id":1,"source_ip":"203.0.113.10","destination_ip":"198.51.100.20","protocol":"TLS","bytes_transferred":1024,"is_cross_border":true,"is_blocked":false,"ixp_site":"IXP-NGN-LAG","engine":"suricata","signature":"","observed_at":"` + observedAt + `"}],"sites":[{"site_id":"IXP-NGN-LAG","status":"healthy","throughput_gbps":12.5,"packets_per_second":1000,"observed_at":"` + observedAt + `"}]}`))
	}))
	defer server.Close()
	t.Setenv("DPI_SENSOR_URL", server.URL)
	t.Setenv("DPI_SENSOR_AUTHORIZATION", "Bearer dpi-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	events, sites, err := newSensorClient(cfg).fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || len(sites) != 1 || events[0].SourceIP != "203.0.113.10" {
		t.Fatalf("unexpected sensor result: %#v %#v", events, sites)
	}
}

func TestSensorFetchRejectsMalformedSourceIP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"events":[{"organization_id":1,"source_ip":"not-an-ip","destination_ip":"198.51.100.20","protocol":"TLS","bytes_transferred":1024,"ixp_site":"IXP-NGN-LAG","observed_at":"2026-08-19T00:00:00Z"}],"sites":[]}`))
	}))
	defer server.Close()
	t.Setenv("DPI_SENSOR_URL", server.URL)
	t.Setenv("DPI_SENSOR_AUTHORIZATION", "Bearer dpi-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := newSensorClient(cfg).fetch(context.Background()); err == nil {
		t.Fatal("expected malformed sensor data to fail closed")
	}
}
