package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestLoadConfigRequiresBothAuthoritativeSources(t *testing.T) {
	t.Setenv("DISCOVERY_ASSET_PROVIDER_URL", "")
	t.Setenv("DISCOVERY_ASSET_PROVIDER_AUTHORIZATION", "")
	t.Setenv("VULNERABILITY_SOURCE_URL", "")
	t.Setenv("VULNERABILITY_SOURCE_AUTHORIZATION", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing discovery provider configuration to fail")
	}
}

func TestFetchAssetsRequiresCompleteAuthoritativeObservation(t *testing.T) {
	observedAt := time.Now().UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer asset-token" {
			t.Fatal("missing asset-provider authorization")
		}
		_, _ = w.Write([]byte(`{"assets":[{"organization_id":7,"organization_name":"Agency","external_id":"asset-7","name":"authoritative-host","asset_type":"hardware","data_classification":"tier1_pii","status":"active","location":"Lagos","ip_address":"203.0.113.7","mac_address":"00:11:22:33:44:55","hostname":"host.example.ng","operating_system":"Ubuntu","os_version":"22.04","latitude":6.5,"longitude":3.3,"cloud_provider":"Local","cloud_region":"ng","is_within_borders":true,"observed_at":"` + observedAt + `"}]}`))
	}))
	defer server.Close()
	endpoint, err := requiredURLForTest(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	assets, err := fetchAssets(context.Background(), newUpstreamClient(endpoint, "Bearer asset-token", time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 1 || assets[0].ExternalID != "asset-7" {
		t.Fatalf("unexpected assets: %#v", assets)
	}
}

func TestFetchFindingsRejectsMissingObservedAt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"findings":[{"asset_external_id":"asset-7","cve_id":"CVE-2026-0001","severity":"critical"}]}`))
	}))
	defer server.Close()
	endpoint, err := requiredURLForTest(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fetchFindings(context.Background(), newUpstreamClient(endpoint, "Bearer vulnerability-token", time.Second)); err == nil {
		t.Fatal("expected incomplete vulnerability finding to fail closed")
	}
}

func requiredURLForTest(raw string) (*url.URL, error) {
	return url.Parse(raw)
}
