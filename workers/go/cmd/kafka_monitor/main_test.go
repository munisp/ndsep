package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoadConfigRequiresStreamMetricsGateway(t *testing.T) {
	t.Setenv("STREAM_METRICS_URL", "")
	t.Setenv("STREAM_METRICS_AUTHORIZATION", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing stream-metrics configuration to fail")
	}
}

func TestMetricsFetchUsesAuthoritativeGatewayResponse(t *testing.T) {
	observedAt := time.Now().UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer stream-token" {
			t.Fatal("missing stream metrics authorization")
		}
		_, _ = w.Write([]byte(`{"kafka_topics":[{"name":"ndsep.network.events","partitions":24,"replication":3,"messages_per_second":22.5,"consumer_lag":3,"total_messages":200,"observed_at":"` + observedAt + `"}],"fluvio_topics":[],"broker":{"broker_count":3,"leaders_online":3,"replicas_in_sync":9,"under_replicated":0,"messages_in_per_second":22.5,"messages_out_per_second":20,"observed_at":"` + observedAt + `"}}`))
	}))
	defer server.Close()
	t.Setenv("STREAM_METRICS_URL", server.URL)
	t.Setenv("STREAM_METRICS_AUTHORIZATION", "Bearer stream-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	value, err := newMetricsClient(cfg).fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(value.KafkaTopics) != 1 || value.KafkaTopics[0].TotalMessages != 200 || value.Broker.BrokerCount != 3 {
		t.Fatalf("unexpected authoritative metrics: %#v", value)
	}
}

func TestMetricsFetchRejectsIncompleteBrokerData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"kafka_topics":[],"fluvio_topics":[],"broker":{"broker_count":0}}`))
	}))
	defer server.Close()
	t.Setenv("STREAM_METRICS_URL", server.URL)
	t.Setenv("STREAM_METRICS_AUTHORIZATION", "Bearer stream-token")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := newMetricsClient(cfg).fetch(context.Background()); err == nil {
		t.Fatal("expected incomplete broker metrics to fail closed")
	}
}
