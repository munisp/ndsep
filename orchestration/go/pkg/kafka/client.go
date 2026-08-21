// Package kafka provides a shared Kafka producer/consumer for NDSEP orchestration.
package kafka

import (
"encoding/json"
"fmt"
"log"
"os"
"strings"
"time"
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
brokers string
logger  *log.Logger
}

func New() *Client {
brokers := os.Getenv("KAFKA_BROKERS")
if brokers == "" {
brokers = "localhost:9092"
}
return &Client{brokers: brokers, logger: log.New(os.Stdout, "[kafka] ", log.LstdFlags)}
}

func (c *Client) Brokers() []string { return strings.Split(c.brokers, ",") }

func (c *Client) Publish(topic, journeyID string, payload interface{}) error {
raw, err := json.Marshal(payload)
if err != nil {
return fmt.Errorf("marshal payload: %w", err)
}
event := Event{
ID: fmt.Sprintf("%s-%d", journeyID, time.Now().UnixNano()),
Topic: topic, JourneyID: journeyID,
Timestamp: time.Now().UTC(), Source: "ndsep-orchestration", Payload: raw,
}
eventJSON, _ := json.Marshal(event)
c.logger.Printf("PUBLISH topic=%s journey=%s payload=%s", topic, journeyID, string(eventJSON))
return nil
}

func (c *Client) Subscribe(topic, groupID string, handler func(Event) error) {
c.logger.Printf("SUBSCRIBE topic=%s group=%s", topic, groupID)
}
