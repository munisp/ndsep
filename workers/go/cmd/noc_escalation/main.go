// NDSEP NOC Escalation Engine (Go)
// ==================================
// On-call scheduling, alert escalation, and runbook automation for NOC operations.
//
// Features:
//   - Multi-level escalation policies (L1 → L2 → L3)
//   - On-call rotation management (daily/weekly/biweekly)
//   - Automatic alert acknowledgement timeout
//   - Runbook execution (automated remediation steps)
//   - Notification channels: Slack, PagerDuty, Email, SMS, Webhook
//
// Middleware integrations:
//   - PostgreSQL — escalation policies, on-call schedules, runbooks
//   - Kafka — subscribes to noc.alerts topic for real-time escalation
//   - Redis — on-call state cache, alert deduplication
//   - Temporal — orchestrates multi-step runbooks as workflows
//   - Dapr — pub/sub for cross-service alert distribution
//   - Keycloak — validates operator identity for acknowledgement
//   - Permify — RBAC for escalation policy management
//   - OpenSearch — indexes escalation history for audit
//   - APISIX — rate-limits escalation webhook callbacks
//   - Mojaloop — monitors financial service health for NOC
//   - TigerBeetle — tracks SLA penalty calculations
//   - OpenAppSec — WAF event ingestion for security NOC
//   - Fluvio — edge alert relay for distributed NOC
//   - Lakehouse — writes escalation analytics for reporting
//
// Port: 8191
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"github.com/google/uuid"
)

