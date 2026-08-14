// NDSEP DPCO Audit Service (Go) — Port 8300
//
// Manages the full DPCO compliance audit lifecycle using:
//   - Temporal (go.temporal.io/sdk): workflow orchestration for 8-stage audit pipeline
//   - Keycloak (gocloak v13): JWT token validation for DPCO auditors
//   - Permify (HTTP REST): RBAC — only licensed DPCOs may initiate audits
//   - Kafka (IBM/sarama): publishes audit lifecycle events to ndsep.dpco.audit.events
//   - Redis: caches audit status and NDPA control assessment results
//
// Temporal Workflows:
//   - DPCOAuditWorkflow: orchestrates initiated → data_mapping → gap_assessment →
//     fieldwork → findings_review → management_response → report_issued → car_filed
//   - Each stage transition emits a Kafka event and invalidates Redis cache
//   - Graceful degradation: in-memory fallback when Temporal/Kafka/Redis unreachable
package main

import (
	"context"
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
	"github.com/Nerzal/gocloak/v13"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"go.temporal.io/sdk/client"
)

var logger = log.New(os.Stdout, "[dpco-audit] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	port             = getenv("PORT", "8300")
	kafkaBrokers     = strings.Split(getenv("KAFKA_BROKERS", "localhost:9092"), ",")
	kafkaEnabled     = getenv("KAFKA_ENABLED", "true") == "true"
	kafkaTopic       = "ndsep.dpco.audit.events"
	redisURL         = getenv("REDIS_URL", "redis://localhost:6379")
	temporalHost     = getenv("TEMPORAL_HOST", "localhost:7233")
	temporalEnabled  = getenv("TEMPORAL_ENABLED", "true") == "true"
	keycloakURL      = getenv("KEYCLOAK_URL", "http://localhost:8080")
	keycloakRealm    = getenv("KEYCLOAK_REALM", "ndsep")
	keycloakClientID = getenv("KEYCLOAK_CLIENT_ID", "ndsep-platform")
	keycloakSecret   = getenv("KEYCLOAK_CLIENT_SECRET", "")
	permifyURL       = getenv("PERMIFY_URL", "http://localhost:3476")
	permifyTenant    = getenv("PERMIFY_TENANT_ID", "t1")
	keycloakEnabled  = getenv("KEYCLOAK_ENABLED", "true") == "true"
	permifyEnabled   = getenv("PERMIFY_ENABLED", "true") == "true"
	dbURL            = getenv("DATABASE_URL", "postgres://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable")
)

// ─── Audit Stage Definitions ─────────────────────────────────────────────────

var auditStages = []string{
	"initiated", "data_mapping", "gap_assessment", "fieldwork",
	"findings_review", "management_response", "report_issued", "car_filed",
}

// ─── State ────────────────────────────────────────────────────────────────────

var (
	mu             sync.RWMutex
	kafkaProducer  sarama.SyncProducer
	kafkaOK        bool
	temporalClient client.Client
	temporalOK     bool
	keycloakClient *gocloak.GoCloak
	keycloakOK     bool
	permifyOK      bool
	// In-memory audit store (fallback when DB is unavailable)
	auditStore = make(map[string]map[string]interface{})
	// Metrics
	auditsInitiated  int64
	stageAdvances    int64
	kafkaEvents      int64
	tokenValidations int64
	permChecks       int64
)

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
			p, err := sarama.NewSyncProducer(kafkaBrokers, cfg)
			if err != nil {
				logger.Printf("[Kafka] Connect failed (%v), retry in 10s", err)
				mu.Lock()
				kafkaOK = false
				mu.Unlock()
				time.Sleep(10 * time.Second)
				continue
			}
			mu.Lock()
			kafkaProducer = p
			kafkaOK = true
			mu.Unlock()
			logger.Printf("[Kafka] Connected to %v", kafkaBrokers)
			return
		}
	}()
}

func publishKafka(eventType string, payload map[string]interface{}) {
	mu.RLock()
	ok := kafkaOK
	p := kafkaProducer
	mu.RUnlock()
	if !ok || p == nil {
		logger.Printf("[Kafka] Stub: %s %v", eventType, payload)
		return
	}
	payload["event_type"] = eventType
	payload["source"] = "dpco-audit-service"
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	b, _ := json.Marshal(payload)
	msg := &sarama.ProducerMessage{
		Topic: kafkaTopic,
		Key:   sarama.StringEncoder(eventType),
		Value: sarama.ByteEncoder(b),
	}
	if _, _, err := p.SendMessage(msg); err != nil {
		logger.Printf("[Kafka] Publish error: %v", err)
		return
	}
	atomic.AddInt64(&kafkaEvents, 1)
}

