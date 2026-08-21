// NDSEP Event Bus Service (Go) — Real Kafka integration via IBM/sarama. Port 8160.
//
// Kafka (IBM/sarama):
//   - Produces events to 30 NDSEP topics via SyncProducer
//   - Graceful degradation: stub mode when Kafka is unreachable
//
// Fluvio (HTTP proxy):
//   - Publishes edge events to Fluvio via HTTP
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/IBM/sarama"
	"github.com/gorilla/mux"
)

var logger = log.New(os.Stdout, "[event-bus] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	kafkaBrokers  = strings.Split(getenv("KAFKA_BROKERS", "localhost:9092"), ",")
	kafkaEnabled  = getenv("KAFKA_ENABLED", "true") == "true"
	fluvioURL     = getenv("FLUVIO_HTTP_URL", "http://localhost:9003")
	fluvioEnabled = getenv("FLUVIO_ENABLED", "true") == "true"
)

var (
	mu              sync.RWMutex
	kafkaProducer   sarama.SyncProducer
	kafkaConnected  bool
	fluvioConnected bool
	msgProduced     int64
	msgErrors       int64
	fluvioPublished int64
)

var allTopics = []string{
	"ndsep.org.registered","ndsep.compliance.assessed","ndsep.violation.detected",
	"ndsep.penalty.issued","ndsep.penalty.paid","ndsep.transfer.requested",
	"ndsep.transfer.approved","ndsep.transfer.rejected","ndsep.network.block",
	"ndsep.bgp.hijack","ndsep.threat.intel","ndsep.incident.created",
	"ndsep.residency.violation","ndsep.ml.risk_score_updated","ndsep.audit.trail",
	"ndsep.certificate.issued","ndsep.revenue.distributed","ndsep.workflow.started",
	"ndsep.workflow.completed","ndsep.penalty.disputed","ndsep.ixp.enforcement",
	"ndsep.lakehouse.ingested","ndsep.metrics.scraped","ndsep.pcap.captured",
	"ndsep.reconciliation.done","ndsep.incident.escalated","ndsep.streaming.processed",
	"ndsep.violation.remediated","ndsep.sla.breach_predicted","ndsep.regulatory.submitted",
}

// ─── Kafka Init ───────────────────────────────────────────────────────────────