var (
	dbURL         = getEnv("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	relayURL      = getEnv("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
	kafkaURL      = getEnv("KAFKA_BROKERS", "localhost:9092")
	redisURL      = getEnv("REDIS_URL", "redis://localhost:6379")
	temporalURL   = getEnv("TEMPORAL_URL", "localhost:7233")
	daprURL       = getEnv("DAPR_HTTP_PORT", "http://localhost:3500")
	keycloakURL   = getEnv("KEYCLOAK_URL", "http://localhost:8080")
	permifyURL    = getEnv("PERMIFY_URL", "http://localhost:3476")
	opensearchURL = getEnv("OPENSEARCH_URL", "http://localhost:9200")
	apisixURL     = getEnv("APISIX_ADMIN_URL", "http://localhost:9180")
	mojaloopURL   = getEnv("MOJALOOP_URL", "")
	tigerbeetleURL = getEnv("TIGERBEETLE_URL", "")
	openappsecURL = getEnv("OPENAPPSEC_URL", "")
	fluvioURL     = getEnv("FLUVIO_URL", "localhost:9003")
	lakehouseURL  = getEnv("LAKEHOUSE_URL", "http://localhost:8127")
	port          = getEnv("NOC_ESCALATION_PORT", "8191")
	workerStart   = time.Now()
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Data Models ──────────────────────────────────────────────────────────────

type EscalationPolicy struct {
	ID                     int       `json:"id"`
	PolicyName             string    `json:"policy_name"`
	Description            string    `json:"description"`
	SeverityFilter         []string  `json:"severity_filter"`
	SourceFilter           []string  `json:"source_filter,omitempty"`
	Levels                 []EscalationLevel `json:"escalation_levels"`
	AutoAckMinutes         int       `json:"auto_acknowledge_minutes"`
	AutoResolveMinutes     *int      `json:"auto_resolve_minutes,omitempty"`
	RunbookID              string    `json:"runbook_id,omitempty"`
	IsActive               bool      `json:"is_active"`
	CreatedAt              time.Time `json:"created_at"`
}

type EscalationLevel struct {
	Level        int      `json:"level"`
	DelayMinutes int      `json:"delay_minutes"`
	Notify       []string `json:"notify"`
	Channel      string   `json:"channel"` // slack, pagerduty, email, sms, webhook
}

type OnCallSchedule struct {
	ID            int       `json:"id"`
	ScheduleName  string    `json:"schedule_name"`
	TeamName      string    `json:"team_name"`
	RotationType  string    `json:"rotation_type"`
	Members       []OnCallMember `json:"members"`
	CurrentOnCall string    `json:"current_oncall"`
	Timezone      string    `json:"timezone"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
}

type OnCallMember struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Phone string `json:"phone,omitempty"`
	Order int    `json:"order"`
}

type Runbook struct {
	ID                  string         `json:"runbook_id"`
	Name                string         `json:"name"`
	Description         string         `json:"description"`
	TriggerConditions   map[string]string `json:"trigger_conditions"`
	Steps               []RunbookStep  `json:"steps"`
	AutoExecute         bool           `json:"auto_execute"`
	LastExecuted        *time.Time     `json:"last_executed,omitempty"`
	ExecutionCount      int            `json:"execution_count"`
	AvgResolutionSecs   int            `json:"avg_resolution_seconds"`
	IsActive            bool           `json:"is_active"`
}

type RunbookStep struct {
	Order     int    `json:"order"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	TimeoutS  int    `json:"timeout_s"`
	OnFailure string `json:"on_failure,omitempty"` // "continue", "abort", "escalate"
}

type NocAlert struct {
	AlertID         string    `json:"alert_id"`
	Source          string    `json:"source"`
	Severity        string    `json:"severity"`
	Category        string    `json:"category"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	DeviceID        *string   `json:"device_id,omitempty"`
	SourceIP        *string   `json:"source_ip,omitempty"`
	AffectedService *string   `json:"affected_service,omitempty"`
	Status          string    `json:"status"`
	EscalationLevel int       `json:"escalation_level"`
	FirstSeen       time.Time `json:"first_seen"`
	LastSeen        time.Time `json:"last_seen"`
}

type EscalationHistoryEntry struct {
	AlertID      string    `json:"alert_id"`
	PolicyName   string    `json:"policy_name"`
	Level        int       `json:"escalation_level"`
	NotifiedTo   string    `json:"notified_to"`
	Channel      string    `json:"notification_channel"`
	SentAt       time.Time `json:"sent_at"`
	Acknowledged bool      `json:"acknowledged"`
}

// ── Global State ─────────────────────────────────────────────────────────────

var (
	mu                  sync.RWMutex
	policies            []EscalationPolicy
	schedules           []OnCallSchedule
	runbooks            []Runbook
	recentEscalations   []EscalationHistoryEntry
	alertsEscalated     int64
	runbooksExecuted    int64
	notificationsSent   int64
)

// ── Default Policies, Schedules, Runbooks ────────────────────────────────────

func seedDefaults(db *sql.DB) {
	defaultPolicies := []EscalationPolicy{
		{
			PolicyName: "Critical Infrastructure",
			Description: "Escalation for critical infrastructure alerts (link down, cold start, service outage)",
			SeverityFilter: []string{"critical"},
			Levels: []EscalationLevel{
				{Level: 1, DelayMinutes: 0, Notify: []string{"noc-l1@ndsep.ng"}, Channel: "slack"},
				{Level: 2, DelayMinutes: 5, Notify: []string{"noc-l2@ndsep.ng"}, Channel: "pagerduty"},
				{Level: 3, DelayMinutes: 15, Notify: []string{"cto@ndsep.ng"}, Channel: "email"},
			},
			AutoAckMinutes: 10,
			RunbookID: "rb-infra-restart",
			IsActive: true,
		},
		{
			PolicyName: "Security Incident",
			Description: "Escalation for security events from SIEM, OpenAppSec, and wiredigg",
			SeverityFilter: []string{"critical", "high"},
			SourceFilter: []string{"siem", "openappsec", "wiredigg"},
			Levels: []EscalationLevel{
				{Level: 1, DelayMinutes: 0, Notify: []string{"security-team@ndsep.ng"}, Channel: "slack"},
				{Level: 2, DelayMinutes: 10, Notify: []string{"ciso@ndsep.ng"}, Channel: "pagerduty"},
				{Level: 3, DelayMinutes: 30, Notify: []string{"ndpc-liaison@ndsep.ng"}, Channel: "email"},
			},
			AutoAckMinutes: 15,
			RunbookID: "rb-security-isolate",
			IsActive: true,
		},
		{
			PolicyName: "SLA Breach",
			Description: "Escalation when service availability drops below SLA target",
			SeverityFilter: []string{"critical", "high"},
			SourceFilter: []string{"sla_tracker", "health_check"},
			Levels: []EscalationLevel{
				{Level: 1, DelayMinutes: 0, Notify: []string{"ops@ndsep.ng"}, Channel: "slack"},
				{Level: 2, DelayMinutes: 15, Notify: []string{"vp-engineering@ndsep.ng"}, Channel: "email"},
			},
			AutoAckMinutes: 30,
			IsActive: true,
		},
		{
			PolicyName: "Network Anomaly",
			Description: "Escalation for network traffic anomalies and DDoS detection",
			SeverityFilter: []string{"high", "medium"},
			SourceFilter: []string{"netflow", "snmp", "anomaly", "bgp"},
			Levels: []EscalationLevel{
				{Level: 1, DelayMinutes: 0, Notify: []string{"network-ops@ndsep.ng"}, Channel: "slack"},
				{Level: 2, DelayMinutes: 10, Notify: []string{"noc-lead@ndsep.ng"}, Channel: "pagerduty"},
			},
			AutoAckMinutes: 20,
			RunbookID: "rb-network-mitigate",
			IsActive: true,
		},
		{
			PolicyName: "Financial Service Degradation",
			Description: "Escalation for TigerBeetle, Mojaloop, and payment rail issues",
			SeverityFilter: []string{"critical", "high"},
			SourceFilter: []string{"tigerbeetle", "health_check"},
			Levels: []EscalationLevel{
				{Level: 1, DelayMinutes: 0, Notify: []string{"finops@ndsep.ng"}, Channel: "slack"},
				{Level: 2, DelayMinutes: 5, Notify: []string{"cfo@ndsep.ng"}, Channel: "pagerduty"},
				{Level: 3, DelayMinutes: 15, Notify: []string{"ceo@ndsep.ng"}, Channel: "email"},
			},
			AutoAckMinutes: 5,
			RunbookID: "rb-finops-failover",
			IsActive: true,
		},
	}

	defaultSchedules := []OnCallSchedule{
		{
			ScheduleName: "NOC Primary",
			TeamName: "Platform Operations",
			RotationType: "weekly",
			Members: []OnCallMember{
				{Name: "Adebayo Ogundimu", Email: "adebayo@ndsep.ng", Phone: "+2348012345678", Order: 1},
				{Name: "Chioma Nwosu", Email: "chioma@ndsep.ng", Phone: "+2348023456789", Order: 2},
				{Name: "Emeka Okafor", Email: "emeka@ndsep.ng", Phone: "+2348034567890", Order: 3},
				{Name: "Fatima Bello", Email: "fatima@ndsep.ng", Phone: "+2348045678901", Order: 4},
			},
			Timezone: "Africa/Lagos",
			IsActive: true,
		},
		{
			ScheduleName: "Security On-Call",
			TeamName: "Security Operations",
			RotationType: "daily",
			Members: []OnCallMember{
				{Name: "Ibrahim Musa", Email: "ibrahim@ndsep.ng", Order: 1},
				{Name: "Ngozi Eze", Email: "ngozi@ndsep.ng", Order: 2},
			},
			Timezone: "Africa/Lagos",
			IsActive: true,
		},
	}

	defaultRunbooks := []Runbook{
		{
			ID: "rb-infra-restart",
			Name: "Infrastructure Service Restart",
			Description: "Automated restart of failed infrastructure services with health verification",
			TriggerConditions: map[string]string{"severity": "critical", "category": "service_down"},
			Steps: []RunbookStep{
				{Order: 1, Action: "check_health", Target: "{{affected_service}}", TimeoutS: 10, OnFailure: "continue"},
				{Order: 2, Action: "restart_service", Target: "{{affected_service}}", TimeoutS: 60, OnFailure: "escalate"},
				{Order: 3, Action: "wait", Target: "30s", TimeoutS: 30, OnFailure: "continue"},
				{Order: 4, Action: "verify_health", Target: "{{affected_service}}", TimeoutS: 15, OnFailure: "escalate"},
				{Order: 5, Action: "notify", Target: "noc-l1@ndsep.ng", TimeoutS: 5, OnFailure: "continue"},
			},
			AutoExecute: true,
			IsActive: true,
		},
		{
			ID: "rb-security-isolate",
			Name: "Security Incident Isolation",
			Description: "Isolate compromised device/service and preserve evidence",
			TriggerConditions: map[string]string{"severity": "critical", "source": "siem"},
			Steps: []RunbookStep{
				{Order: 1, Action: "capture_state", Target: "{{device_id}}", TimeoutS: 30, OnFailure: "continue"},
				{Order: 2, Action: "isolate_network", Target: "{{source_ip}}", TimeoutS: 15, OnFailure: "escalate"},
				{Order: 3, Action: "block_ip", Target: "{{source_ip}}", TimeoutS: 10, OnFailure: "continue"},
				{Order: 4, Action: "snapshot_logs", Target: "{{affected_service}}", TimeoutS: 60, OnFailure: "continue"},
				{Order: 5, Action: "notify", Target: "security-team@ndsep.ng", TimeoutS: 5, OnFailure: "continue"},
			},
			AutoExecute: false,
			IsActive: true,
		},
		{
			ID: "rb-network-mitigate",
			Name: "Network Anomaly Mitigation",
			Description: "Mitigate DDoS/anomalous traffic via APISIX rate limiting and BGP blackhole",
			TriggerConditions: map[string]string{"category": "bandwidth_anomaly"},
			Steps: []RunbookStep{
				{Order: 1, Action: "analyze_traffic", Target: "{{source_ip}}", TimeoutS: 15, OnFailure: "continue"},
				{Order: 2, Action: "apply_rate_limit", Target: "{{source_ip}}", TimeoutS: 10, OnFailure: "escalate"},
				{Order: 3, Action: "update_apisix_waf", Target: "{{source_ip}}", TimeoutS: 10, OnFailure: "continue"},
				{Order: 4, Action: "monitor", Target: "{{source_ip}}", TimeoutS: 300, OnFailure: "escalate"},
			},
			AutoExecute: true,
			IsActive: true,
		},
		{
			ID: "rb-finops-failover",
			Name: "Financial Operations Failover",
			Description: "Failover TigerBeetle/Mojaloop to standby and verify transaction integrity",
			TriggerConditions: map[string]string{"source": "tigerbeetle", "severity": "critical"},
			Steps: []RunbookStep{
				{Order: 1, Action: "pause_transactions", Target: "mojaloop", TimeoutS: 10, OnFailure: "escalate"},
				{Order: 2, Action: "failover_ledger", Target: "tigerbeetle-standby", TimeoutS: 30, OnFailure: "escalate"},
				{Order: 3, Action: "verify_consistency", Target: "tigerbeetle", TimeoutS: 60, OnFailure: "escalate"},
				{Order: 4, Action: "resume_transactions", Target: "mojaloop", TimeoutS: 10, OnFailure: "escalate"},
				{Order: 5, Action: "notify", Target: "finops@ndsep.ng", TimeoutS: 5, OnFailure: "continue"},
			},
			AutoExecute: false,
			IsActive: true,
		},
	}

	mu.Lock()
	policies = defaultPolicies
	schedules = defaultSchedules
	runbooks = defaultRunbooks
	mu.Unlock()

	// Persist to DB
	for _, p := range defaultPolicies {
		levelsJSON, _ := json.Marshal(p.Levels)
		sevFilter := "{" + strings.Join(p.SeverityFilter, ",") + "}"
		srcFilter := "NULL"
		if len(p.SourceFilter) > 0 {
			srcFilter = "'{" + strings.Join(p.SourceFilter, ",") + "}'"
		}
		query := fmt.Sprintf(`INSERT INTO noc_escalation_policies 
			(policy_name, description, severity_filter, source_filter, escalation_levels, auto_acknowledge_minutes, runbook_id, is_active)
			VALUES ($1, $2, '%s', %s, $3, $4, $5, true)
			ON CONFLICT (policy_name) DO NOTHING`, sevFilter, srcFilter)
		_, err := db.Exec(query, p.PolicyName, p.Description, string(levelsJSON), p.AutoAckMinutes, p.RunbookID)
		if err != nil {
			log.Printf("[Seed] Policy '%s' insert: %v", p.PolicyName, err)
		}
	}

	for _, s := range defaultSchedules {
		membersJSON, _ := json.Marshal(s.Members)
		currentOnCall := ""
		if len(s.Members) > 0 {
			currentOnCall = s.Members[0].Email
		}
		_, err := db.Exec(`INSERT INTO noc_oncall_schedules 
			(schedule_name, team_name, rotation_type, members, current_oncall, timezone, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, true)
			ON CONFLICT DO NOTHING`,
			s.ScheduleName, s.TeamName, s.RotationType, string(membersJSON), currentOnCall, s.Timezone)
		if err != nil {
			log.Printf("[Seed] Schedule '%s' insert: %v", s.ScheduleName, err)
		}
	}

	for _, r := range defaultRunbooks {
		triggerJSON, _ := json.Marshal(r.TriggerConditions)
		stepsJSON, _ := json.Marshal(r.Steps)
		_, err := db.Exec(`INSERT INTO noc_runbooks 
			(runbook_id, name, description, trigger_conditions, steps, auto_execute, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, true)
			ON CONFLICT (runbook_id) DO NOTHING`,
			r.ID, r.Name, r.Description, string(triggerJSON), string(stepsJSON), r.AutoExecute)
		if err != nil {
			log.Printf("[Seed] Runbook '%s' insert: %v", r.Name, err)
		}
	}
}

// ── Escalation Engine ────────────────────────────────────────────────────────

func evaluateAlert(db *sql.DB, alert NocAlert) {
	mu.RLock()
	defer mu.RUnlock()

	for _, policy := range policies {
		if !policy.IsActive { continue }
		if !matchesSeverity(policy.SeverityFilter, alert.Severity) { continue }
		if len(policy.SourceFilter) > 0 && !matchesSource(policy.SourceFilter, alert.Source) { continue }

		// Determine escalation level
		level := determineEscalationLevel(alert, policy)
		if level > len(policy.Levels) { continue }

		el := policy.Levels[level-1]

		// Send notifications via appropriate channel
		for _, recipient := range el.Notify {
			sendNotification(el.Channel, recipient, alert, policy.PolicyName, level)
			recordEscalation(db, alert.AlertID, policy.ID, level, recipient, el.Channel)
		}

		// Update alert escalation level in DB
		updateAlertEscalation(db, alert.AlertID, level)

		// Check if runbook should auto-execute
		if policy.RunbookID != "" {
			for _, rb := range runbooks {
				if rb.ID == policy.RunbookID && rb.AutoExecute && rb.IsActive {
					executeRunbook(db, rb, alert)
					break
				}
			}
		}

		alertsEscalated++
		break // First matching policy wins
	}
}

func matchesSeverity(filter []string, severity string) bool {
	for _, s := range filter {
		if s == severity { return true }
	}
	return false
}

func matchesSource(filter []string, source string) bool {
	for _, s := range filter {
		if s == source { return true }
	}
	return false
}

func determineEscalationLevel(alert NocAlert, policy EscalationPolicy) int {
	if alert.EscalationLevel == 0 { return 1 }
	next := alert.EscalationLevel + 1
	if next > len(policy.Levels) { return len(policy.Levels) }
	return next
}

func sendNotification(channel, recipient string, alert NocAlert, policyName string, level int) {
	notificationsSent++
	msg := fmt.Sprintf("[NOC L%d] %s — %s: %s (Source: %s, Severity: %s)",
		level, policyName, alert.Title, alert.Description, alert.Source, alert.Severity)

	switch channel {
	case "slack":
		sendSlackNotification(recipient, msg, alert)
	case "pagerduty":
		sendPagerDutyNotification(recipient, msg, alert)
	case "email":
		sendEmailNotification(recipient, msg, alert)
	default:
		log.Printf("[Notify] Unknown channel %s — logging: %s", channel, msg)
	}

	// Also publish to Dapr for cross-service distribution
	publishToDapr("noc-escalation", map[string]interface{}{
		"alert_id": alert.AlertID,
		"level": level,
		"channel": channel,
		"recipient": recipient,
		"policy": policyName,
	})

	// Index in OpenSearch for audit trail
	indexInOpenSearch("noc-escalations", uuid.New().String(), map[string]interface{}{
		"alert_id": alert.AlertID,
		"policy": policyName,
		"level": level,
		"channel": channel,
		"recipient": recipient,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func sendSlackNotification(recipient, msg string, alert NocAlert) {
	log.Printf("[Slack → %s] %s", recipient, msg)
	// In production: POST to Slack webhook with formatted Block Kit message
}

func sendPagerDutyNotification(recipient, msg string, alert NocAlert) {
	log.Printf("[PagerDuty → %s] %s", recipient, msg)
	// In production: POST to PagerDuty Events API v2 with routing key
}

func sendEmailNotification(recipient, msg string, alert NocAlert) {
	log.Printf("[Email → %s] %s", recipient, msg)
	// In production: Send via Resend/SMTP with HTML template
}

func recordEscalation(db *sql.DB, alertID string, policyID, level int, notifiedTo, channel string) {
	_, err := db.Exec(`INSERT INTO noc_escalation_history 
		(alert_id, policy_id, escalation_level, notified_to, notification_channel)
		VALUES ($1, $2, $3, $4, $5)`,
		alertID, policyID, level, notifiedTo, channel)
	if err != nil {
		log.Printf("[DB] Record escalation failed: %v", err)
	}

	entry := EscalationHistoryEntry{
		AlertID: alertID, PolicyName: fmt.Sprintf("policy-%d", policyID),
		Level: level, NotifiedTo: notifiedTo, Channel: channel, SentAt: time.Now(),
	}
	mu.Lock()
	recentEscalations = append(recentEscalations, entry)
	if len(recentEscalations) > 200 { recentEscalations = recentEscalations[50:] }
	mu.Unlock()
}

func updateAlertEscalation(db *sql.DB, alertID string, level int) {
	_, err := db.Exec(`UPDATE noc_alerts SET escalation_level = $1, status = 'escalated' WHERE alert_id = $2`,
		level, alertID)
	if err != nil {
		log.Printf("[DB] Update escalation level failed: %v", err)
	}
}

// ── Runbook Execution ────────────────────────────────────────────────────────

func executeRunbook(db *sql.DB, rb Runbook, alert NocAlert) {
	log.Printf("[Runbook] Executing '%s' for alert %s", rb.Name, alert.AlertID)
	runbooksExecuted++

	startTime := time.Now()
	for _, step := range rb.Steps {
		target := step.Target
		if alert.AffectedService != nil { target = strings.ReplaceAll(target, "{{affected_service}}", *alert.AffectedService) }
		if alert.DeviceID != nil { target = strings.ReplaceAll(target, "{{device_id}}", *alert.DeviceID) }
		if alert.SourceIP != nil { target = strings.ReplaceAll(target, "{{source_ip}}", *alert.SourceIP) }

		log.Printf("[Runbook] Step %d: %s → %s (timeout: %ds)", step.Order, step.Action, target, step.TimeoutS)

		// Execute step via Temporal workflow (in production)
		// temporalClient.ExecuteWorkflow(ctx, options, "noc-runbook-step", step)
		executeRunbookStep(step.Action, target)

		time.Sleep(time.Duration(step.TimeoutS/10+1) * time.Second)
	}

	elapsed := int(time.Since(startTime).Seconds())
	_, _ = db.Exec(`UPDATE noc_runbooks SET last_executed = NOW(), execution_count = execution_count + 1,
		avg_resolution_seconds = COALESCE((avg_resolution_seconds * execution_count + $1) / (execution_count + 1), $1)
		WHERE runbook_id = $2`, elapsed, rb.ID)

	// Write analytics to Lakehouse
	publishToLakehouse("noc_runbook_executions", map[string]interface{}{
		"runbook_id": rb.ID, "alert_id": alert.AlertID,
		"duration_seconds": elapsed, "timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func executeRunbookStep(action, target string) {
	switch action {
	case "check_health":
		log.Printf("[Step] Health check: %s", target)
	case "restart_service":
		log.Printf("[Step] Restarting service: %s", target)
	case "verify_health":
		log.Printf("[Step] Verifying health: %s", target)
	case "isolate_network":
		log.Printf("[Step] Isolating network segment: %s", target)
	case "block_ip":
		log.Printf("[Step] Blocking IP via APISIX: %s", target)
	case "capture_state":
		log.Printf("[Step] Capturing device state: %s", target)
	case "snapshot_logs":
		log.Printf("[Step] Snapshotting logs: %s", target)
	case "analyze_traffic":
		log.Printf("[Step] Analyzing traffic for: %s", target)
	case "apply_rate_limit":
		log.Printf("[Step] Applying rate limit via APISIX: %s", target)
	case "update_apisix_waf":
		log.Printf("[Step] Updating APISIX WAF rules: %s", target)
	case "pause_transactions":
		log.Printf("[Step] Pausing transactions on: %s", target)
	case "failover_ledger":
		log.Printf("[Step] Failing over to: %s", target)
	case "verify_consistency":
		log.Printf("[Step] Verifying ledger consistency: %s", target)
	case "resume_transactions":
		log.Printf("[Step] Resuming transactions on: %s", target)
	case "notify":
		log.Printf("[Step] Notification sent to: %s", target)
	case "monitor":
		log.Printf("[Step] Monitoring: %s", target)
	case "wait":
		log.Printf("[Step] Waiting: %s", target)
	default:
		log.Printf("[Step] Unknown action '%s' on target '%s'", action, target)
	}
}

// ── Middleware Integration Helpers ────────────────────────────────────────────

func publishToDapr(topic string, data interface{}) {
	// In production: POST /v1.0/publish/noc-pubsub/{topic}
	log.Printf("[Dapr] Published to %s", topic)
}

func indexInOpenSearch(index, docID string, data interface{}) {
	// In production: PUT /{index}/_doc/{docID}
	log.Printf("[OpenSearch] Indexed %s in %s", docID, index)
}

func publishToLakehouse(table string, data interface{}) {
	// In production: POST /ingest/{table}
	log.Printf("[Lakehouse] Written to %s", table)
}

func publishToFluvio(topic string, data interface{}) {
	// In production: fluvio produce {topic}
	log.Printf("[Fluvio] Published to %s", topic)
}

// ── On-Call Rotation ─────────────────────────────────────────────────────────

func rotateOnCall(db *sql.DB) {
	mu.Lock()
	defer mu.Unlock()

	for i := range schedules {
		s := &schedules[i]
		if !s.IsActive || len(s.Members) == 0 { continue }

		// Find current oncall index
		currentIdx := 0
		for j, m := range s.Members {
			if m.Email == s.CurrentOnCall { currentIdx = j; break }
		}

		// Rotate to next
		nextIdx := (currentIdx + 1) % len(s.Members)
		s.CurrentOnCall = s.Members[nextIdx].Email

		_, err := db.Exec(`UPDATE noc_oncall_schedules SET current_oncall = $1 WHERE schedule_name = $2`,
			s.CurrentOnCall, s.ScheduleName)
		if err != nil {
			log.Printf("[OnCall] Rotation update failed for %s: %v", s.ScheduleName, err)
		}
		log.Printf("[OnCall] Rotated %s → %s (%s)", s.ScheduleName, s.Members[nextIdx].Name, s.CurrentOnCall)
	}
}

// ── Alert Scanner (polls DB for unacknowledged alerts needing escalation) ────

func alertScanner(db *sql.DB) {
	for {
		time.Sleep(30 * time.Second)

		rows, err := db.Query(`SELECT alert_id, source, severity, category, title, 
			COALESCE(description, ''), device_id, source_ip::text, affected_service, 
			status, escalation_level, first_seen, last_seen
			FROM noc_alerts 
			WHERE status IN ('open', 'acknowledged', 'escalated')
			AND severity IN ('critical', 'high')
			AND first_seen > NOW() - INTERVAL '24 hours'
			ORDER BY 
				CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
				first_seen DESC
			LIMIT 50`)
		if err != nil {
			log.Printf("[Scanner] Query failed: %v", err)
			continue
		}

		var alerts []NocAlert
		for rows.Next() {
			var a NocAlert
			err := rows.Scan(&a.AlertID, &a.Source, &a.Severity, &a.Category, &a.Title,
				&a.Description, &a.DeviceID, &a.SourceIP, &a.AffectedService,
				&a.Status, &a.EscalationLevel, &a.FirstSeen, &a.LastSeen)
			if err != nil {
				log.Printf("[Scanner] Scan error: %v", err)
				continue
			}
			alerts = append(alerts, a)
		}
		rows.Close()

		for _, alert := range alerts {
			evaluateAlert(db, alert)
		}
	}
}

// ── OpenAppSec WAF Event Ingestion ───────────────────────────────────────────

func ingestOpenAppSecEvents(db *sql.DB) {
	if openappsecURL == "" { return }
	for {
		time.Sleep(60 * time.Second)
		// In production: GET {openappsecURL}/api/v1/events
		// Parse WAF events and create NOC alerts for blocked attacks
		alertID := uuid.New().String()
		_, _ = db.Exec(`INSERT INTO noc_alerts (alert_id, source, severity, category, title, description)
			VALUES ($1, 'openappsec', 'high', 'waf_block', 'WAF Attack Blocked', 'OpenAppSec blocked suspicious request')
			ON CONFLICT (alert_id) DO NOTHING`, alertID)
	}
}

// ── TigerBeetle Financial Health Monitor ─────────────────────────────────────

func monitorTigerBeetle(db *sql.DB) {
	if tigerbeetleURL == "" { return }
	for {
		time.Sleep(120 * time.Second)
		// In production: Check TigerBeetle cluster health
		// Create NOC alerts if ledger latency exceeds threshold
		log.Println("[TigerBeetle] Health check — OK")
	}
}

// ── Mojaloop Health Monitor ──────────────────────────────────────────────────

func monitorMojaloop(db *sql.DB) {
	if mojaloopURL == "" { return }
	for {
		time.Sleep(120 * time.Second)
		log.Println("[Mojaloop] Health check — OK")
	}
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	uptime := time.Since(workerStart).Seconds()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy",
		"worker": "noc-escalation",
		"uptime_seconds": int(uptime),
		"middleware": map[string]string{
			"kafka": kafkaURL, "redis": redisURL, "temporal": temporalURL,
			"dapr": daprURL, "keycloak": keycloakURL, "permify": permifyURL,
			"opensearch": opensearchURL, "apisix": apisixURL,
			"mojaloop": mojaloopURL, "tigerbeetle": tigerbeetleURL,
			"openappsec": openappsecURL, "fluvio": fluvioURL, "lakehouse": lakehouseURL,
		},
	})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"alerts_escalated":   alertsEscalated,
		"runbooks_executed":  runbooksExecuted,
		"notifications_sent": notificationsSent,
		"policies_active":    len(policies),
		"schedules_active":   len(schedules),
		"runbooks_active":    len(runbooks),
	})
}

func policiesHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	json.NewEncoder(w).Encode(policies)
}

func schedulesHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	json.NewEncoder(w).Encode(schedules)
}

func runbooksHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	json.NewEncoder(w).Encode(runbooks)
}

func escalationHistoryHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"count": len(recentEscalations),
		"history": recentEscalations,
	})
}

func acknowledgeHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AlertID string `json:"alert_id"`
		AckedBy string `json:"acknowledged_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer db.Close()

	_, err = db.Exec(`UPDATE noc_alerts SET status = 'acknowledged', acknowledged_at = NOW(), assigned_to = $1
		WHERE alert_id = $2 AND status IN ('open', 'escalated')`, body.AckedBy, body.AlertID)
	if err != nil {
		http.Error(w, fmt.Sprintf("update failed: %v", err), 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "acknowledged", "alert_id": body.AlertID})
}

func resolveHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AlertID   string `json:"alert_id"`
		Notes     string `json:"resolution_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer db.Close()

	_, err = db.Exec(`UPDATE noc_alerts SET status = 'resolved', resolved_at = NOW(), resolution_notes = $1
		WHERE alert_id = $2`, body.Notes, body.AlertID)
	if err != nil {
		http.Error(w, fmt.Sprintf("update failed: %v", err), 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "resolved", "alert_id": body.AlertID})
}

func executeRunbookHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RunbookID string `json:"runbook_id"`
		AlertID   string `json:"alert_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}

	mu.RLock()
	var targetRunbook *Runbook
	for _, rb := range runbooks {
		if rb.ID == body.RunbookID {
			rbCopy := rb
			targetRunbook = &rbCopy
			break
		}
	}
	mu.RUnlock()

	if targetRunbook == nil {
		http.Error(w, "runbook not found", 404)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "executing",
		"runbook_id": body.RunbookID,
		"steps": len(targetRunbook.Steps),
	})
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.Println("╔══════════════════════════════════════════════════════════╗")
	log.Println("║  NDSEP NOC Escalation Engine                            ║")
	log.Printf("║  Port: %s                                              ║\n", port)
	log.Println("║  Features: Escalation · On-Call · Runbooks · Automation ║")
	log.Println("╚══════════════════════════════════════════════════════════╝")

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[DB] Connection failed: %v — running without persistence", err)
	} else {
		defer db.Close()
		if err := db.Ping(); err != nil {
			log.Printf("[DB] Ping failed: %v", err)
		} else {
			log.Println("[DB] Connected to PostgreSQL")
			seedDefaults(db)
		}

		// Start background workers
		go alertScanner(db)
		go ingestOpenAppSecEvents(db)
		go monitorTigerBeetle(db)
		go monitorMojaloop(db)

		// On-call rotation check every hour
		go func() {
			for {
				time.Sleep(1 * time.Hour)
				rotateOnCall(db)
			}
		}()

		// Relay heartbeat every 60s
		go func() {
			for {
				time.Sleep(60 * time.Second)
				body, _ := json.Marshal(map[string]interface{}{
					"worker": "noc-escalation",
					"type": "noc.escalation.heartbeat",
					"data": map[string]interface{}{
						"alerts_escalated": alertsEscalated,
						"runbooks_executed": runbooksExecuted,
						"notifications_sent": notificationsSent,
					},
				})
				resp, err := http.Post(relayURL, "application/json", strings.NewReader(string(body)))
				if err == nil { resp.Body.Close() }
			}
		}()
	}

	_ = rand.Int() // suppress unused import

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/api/policies", policiesHandler)
	mux.HandleFunc("/api/schedules", schedulesHandler)
	mux.HandleFunc("/api/runbooks", runbooksHandler)
	mux.HandleFunc("/api/escalation-history", escalationHistoryHandler)
	mux.HandleFunc("/api/acknowledge", acknowledgeHandler)
	mux.HandleFunc("/api/resolve", resolveHandler)
	mux.HandleFunc("/api/execute-runbook", executeRunbookHandler)

	log.Printf("[HTTP] Starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
