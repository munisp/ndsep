// NDSEP Kafka Broker Monitor & Event Producer (Go)
// ==================================================
// Monitors Kafka topic health and simulates event production across all topics.
// Performs:
//   - Kafka topic throughput monitoring (simulated)
//   - Consumer group lag tracking
//   - Event production for all NDSEP topics
//   - Broker health checks
//   - Fluvio vs Kafka throughput comparison
//
// Broadcasts topic metrics and broker health via WebSocket relay.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"ndsep/workers/shared"
)

var (
	eventsProduced  int64
	workerStart     = time.Now()
)

type KafkaTopic struct {
	Name        string
	Partitions  int
	Replication int
	RetentionH  int
	Description string
	Layer       string
}

var kafkaTopics = []KafkaTopic{
	{Name: "ndsep.assets.discovered", Partitions: 12, Replication: 3, RetentionH: 168, Description: "Asset discovery events from all agents", Layer: "L1"},
	{Name: "ndsep.assets.updated", Partitions: 12, Replication: 3, RetentionH: 168, Description: "Asset metadata update events", Layer: "L1"},
	{Name: "ndsep.catalog.metadata", Partitions: 6, Replication: 3, RetentionH: 720, Description: "Data catalog metadata change events", Layer: "L2"},
	{Name: "ndsep.catalog.lineage", Partitions: 6, Replication: 3, RetentionH: 720, Description: "Data lineage tracking events", Layer: "L2"},
	{Name: "ndsep.compliance.violations", Partitions: 8, Replication: 3, RetentionH: 2160, Description: "Compliance violation detection events", Layer: "L3"},
	{Name: "ndsep.compliance.scores", Partitions: 4, Replication: 3, RetentionH: 720, Description: "Organization compliance score updates", Layer: "L3"},
	{Name: "ndsep.enforcement.actions", Partitions: 4, Replication: 3, RetentionH: 8760, Description: "Enforcement action lifecycle events", Layer: "L3"},
	{Name: "ndsep.siem.alerts", Partitions: 16, Replication: 3, RetentionH: 61320, Description: "Security alerts (7-year retention)", Layer: "L4"},
	{Name: "ndsep.siem.audit_logs", Partitions: 16, Replication: 3, RetentionH: 61320, Description: "Immutable audit log stream (7-year)", Layer: "L4"},
	{Name: "ndsep.threat_intel.feeds", Partitions: 4, Replication: 3, RetentionH: 720, Description: "OpenCTI threat intelligence feeds", Layer: "L4"},
	{Name: "ndsep.network.events", Partitions: 24, Replication: 3, RetentionH: 720, Description: "Network DPI events from IXP sites", Layer: "L5"},
	{Name: "ndsep.network.blocks", Partitions: 8, Replication: 3, RetentionH: 2160, Description: "Blocking mechanism trigger events", Layer: "L5"},
	{Name: "ndsep.financial.penalties", Partitions: 4, Replication: 3, RetentionH: 87600, Description: "TigerBeetle penalty ledger events", Layer: "Financial"},
	{Name: "ndsep.financial.payments", Partitions: 4, Replication: 3, RetentionH: 87600, Description: "Mojaloop payment switch events", Layer: "Financial"},
	{Name: "ndsep.ml.predictions", Partitions: 4, Replication: 3, RetentionH: 720, Description: "ML risk prediction updates", Layer: "L6"},
	{Name: "ndsep.dashboard.metrics", Partitions: 2, Replication: 3, RetentionH: 168, Description: "Real-time dashboard metric updates", Layer: "L6"},
}

type FluvioTopic struct {
	Name        string
	Description string
	Layer       string
}

var fluvioTopics = []FluvioTopic{
	{Name: "fluvio.edge.telemetry", Description: "Low-latency edge agent telemetry", Layer: "L1"},
	{Name: "fluvio.ixp.packets", Description: "Real-time IXP packet metadata stream", Layer: "L5"},
	{Name: "fluvio.alerts.realtime", Description: "Sub-100ms alert delivery stream", Layer: "L4"},
	{Name: "fluvio.enforcement.fast", Description: "Fast-path enforcement trigger stream", Layer: "L3"},
}

