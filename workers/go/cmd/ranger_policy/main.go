// NDSEP Apache Ranger Policy Worker (Layer 3)
// Simulates Apache Ranger centralized security administration for Hadoop/Kafka
// Manages data access policies, row-level security, column masking, and audit trails
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
	"context"
	"os/signal"
	"syscall"

	_ "github.com/lib/pq"
)

const (
	PORT    = "8095"
	VERSION = "1.0.0"
)

var (
	mu      sync.RWMutex
	metrics = map[string]interface{}{
		"policies_active":       0,
		"access_requests":       0,
		"access_denied":         0,
		"access_granted":        0,
		"column_masks_applied":  0,
		"row_filters_applied":   0,
		"kafka_policies":        0,
		"hdfs_policies":         0,
		"hive_policies":         0,
		"audit_events":          0,
		"uptime_seconds":        0,
	}
	startTime = time.Now()
)

var RANGER_SERVICES = []string{"hdfs", "hive", "kafka", "hbase", "yarn", "storm", "atlas", "nifi"}
var POLICY_TYPES = []string{"allow", "deny", "row_filter", "column_mask", "tag_based"}
var DATA_CLASSIFICATIONS = []string{"top_secret", "secret", "confidential", "restricted", "public"}
var ORG_NAMES = []string{
	"National Bank of Finance", "Federal Ministry of Health",
	"Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
}
var USERS = []string{"analyst_01", "admin_sys", "data_engineer", "compliance_officer", "auditor_01"}

func getDB() (*sql.DB, error) {
	dbURL := os.Getenv("WORKER_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

func runPolicyEnforcer(db *sql.DB) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	policiesActive := rand.Intn(50) + 20

	mu.Lock()
	metrics["policies_active"] = policiesActive
	metrics["kafka_policies"] = rand.Intn(15) + 5
	metrics["hdfs_policies"] = rand.Intn(20) + 10
	metrics["hive_policies"] = rand.Intn(15) + 5
	mu.Unlock()

	for range ticker.C {
		service := RANGER_SERVICES[rand.Intn(len(RANGER_SERVICES))]
		policyType := POLICY_TYPES[rand.Intn(len(POLICY_TYPES))]
		user := USERS[rand.Intn(len(USERS))]
		classification := DATA_CLASSIFICATIONS[rand.Intn(len(DATA_CLASSIFICATIONS))]
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		isDenied := rand.Float32() < 0.25

		mu.Lock()
		metrics["access_requests"] = metrics["access_requests"].(int) + 1
		metrics["audit_events"] = metrics["audit_events"].(int) + 1
		if isDenied {
			metrics["access_denied"] = metrics["access_denied"].(int) + 1
		} else {
			metrics["access_granted"] = metrics["access_granted"].(int) + 1
		}
		if policyType == "column_mask" {
			metrics["column_masks_applied"] = metrics["column_masks_applied"].(int) + 1
		}
		if policyType == "row_filter" {
			metrics["row_filters_applied"] = metrics["row_filters_applied"].(int) + 1
		}
		mu.Unlock()

		action := "GRANTED"
		if isDenied {
			action = "DENIED"
		}

		log.Printf("[NDSEP-Ranger] [Policy] %s | %s | user=%s | service=%s | class=%s | org=%s",
			action, policyType, user, service, classification, org)

		// Write audit log
		_, err := db.Exec(`
			INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
			VALUES ($1, $2, $3, $4, $5, NOW())`,
			fmt.Sprintf("ranger_%s_%s", service, action),
			"ranger_policy",
			rand.Intn(100) + 1,
			1,
			fmt.Sprintf(`{"service":"%s","policy_type":"%s","user":"%s","classification":"%s","org":"%s","result":"%s"}`,
				service, policyType, user, classification, org, action),
		)
		if err != nil {
			log.Printf("[Ranger] Audit log error: %v", err)
		}

		// Write compliance violation if denied critical access
		if isDenied && (classification == "top_secret" || classification == "secret") {
			_, err = db.Exec(`
				INSERT INTO compliance_violations (organization_id, policy_id, title, description, severity, status, detected_at)
				SELECT o.id, p.id, $1, $2, $3, 'non_compliant', NOW()
				FROM organizations o, compliance_policies p
				WHERE o.name = $4
				LIMIT 1`,
				"Unauthorized Data Access Attempt",
				fmt.Sprintf("Apache Ranger blocked unauthorized access to %s data by user %s on %s service", classification, user, service),
				"high",
				org,
			)
			if err != nil {
				log.Printf("[Ranger] Violation write error: %v", err)
			}
		}
	}
}

func runKafkaACLManager(db *sql.DB) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		topicCount := rand.Intn(20) + 5
		aclCount := rand.Intn(50) + 10
		log.Printf("[NDSEP-Ranger] [Kafka] ACL audit: %d topics, %d ACL entries enforced", topicCount, aclCount)
		mu.Lock()
		metrics["kafka_policies"] = aclCount
		mu.Unlock()
	}
}

func runColumnMaskingEngine(db *sql.DB) {
	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		maskedCols := rand.Intn(10) + 1
		table := []string{"citizens_pii", "financial_records", "health_data", "tax_records"}[rand.Intn(4)]
		log.Printf("[NDSEP-Ranger] [Masking] Applied %d column masks on table %s", maskedCols, table)
		mu.Lock()
		metrics["column_masks_applied"] = metrics["column_masks_applied"].(int) + maskedCols
		mu.Unlock()
	}
}

func runUptimeTracker() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		mu.Lock()
		metrics["uptime_seconds"] = int(time.Since(startTime).Seconds())
		mu.Unlock()
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "ranger-policy",
		"version": VERSION,
		"layer":   "L3",
		"lang":    "Go",
		"metrics": metrics,
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// gracefulShutdown wraps http.Server with SIGTERM/SIGINT handling
func gracefulShutdown(workerID, port string, handler http.Handler) {
srv := &http.Server{
Addr:         ":" + port,
Handler:      handler,
ReadTimeout:  15 * time.Second,
WriteTimeout: 30 * time.Second,
IdleTimeout:  60 * time.Second,
}
quit := make(chan os.Signal, 1)
signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
go func() {
log.Printf("[%s] HTTP server listening on :%s", workerID, port)
if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
log.Fatalf("[%s] Server error: %v", workerID, err)
}
}()
sig := <-quit
log.Printf("[%s] Received %s — shutting down gracefully", workerID, sig)
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil {
log.Printf("[%s] Forced shutdown: %v", workerID, err)
}
log.Printf("[%s] Shutdown complete", workerID)
}

func main() {
	log.SetFlags(log.LstdFlags)
	log.Printf("[NDSEP-Ranger] === NDSEP Apache Ranger Policy Worker (Go) ===")
	log.Printf("[NDSEP-Ranger] Version: %s | Port: %s", VERSION, PORT)

	db, err := getDB()
	if err != nil {
		log.Fatalf("[Ranger] DB connection failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("[Ranger] DB ping failed: %v", err)
	}
	log.Printf("[NDSEP-Ranger] [DB] Connected to PostgreSQL")

	go runUptimeTracker()
	go runPolicyEnforcer(db)
	go runKafkaACLManager(db)
	go runColumnMaskingEngine(db)

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/metrics", metricsHandler)

	log.Printf("[NDSEP-Ranger] [Policy] Apache Ranger worker listening on :%s", PORT)
	if err := http.ListenAndServe(":"+PORT, nil); err != nil {
		log.Fatalf("[Ranger] Server error: %v", err)
	}
}
