// Package kafka provides a shared Kafka producer/consumer for NDSEP orchestration.
package kafka

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

const (
	TopicOrgRegistered          = "ndsep.org.registered"
	TopicComplianceAssessed     = "ndsep.compliance.assessed"
	TopicViolationDetected      = "ndsep.violation.detected"
	TopicPenaltyIssued          = "ndsep.penalty.issued"
	TopicPenaltyPaid            = "ndsep.penalty.paid"
	TopicTransferRequested      = "ndsep.transfer.requested"
	TopicTransferApproved       = "ndsep.transfer.approved"
	TopicTransferRejected       = "ndsep.transfer.rejected"
	TopicNetworkBlock           = "ndsep.network.block"
	TopicBGPHijack              = "ndsep.bgp.hijack"
	TopicThreatIntel            = "ndsep.threat.intel"
	TopicIncidentCreated        = "ndsep.incident.created"
	TopicDataResidencyViolation = "ndsep.residency.violation"
	TopicMLRiskUpdated          = "ndsep.ml.risk_score_updated"
	TopicAuditTrail             = "ndsep.audit.trail"
	TopicCertificateIssued      = "ndsep.certificate.issued"
	TopicRevenueDistributed     = "ndsep.revenue.distributed"
	TopicWorkflowStarted        = "ndsep.workflow.started"
	TopicWorkflowCompleted      = "ndsep.workflow.completed"
	TopicPenaltyDisputed        = "ndsep.penalty.disputed"
	TopicIXPEnforcement         = "ndsep.ixp.enforcement"
	TopicLakehouseIngested      = "ndsep.lakehouse.ingested"
	TopicMetricsScraped         = "ndsep.metrics.scraped"
	TopicPCAPCaptured           = "ndsep.pcap.captured"
	TopicReconciliationDone     = "ndsep.reconciliation.done"
	TopicIncidentEscalated      = "ndsep.incident.escalated"
	TopicStreamingProcessed     = "ndsep.streaming.processed"
	TopicViolationRemediated    = "ndsep.violation.remediated"
	TopicSLABreachPredicted     = "ndsep.sla.breach_predicted"
	TopicRegulatorySubmitted    = "ndsep.regulatory.submitted"
)

func AllTopics() []string {
	return []string{
		TopicOrgRegistered, TopicComplianceAssessed, TopicViolationDetected,
		TopicPenaltyIssued, TopicPenaltyPaid, TopicTransferRequested,
		TopicTransferApproved, TopicTransferRejected, TopicNetworkBlock,
		TopicBGPHijack, TopicThreatIntel, TopicIncidentCreated,
		TopicDataResidencyViolation, TopicMLRiskUpdated, TopicAuditTrail,
		TopicCertificateIssued, TopicRevenueDistributed, TopicWorkflowStarted,
		TopicWorkflowCompleted, TopicPenaltyDisputed, TopicIXPEnforcement,
		TopicLakehouseIngested, TopicMetricsScraped, TopicPCAPCaptured,
		TopicReconciliationDone, TopicIncidentEscalated, TopicStreamingProcessed,
		TopicViolationRemediated, TopicSLABreachPredicted, TopicRegulatorySubmitted,
	}
}

type Event struct {
	ID        string          `json:"id"`
	Topic     string          `json:"topic"`
	JourneyID string          `json:"journey_id"`
	Timestamp time.Time       `json:"timestamp"`
	Source    string          `json:"source"`
	Payload   json.RawMessage `json:"payload"`
}

type Client struct {
	brokers      []string
	logger       *log.Logger
	producer     sarama.SyncProducer
	producerMu   sync.Mutex
	producerInit func([]string, *sarama.Config) (sarama.SyncProducer, error)
}

func isProduction() bool {
	return strings.EqualFold(os.Getenv("APP_ENV"), "production") || strings.EqualFold(os.Getenv("NODE_ENV"), "production")
}

func New() *Client {
	brokers := strings.TrimSpace(os.Getenv("KAFKA_BROKERS"))
	if brokers == "" && !isProduction() {
		brokers = "localhost:9092"
	}
	return &Client{
		brokers:      splitBrokers(brokers),
		logger:       log.New(os.Stdout, "[kafka] ", log.LstdFlags),
		producerInit: sarama.NewSyncProducer,
	}
}

func splitBrokers(raw string) []string {
	var brokers []string
	for _, broker := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(broker); trimmed != "" {
			brokers = append(brokers, trimmed)
		}
	}
	return brokers
}

func (c *Client) Brokers() []string {
	return append([]string(nil), c.brokers...)
}

func kafkaEnabled() bool {
	return strings.EqualFold(os.Getenv("KAFKA_ENABLED"), "true")
}

func validateTopic(topic string) error {
	if topic == "" || len(topic) > 249 {
		return errors.New("Kafka topic is required and must be at most 249 characters")
	}
	for _, allowed := range AllTopics() {
		if topic == allowed {
			return nil
		}
	}
	return fmt.Errorf("Kafka topic is not in the NDSEP allow-list: %s", topic)
}