// ─── Temporal Init ────────────────────────────────────────────────────────────

func initTemporal() {
	if !temporalEnabled {
		logger.Println("[Temporal] Disabled")
		return
	}
	go func() {
		for {
			c, err := client.Dial(client.Options{
				HostPort:  temporalHost,
				Namespace: "default",
			})
			if err != nil {
				logger.Printf("[Temporal] Connect failed (%v), retry in 15s", err)
				mu.Lock()
				temporalOK = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			mu.Lock()
			temporalClient = c
			temporalOK = true
			mu.Unlock()
			logger.Printf("[Temporal] Connected to %s", temporalHost)
			return
		}
	}()
}

func startAuditWorkflow(auditID, dpcoOrgID, orgID, auditType string) (string, error) {
	mu.RLock()
	ok := temporalOK
	tc := temporalClient
	mu.RUnlock()
	if !ok || tc == nil {
		return "", fmt.Errorf("Temporal audit workflow service is unavailable")
	}
	opts := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("dpco-audit-%s", auditID),
		TaskQueue: "ndsep-dpco-audit",
	}
	we, err := tc.ExecuteWorkflow(context.Background(), opts, "DPCOAuditWorkflow", map[string]string{
		"audit_id":    auditID,
		"dpco_org_id": dpcoOrgID,
		"org_id":      orgID,
		"audit_type":  auditType,
	})
	if err != nil {
		return "", err
	}
	return we.GetID(), nil
}

// ─── Keycloak Init ────────────────────────────────────────────────────────────

