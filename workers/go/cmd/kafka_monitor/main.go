// NDSEP streaming monitor. It consumes authoritative Kafka/Fluvio metrics from a
// configured broker-metrics gateway and never produces synthetic stream events.
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

	"ndsep/workers/shared"
)

type config struct {
	listenAddr string
	metricsURL *url.URL
	authHeader string
	pollEvery  time.Duration
	timeout    time.Duration
}
type metricsClient struct {
	endpoint   *url.URL
	authHeader string
	http       *http.Client
}
type healthState struct {
	mu          sync.RWMutex
	lastSuccess time.Time
	lastError   string
}
type topicMetric struct {
	Name              string    `json:"name"`
	Partitions        int       `json:"partitions"`
	Replication       int       `json:"replication"`
	MessagesPerSecond float64   `json:"messages_per_second"`
	ConsumerLag       int64     `json:"consumer_lag"`
	TotalMessages     int64     `json:"total_messages"`
	ObservedAt        time.Time `json:"observed_at"`
}
type brokerMetric struct {
	BrokerCount       int       `json:"broker_count"`
	LeadersOnline     int       `json:"leaders_online"`
	ReplicasInSync    int       `json:"replicas_in_sync"`
	UnderReplicated   int       `json:"under_replicated"`
	MessagesInPerSec  float64   `json:"messages_in_per_second"`
	MessagesOutPerSec float64   `json:"messages_out_per_second"`
	ObservedAt        time.Time `json:"observed_at"`
}
type snapshot struct {
	KafkaTopics  []topicMetric `json:"kafka_topics"`
	FluvioTopics []topicMetric `json:"fluvio_topics"`
	Broker       brokerMetric  `json:"broker"`
}

func loadConfig() (config, error) {
	raw := strings.TrimSpace(os.Getenv("STREAM_METRICS_URL"))
	auth := strings.TrimSpace(os.Getenv("STREAM_METRICS_AUTHORIZATION"))
	if raw == "" || auth == "" {
		return config{}, errors.New("STREAM_METRICS_URL and STREAM_METRICS_AUTHORIZATION are required")
	}
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return config{}, errors.New("STREAM_METRICS_URL must be an absolute URL")
	}
	if os.Getenv("NODE_ENV") == "production" {
		if endpoint.Scheme != "https" {
			return config{}, errors.New("STREAM_METRICS_URL must use HTTPS in production")
		}
		host := strings.ToLower(endpoint.Hostname())
		if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
			return config{}, errors.New("STREAM_METRICS_URL must not target a local address in production")
		}
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8154"
	}
	seconds := 15
	if v := os.Getenv("STREAM_METRICS_POLL_SECONDS"); v != "" {
		parsed, parseErr := strconv.Atoi(v)
		if parseErr != nil || parsed < 5 || parsed > 3600 {
			return config{}, errors.New("STREAM_METRICS_POLL_SECONDS must be between 5 and 3600")
		}
		seconds = parsed
	}
	return config{listenAddr: ":" + port, metricsURL: endpoint, authHeader: auth, pollEvery: time.Duration(seconds) * time.Second, timeout: 10 * time.Second}, nil
}
func newMetricsClient(cfg config) *metricsClient {
	return &metricsClient{endpoint: cfg.metricsURL, authHeader: cfg.authHeader, http: &http.Client{Timeout: cfg.timeout}}
}
func (client *metricsClient) fetch(ctx context.Context) (snapshot, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.endpoint.String(), nil)
	if err != nil {
		return snapshot{}, err
	}
	request.Header.Set("Authorization", client.authHeader)
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return snapshot{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return snapshot{}, errors.New("stream metrics gateway returned HTTP " + strconv.Itoa(response.StatusCode))
	}
	var value snapshot
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<20)).Decode(&value); err != nil {
		return snapshot{}, err
	}
	if value.Broker.ObservedAt.IsZero() || value.Broker.BrokerCount < 1 || value.Broker.LeadersOnline < 0 || value.Broker.UnderReplicated < 0 {
		return snapshot{}, errors.New("stream metrics gateway returned incomplete broker metrics")
	}
	for _, topic := range append(value.KafkaTopics, value.FluvioTopics...) {
		if topic.Name == "" || topic.Partitions < 1 || topic.Replication < 1 || topic.ConsumerLag < 0 || topic.TotalMessages < 0 || topic.ObservedAt.IsZero() {
			return snapshot{}, errors.New("stream metrics gateway returned incomplete topic metrics")
		}
	}
	return value, nil
}
func recordError(state *healthState, err error) {
	state.mu.Lock()
	state.lastError = err.Error()
	state.mu.Unlock()
	log.Printf("stream metrics unavailable: %v", err)
}
func healthHandler(state *healthState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastSuccess, lastError := state.lastSuccess, state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if lastSuccess.IsZero() || time.Since(lastSuccess) > 2*time.Minute {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable", "dependency": "stream_metrics_gateway", "last_error": lastError})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "service": "kafka_monitor", "last_success": lastSuccess.Format(time.RFC3339)})
	}
}
func statusHandler(state *healthState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state.mu.RLock()
		lastError := state.lastError
		state.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "authoritative_only", "last_error": lastError})
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
	client, state := newMetricsClient(cfg), &healthState{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(cfg.pollEvery)
		defer ticker.Stop()
		for {
			pollCtx, pollCancel := context.WithTimeout(ctx, 2*cfg.timeout)
			value, fetchErr := client.fetch(pollCtx)
			pollCancel()
			if fetchErr != nil {
				recordError(state, fetchErr)
			} else {
				shared.Broadcast("kafka_topics_update", map[string]interface{}{"type": "kafka_topics_update", "topics": value.KafkaTopics, "broker": value.Broker, "observedAt": value.Broker.ObservedAt.UTC().Format(time.RFC3339)})
				shared.Broadcast("fluvio_topics_update", map[string]interface{}{"type": "fluvio_topics_update", "topics": value.FluvioTopics, "observedAt": value.Broker.ObservedAt.UTC().Format(time.RFC3339)})
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
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