func (c *Client) config() (*sarama.Config, error) {
	if !kafkaEnabled() {
		return nil, errors.New("Kafka is disabled; set KAFKA_ENABLED=true only in an approved environment")
	}
	if len(c.brokers) == 0 {
		return nil, errors.New("KAFKA_BROKERS must contain at least one broker")
	}
	if isProduction() {
		for _, broker := range c.brokers {
			if strings.HasPrefix(broker, "localhost:") || strings.HasPrefix(broker, "127.0.0.1:") {
				return nil, errors.New("production Kafka brokers must not target localhost")
			}
		}
		if !strings.EqualFold(os.Getenv("KAFKA_TLS_ENABLED"), "true") {
			return nil, errors.New("production Kafka requires KAFKA_TLS_ENABLED=true")
		}
		if os.Getenv("KAFKA_SASL_USERNAME") == "" || os.Getenv("KAFKA_SASL_PASSWORD") == "" {
			return nil, errors.New("production Kafka requires KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD")
		}
	}

	config := sarama.NewConfig()
	config.Version = sarama.V3_6_0_0
	config.ClientID = "ndsep-orchestration"
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Retry.Max = 3
	config.Producer.Return.Successes = true
	config.Producer.Return.Errors = true
	config.Producer.Idempotent = true
	config.Net.MaxOpenRequests = 1
	config.Net.DialTimeout = 5 * time.Second
	config.Net.ReadTimeout = 10 * time.Second
	config.Net.WriteTimeout = 10 * time.Second

	if strings.EqualFold(os.Getenv("KAFKA_TLS_ENABLED"), "true") {
		config.Net.TLS.Enable = true
		config.Net.TLS.Config = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	if os.Getenv("KAFKA_SASL_USERNAME") != "" || os.Getenv("KAFKA_SASL_PASSWORD") != "" {
		if os.Getenv("KAFKA_SASL_USERNAME") == "" || os.Getenv("KAFKA_SASL_PASSWORD") == "" {
			return nil, errors.New("KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be configured together")
		}
		config.Net.SASL.Enable = true
		config.Net.SASL.User = os.Getenv("KAFKA_SASL_USERNAME")
		config.Net.SASL.Password = os.Getenv("KAFKA_SASL_PASSWORD")
		config.Net.SASL.Mechanism = sarama.SASLTypePlaintext
	}
	return config, nil
}

func (c *Client) ensureProducer() (sarama.SyncProducer, error) {
	c.producerMu.Lock()
	defer c.producerMu.Unlock()
	if c.producer != nil {
		return c.producer, nil
	}
	config, err := c.config()
	if err != nil {
		return nil, err
	}
	producer, err := c.producerInit(c.brokers, config)
	if err != nil {
		return nil, fmt.Errorf("connect to Kafka broker: %w", err)
	}
	c.producer = producer
	return c.producer, nil
}

func (c *Client) Close() error {
	c.producerMu.Lock()
	defer c.producerMu.Unlock()
	if c.producer == nil {
		return nil
	}
	err := c.producer.Close()
	c.producer = nil
	return err
}

func (c *Client) Publish(topic, journeyID string, payload interface{}) error {
	if err := validateTopic(topic); err != nil {
		return err
	}
	if strings.TrimSpace(journeyID) == "" {
		return errors.New("journey ID is required for a Kafka event")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal Kafka payload: %w", err)
	}
	event := Event{
		ID:        fmt.Sprintf("%s-%d", journeyID, time.Now().UTC().UnixNano()),
		Topic:     topic,
		JourneyID: journeyID,
		Timestamp: time.Now().UTC(),
		Source:    "ndsep-orchestration",
		Payload:   raw,
	}
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal Kafka event: %w", err)
	}
	producer, err := c.ensureProducer()
	if err != nil {
		return err
	}
	partition, offset, err := producer.SendMessage(&sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(journeyID),
		Value: sarama.ByteEncoder(eventJSON),
	})
	if err != nil {
		return fmt.Errorf("required Kafka delivery failed: %w", err)
	}
	c.logger.Printf("PUBLISHED topic=%s journey=%s event_id=%s partition=%d offset=%d", topic, journeyID, event.ID, partition, offset)
	return nil
}

// Subscribe starts a real Sarama partition consumer. Callers own process lifecycle and should
// terminate the process only after closing its Kafka client. Handler failures are logged and the
// message remains observable in broker retention; this primitive does not claim exactly-once processing.
func (c *Client) Subscribe(topic, groupID string, handler func(Event) error) error {
	if err := validateTopic(topic); err != nil {
		return err
	}
	if strings.TrimSpace(groupID) == "" {
		return errors.New("Kafka group ID is required")
	}
	if handler == nil {
		return errors.New("Kafka subscription handler is required")
	}
	config, err := c.config()
	if err != nil {
		return err
	}
	consumer, err := sarama.NewConsumer(c.brokers, config)
	if err != nil {
		return fmt.Errorf("connect Kafka consumer: %w", err)
	}
	partitions, err := consumer.Partitions(topic)
	if err != nil {
		_ = consumer.Close()
		return fmt.Errorf("list Kafka partitions: %w", err)
	}
	for _, partition := range partitions {
		partitionConsumer, err := consumer.ConsumePartition(topic, partition, sarama.OffsetNewest)
		if err != nil {
			_ = consumer.Close()
			return fmt.Errorf("consume Kafka partition %d: %w", partition, err)
		}
		go func(pc sarama.PartitionConsumer) {
			defer pc.Close()
			for message := range pc.Messages() {
				var event Event
				if err := json.Unmarshal(message.Value, &event); err != nil {
					c.logger.Printf("REJECTED malformed Kafka event topic=%s partition=%d offset=%d: %v", message.Topic, message.Partition, message.Offset, err)
					continue
				}
				if err := handler(event); err != nil {
					c.logger.Printf("Kafka handler failed event_id=%s topic=%s: %v", event.ID, message.Topic, err)
				}
			}
		}(partitionConsumer)
	}
	c.logger.Printf("SUBSCRIBED topic=%s group=%s partitions=%d", topic, groupID, len(partitions))
	return nil
}