func initKafka() {
	if !kafkaEnabled {
		logger.Println("[Kafka] Disabled")
		return
	}
	go func() {
		for {
			cfg := sarama.NewConfig()
			cfg.Producer.Return.Successes = true
			cfg.Producer.RequiredAcks = sarama.WaitForLocal
			cfg.Producer.Retry.Max = 3
			cfg.Version = sarama.V2_8_0_0
			p, err := sarama.NewSyncProducer(kafkaBrokers, cfg)
			if err != nil {
				logger.Printf("[Kafka] Connect failed (%v), retry in 15s", err)
				mu.Lock()
				kafkaConnected = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			mu.Lock()
			kafkaProducer = p
			kafkaConnected = true
			mu.Unlock()
			logger.Printf("[Kafka] Connected to %v", kafkaBrokers)
			return
		}
	}()
}

// ─── Fluvio Init ──────────────────────────────────────────────────────────────

func initFluvio() {
	if !fluvioEnabled {
		return
	}
	go func() {
		for {
			resp, err := http.Get(fluvioURL + "/health")
			mu.Lock()
			if err == nil && resp.StatusCode == 200 {
				if !fluvioConnected {
					logger.Printf("[Fluvio] Connected to %s", fluvioURL)
				}
				fluvioConnected = true
			} else {
				fluvioConnected = false
			}
			mu.Unlock()
			if resp != nil {
				resp.Body.Close()
			}
			time.Sleep(30 * time.Second)
		}
	}()
}

// ─── Produce ──────────────────────────────────────────────────────────────────

func produceKafka(topic string, payload map[string]interface{}) error {
	mu.RLock()
	p := kafkaProducer
	ok := kafkaConnected
	mu.RUnlock()
	if !ok || p == nil {
		return fmt.Errorf("kafka not connected")
	}
	data, _ := json.Marshal(payload)
	msg := &sarama.ProducerMessage{
		Topic: topic,
		Value: sarama.StringEncoder(data),
	}
	_, _, err := p.SendMessage(msg)
	if err != nil {
		atomic.AddInt64(&msgErrors, 1)
		return err
	}
	atomic.AddInt64(&msgProduced, 1)
	return nil
}

func produceFluvio(topic string, payload map[string]interface{}) {
	mu.RLock()
	ok := fluvioConnected
	mu.RUnlock()
	if !ok {
		return
	}
	data, _ := json.Marshal(map[string]interface{}{"key": topic, "value": payload})
	resp, err := http.Post(fluvioURL+"/produce/"+topic, "application/json",
		strings.NewReader(string(data)))
	if err == nil {
		resp.Body.Close()
		atomic.AddInt64(&fluvioPublished, 1)
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type PublishReq struct {
	Topic     string                 `json:"topic"`
	JourneyID string                 `json:"journey_id"`
	Payload   map[string]interface{} `json:"payload"`
}

func publishHandler(w http.ResponseWriter, r *http.Request) {
	var req PublishReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Topic == "" {
		http.Error(w, `{"error":"topic and payload required"}`, http.StatusBadRequest)
		return
	}
	if req.Payload == nil {
		req.Payload = map[string]interface{}{}
	}
	req.Payload["_published_at"] = time.Now().UTC().Format(time.RFC3339)
	kafkaErr := produceKafka(req.Topic, req.Payload)
	// Edge events also go to Fluvio
	if strings.HasPrefix(req.Topic, "ndsep.network") || strings.HasPrefix(req.Topic, "ndsep.ixp") {
		go produceFluvio("fluvio.edge.telemetry", req.Payload)
	}
	if strings.Contains(req.Topic, "violation") || strings.Contains(req.Topic, "incident") {
		go produceFluvio("fluvio.alerts.realtime", req.Payload)
	}
	w.Header().Set("Content-Type", "application/json")
	mu.RLock()
	kOK := kafkaConnected
	mu.RUnlock()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":              kafkaErr == nil,
		"topic":           req.Topic,
		"kafka_connected": kOK,
		"error":           func() interface{} { if kafkaErr != nil { return kafkaErr.Error() }; return nil }(),
	})
}

func topicsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"topics": allTopics, "count": len(allTopics)})
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	kOK := kafkaConnected
	fOK := fluvioConnected
	mu.RUnlock()
	status := "healthy"
	if !kOK {
		status = "degraded"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":          "event-bus",
		"status":           status,
		"kafka_connected":  kOK,
		"kafka_brokers":    kafkaBrokers,
		"fluvio_connected": fOK,
		"fluvio_url":       fluvioURL,
		"msg_produced":     atomic.LoadInt64(&msgProduced),
		"msg_errors":       atomic.LoadInt64(&msgErrors),
		"fluvio_published": atomic.LoadInt64(&fluvioPublished),
		"topics":           len(allTopics),
		"uptime_seconds":   time.Since(startTime).Seconds(),
		"timestamp":        time.Now().UTC(),
	})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	kOK := kafkaConnected
	fOK := fluvioConnected
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"kafkaConnected":  kOK,
		"fluvioConnected": fOK,
		"msgProduced":     atomic.LoadInt64(&msgProduced),
		"msgErrors":       atomic.LoadInt64(&msgErrors),
		"fluvioPublished": atomic.LoadInt64(&fluvioPublished),
		"topics":          len(allTopics),
		"uptimeSeconds":   time.Since(startTime).Seconds(),
	})
}

func main() {
	port := getenv("PORT", "8160")
	initKafka()
	initFluvio()
	r := mux.NewRouter()
	r.HandleFunc("/health", healthHandler).Methods(http.MethodGet)
	r.HandleFunc("/events/publish", publishHandler).Methods(http.MethodPost)
	r.HandleFunc("/publish", publishHandler).Methods(http.MethodPost)
	r.HandleFunc("/topics", topicsHandler).Methods(http.MethodGet)
	r.HandleFunc("/metrics", metricsHandler).Methods(http.MethodGet)
	logger.Printf("NDSEP Event Bus starting on :%s (Kafka=%v, Fluvio=%s)", port, kafkaBrokers, fluvioURL)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		logger.Fatalf("Server failed: %v", err)
	}
}