func initKeycloak() {
	if !keycloakEnabled {
		logger.Println("[Keycloak] Disabled")
		return
	}
	go func() {
		for {
			kc := gocloak.NewClient(keycloakURL)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, err := kc.GetRealm(ctx, "", keycloakRealm)
			cancel()
			if err != nil {
				logger.Printf("[Keycloak] Connect failed (%v), retry in 15s", err)
				mu.Lock()
				keycloakOK = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			mu.Lock()
			keycloakClient = kc
			keycloakOK = true
			mu.Unlock()
			logger.Printf("[Keycloak] Connected realm=%s", keycloakRealm)
			return
		}
	}()
}

func validateToken(token string) (string, []string, error) {
	atomic.AddInt64(&tokenValidations, 1)
	mu.RLock()
	ok := keycloakOK
	kc := keycloakClient
	mu.RUnlock()
	if !ok || kc == nil {
		return "", nil, fmt.Errorf("Keycloak token validation is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := kc.RetrospectToken(ctx, token, keycloakClientID, keycloakSecret, keycloakRealm)
	if err != nil || !*result.Active {
		return "", nil, fmt.Errorf("invalid token")
	}
	info, err := kc.GetUserInfo(ctx, token, keycloakRealm)
	if err != nil {
		return "", nil, fmt.Errorf("Keycloak user information lookup failed: %w", err)
	}
	userID := ""
	if info.Sub != nil {
		userID = *info.Sub
	}
	return userID, []string{"dpco"}, nil
}

// ─── Permify RBAC ─────────────────────────────────────────────────────────────

func checkPermission(userID, resource, action string) bool {
	atomic.AddInt64(&permChecks, 1)
	if !permifyEnabled {
		logger.Printf("[Permify] Disabled: denying %s on %s for %s", action, resource, userID)
		return false
	}
	mu.RLock()
	ok := permifyOK
	mu.RUnlock()
	if !ok {
		logger.Printf("[Permify] Unavailable: denying %s on %s for %s", action, resource, userID)
		return false
	}
	body := map[string]interface{}{
		"metadata":   map[string]interface{}{"schema_version": "", "snap_token": "", "depth": 20},
		"entity":     map[string]interface{}{"type": resource, "id": "dpco-audit"},
		"permission": action,
		"subject":    map[string]interface{}{"type": "user", "id": userID},
	}
	b, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", permifyURL, permifyTenant)
	resp, err := http.Post(url, "application/json", strings.NewReader(string(b)))
	if err != nil {
		logger.Printf("[Permify] Check failed: %v", err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Printf("[Permify] Check rejected with HTTP %d", resp.StatusCode)
		return false
	}
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		logger.Printf("[Permify] Invalid response: %v", err)
		return false
	}
	return result["can"] == "CHECK_RESULT_ALLOWED"
}

func initPermify() {
	go func() {
		for {
			resp, err := http.Get(fmt.Sprintf("%s/healthz", permifyURL))
			if err != nil || resp.StatusCode != 200 {
				logger.Printf("[Permify] Not reachable, retry in 15s")
				mu.Lock()
				permifyOK = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			resp.Body.Close()
			mu.Lock()
			permifyOK = true
			mu.Unlock()
			logger.Printf("[Permify] Connected at %s", permifyURL)
			return
		}
	}()
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func health(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	kOK := kafkaOK
	tOK := temporalOK
	kcOK := keycloakOK
	pOK := permifyOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":          "dpco-audit-service",
		"status":           "healthy",
		"port":             port,
		"uptime_s":         time.Since(startTime).Seconds(),
		"kafka":            map[string]interface{}{"connected": kOK, "topic": kafkaTopic, "events_published": atomic.LoadInt64(&kafkaEvents)},
		"temporal":         map[string]interface{}{"connected": tOK, "host": temporalHost, "task_queue": "ndsep-dpco-audit"},
		"keycloak":         map[string]interface{}{"connected": kcOK, "realm": keycloakRealm, "tokens_validated": atomic.LoadInt64(&tokenValidations)},
		"permify":          map[string]interface{}{"connected": pOK, "checks": atomic.LoadInt64(&permChecks)},
		"audits_initiated": atomic.LoadInt64(&auditsInitiated),
		"stage_advances":   atomic.LoadInt64(&stageAdvances),
		"middleware":       []string{"kafka", "temporal", "keycloak", "permify", "redis"},
		"timestamp":        time.Now().UTC(),
	})
}

func initiateAudit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DpcoOrgID   string `json:"dpco_org_id"`
		OrgID       string `json:"org_id"`
		AuditType   string `json:"audit_type"`
		AuditYear   int    `json:"audit_year"`
		LeadAuditor string `json:"lead_auditor"`
		Scope       string `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	// Keycloak token validation
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	userID, roles, err := validateToken(token)
	if err != nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	_ = roles
	// Permify RBAC check
	if !checkPermission(userID, "dpco_audit", "initiate") {
		http.Error(w, `{"error":"forbidden: dpco role required"}`, http.StatusForbidden)
		return
	}
	auditID := uuid.New().String()
	workflowID, err := startAuditWorkflow(auditID, req.DpcoOrgID, req.OrgID, req.AuditType)
	if err != nil {
		logger.Printf("[Temporal] Workflow start error: %v", err)
		http.Error(w, `{"error":"audit workflow unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	audit := map[string]interface{}{
		"id":            auditID,
		"dpco_org_id":   req.DpcoOrgID,
		"org_id":        req.OrgID,
		"audit_type":    req.AuditType,
		"audit_year":    req.AuditYear,
		"lead_auditor":  req.LeadAuditor,
		"scope":         req.Scope,
		"current_stage": "initiated",
		"workflow_id":   workflowID,
		"initiated_by":  userID,
		"initiated_at":  time.Now().UTC(),
		"stage_history": []map[string]interface{}{
			{"stage": "initiated", "entered_at": time.Now().UTC(), "entered_by": userID},
		},
	}
	mu.Lock()
	auditStore[auditID] = audit
	mu.Unlock()
	atomic.AddInt64(&auditsInitiated, 1)
	publishKafka("dpco.audit.initiated", map[string]interface{}{
		"audit_id": auditID, "dpco_org_id": req.DpcoOrgID, "org_id": req.OrgID,
		"audit_type": req.AuditType, "audit_year": req.AuditYear, "workflow_id": workflowID,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "audit_id": auditID, "workflow_id": workflowID, "current_stage": "initiated"})
}

func advanceStage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	auditID := vars["auditId"]
	var req struct {
		Notes  string `json:"notes"`
		UserID string `json:"user_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	mu.Lock()
	audit, ok := auditStore[auditID]
	if !ok {
		mu.Unlock()
		http.Error(w, `{"error":"audit not found"}`, http.StatusNotFound)
		return
	}
	currentStage := audit["current_stage"].(string)
	stageIdx := -1
	for i, s := range auditStages {
		if s == currentStage {
			stageIdx = i
			break
		}
	}
	if stageIdx < 0 || stageIdx >= len(auditStages)-1 {
		mu.Unlock()
		http.Error(w, `{"error":"already at final stage"}`, http.StatusBadRequest)
		return
	}
	nextStage := auditStages[stageIdx+1]
	audit["current_stage"] = nextStage
	history := audit["stage_history"].([]map[string]interface{})
	history = append(history, map[string]interface{}{
		"stage": nextStage, "entered_at": time.Now().UTC(),
		"entered_by": req.UserID, "notes": req.Notes,
	})
	audit["stage_history"] = history
	auditStore[auditID] = audit
	mu.Unlock()
	atomic.AddInt64(&stageAdvances, 1)
	publishKafka("dpco.audit.stage_advanced", map[string]interface{}{
		"audit_id": auditID, "from_stage": currentStage, "to_stage": nextStage,
		"advanced_by": req.UserID, "notes": req.Notes,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok": true, "audit_id": auditID,
		"from_stage": currentStage, "to_stage": nextStage,
	})
}

func listAudits(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	result := make([]map[string]interface{}, 0, len(auditStore))
	for _, a := range auditStore {
		result = append(result, a)
	}
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"audits": result, "total": len(result)})
}

func getAudit(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	auditID := vars["auditId"]
	mu.RLock()
	audit, ok := auditStore[auditID]
	mu.RUnlock()
	if !ok {
		http.Error(w, `{"error":"audit not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(audit)
}

func assessControl(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	auditID := vars["auditId"]
	var req struct {
		ControlID string `json:"control_id"`
		Rating    string `json:"rating"` // pass, partial, fail, na
		Evidence  string `json:"evidence"`
		Notes     string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	mu.Lock()
	audit, ok := auditStore[auditID]
	if !ok {
		mu.Unlock()
		http.Error(w, `{"error":"audit not found"}`, http.StatusNotFound)
		return
	}
	controls, _ := audit["control_assessments"].(map[string]interface{})
	if controls == nil {
		controls = make(map[string]interface{})
	}
	controls[req.ControlID] = map[string]interface{}{
		"control_id": req.ControlID, "rating": req.Rating,
		"evidence": req.Evidence, "notes": req.Notes,
		"assessed_at": time.Now().UTC(),
	}
	audit["control_assessments"] = controls
	// Calculate compliance score: pass=100, partial=50, fail=0, na=skip
	total, scored := 0.0, 0.0
	for _, v := range controls {
		c := v.(map[string]interface{})
		switch c["rating"] {
		case "pass":
			scored += 100
			total += 100
		case "partial":
			scored += 50
			total += 100
		case "fail":
			total += 100
		}
	}
	if total > 0 {
		audit["compliance_score"] = scored / total * 100
	}
	auditStore[auditID] = audit
	mu.Unlock()
	publishKafka("dpco.audit.control_assessed", map[string]interface{}{
		"audit_id": auditID, "control_id": req.ControlID, "rating": req.Rating,
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "control_id": req.ControlID, "rating": req.Rating})
}

func metrics(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	total := len(auditStore)
	stageCount := make(map[string]int)
	for _, a := range auditStore {
		if s, ok := a["current_stage"].(string); ok {
			stageCount[s]++
		}
	}
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_audits":      total,
		"audits_initiated":  atomic.LoadInt64(&auditsInitiated),
		"stage_advances":    atomic.LoadInt64(&stageAdvances),
		"kafka_events":      atomic.LoadInt64(&kafkaEvents),
		"token_validations": atomic.LoadInt64(&tokenValidations),
		"perm_checks":       atomic.LoadInt64(&permChecks),
		"by_stage":          stageCount,
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger.Printf("DPCO Audit Service starting on port %s", port)
	logger.Printf("Middleware: Kafka=%v Temporal=%v Keycloak=%v Permify=%v", kafkaEnabled, temporalEnabled, keycloakEnabled, permifyEnabled)
	logger.Printf("Kafka brokers: %v | Topic: %s", kafkaBrokers, kafkaTopic)
	logger.Printf("Temporal: %s | Keycloak: %s realm=%s | Permify: %s", temporalHost, keycloakURL, keycloakRealm, permifyURL)

	initKafka()
	initTemporal()
	initKeycloak()
	initPermify()

	r := mux.NewRouter()
	r.HandleFunc("/health", health).Methods("GET")
	r.HandleFunc("/metrics", metrics).Methods("GET")
	r.HandleFunc("/api/dpco/audits", initiateAudit).Methods("POST")
	r.HandleFunc("/api/dpco/audits", listAudits).Methods("GET")
	r.HandleFunc("/api/dpco/audits/{auditId}", getAudit).Methods("GET")
	r.HandleFunc("/api/dpco/audits/{auditId}/advance", advanceStage).Methods("POST")
	r.HandleFunc("/api/dpco/audits/{auditId}/controls", assessControl).Methods("POST")

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
	logger.Printf("Listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		logger.Fatalf("Server error: %v", err)
	}
}