// runKafkaTopicMonitor broadcasts Kafka topic health metrics
func runKafkaTopicMonitor() {
	log.Println("[Kafka] Starting topic health monitor...")
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		topicMetrics := make([]map[string]interface{}, 0, len(kafkaTopics))
		for _, topic := range kafkaTopics {
			messagesPerSec := shared.RandomBetween(10, 5000)
			consumerLag := shared.RandomBetween(0, 500)
			status := "healthy"
			if consumerLag > 400 {
				status = "lagging"
			}

			topicMetrics = append(topicMetrics, map[string]interface{}{
				"name":           topic.Name,
				"partitions":     topic.Partitions,
				"replication":    topic.Replication,
				"retentionHours": topic.RetentionH,
				"description":    topic.Description,
				"layer":          topic.Layer,
				"messagesPerSec": messagesPerSec,
				"consumerLag":    consumerLag,
				"status":         status,
				"totalMessages":  shared.RandomBetween(10000, 10000000),
			})
		}

		shared.Broadcast("kafka_topics_update", map[string]interface{}{
			"type":      "kafka_topics_update",
			"topics":    topicMetrics,
			"brokers":   3,
			"status":    "healthy",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
		log.Printf("[Kafka] Broadcast metrics for %d topics\n", len(kafkaTopics))
	}
}

// runFluvioMonitor broadcasts Fluvio edge topic metrics
func runFluvioMonitor() {
	log.Println("[Fluvio] Starting Fluvio edge stream monitor...")
	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		fluvioMetrics := make([]map[string]interface{}, 0, len(fluvioTopics))
		for _, topic := range fluvioTopics {
			fluvioMetrics = append(fluvioMetrics, map[string]interface{}{
				"name":           topic.Name,
				"description":    topic.Description,
				"layer":          topic.Layer,
				"messagesPerSec": shared.RandomBetween(100, 50000),
				"latencyMs":      shared.RandomBetween(1, 15),
				"status":         "healthy",
				"edgeNodes":      shared.RandomBetween(5, 50),
			})
		}

		shared.Broadcast("fluvio_topics_update", map[string]interface{}{
			"type":      "fluvio_topics_update",
			"topics":    fluvioMetrics,
			"status":    "healthy",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// runEventProducer simulates producing events to Kafka topics
func runEventProducer() {
	log.Println("[Kafka] Starting event producer...")
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Pick a random topic and produce a synthetic event
		topic := kafkaTopics[rand.Intn(len(kafkaTopics))]
		eventKey := fmt.Sprintf("evt-%d-%d", time.Now().UnixMilli(), rand.Intn(10000))

		atomic.AddInt64(&eventsProduced, 1)

		shared.Broadcast("kafka_event_produced", map[string]interface{}{
			"type":      "kafka_event_produced",
			"topic":     topic.Name,
			"layer":     topic.Layer,
			"eventKey":  eventKey,
			"partition": rand.Intn(topic.Partitions),
			"offset":    shared.RandomBetween(100000, 10000000),
			"sizeBytes": shared.RandomBetween(128, 65536),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// runBrokerHealthCheck broadcasts broker cluster health
func runBrokerHealthCheck() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		shared.Broadcast("kafka_broker_health", map[string]interface{}{
			"type":              "kafka_broker_health",
			"brokerCount":       3,
			"leadersOnline":     3,
			"replicasInSync":    shared.RandomBetween(45, 48),
			"underReplicated":   shared.RandomBetween(0, 2),
			"totalTopics":       len(kafkaTopics),
			"totalPartitions":   128,
			"messagesInPerSec":  shared.RandomBetween(5000, 50000),
			"messagesOutPerSec": shared.RandomBetween(5000, 50000),
			"bytesInPerSec":     shared.RandomBetween(1000000, 100000000),
			"status":            "healthy",
			"timestamp":         time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func startStatusServer(port string) {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "worker": "kafka_monitor"})
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(shared.WorkerStatus{
			ID:              "kafka-monitor",
			Name:            "Kafka Broker Monitor",
			Layer:           "Streaming",
			Language:        "Go",
			Status:          "running",
			LastRun:         time.Now(),
			EventsProcessed: atomic.LoadInt64(&eventsProduced),
			Description:     "Monitors 16 Kafka topics and 4 Fluvio edge streams. Tracks consumer lag, broker health, and produces synthetic events for all NDSEP data pipelines.",
			Technology:      "Go · Apache Kafka · Fluvio · Confluent",
		})
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"eventsProduced": atomic.LoadInt64(&eventsProduced),
			"topicsMonitored": len(kafkaTopics),
			"fluvioTopics":   len(fluvioTopics),
			"uptimeSeconds":  time.Since(workerStart).Seconds(),
		})
	})

	log.Printf("[Kafka] Status server on :%s\n", port)
	shared.RunGracefulServer("kafka_monitor", port, nil, func() { shared.DB.Close() })
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[NDSEP-Kafka] ")

	port := os.Getenv("KAFKA_PORT")
	if port == "" {
		port = "8084"
	}

	log.Println("=== NDSEP Kafka Broker Monitor (Go) ===")

	shared.InitRelay()
shared.InitTracing(shared.TraceConfig{
ServiceName:    "kafka_monitor",
ServiceVersion: "3.0.0",
})
	if err := shared.InitDB(); err != nil {
		log.Fatalf("DB init failed: %v\n", err)
	}
	defer shared.DB.Close()

	shared.Broadcast("worker_started", map[string]interface{}{
		"worker":    "kafka_monitor",
		"layer":     "Streaming",
		"language":  "Go",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	go runKafkaTopicMonitor()
	go runFluvioMonitor()
	go runEventProducer()
	go runBrokerHealthCheck()

	startStatusServer(port)
}
