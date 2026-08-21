// NDSEP Kyverno + Privacera Policy Worker (Layer 3)
// Simulates Kyverno Kubernetes-native policy engine + Privacera unified data access governance
// Enforces admission control, data masking, and access governance across the platform
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
	PORT    = "8096"
	VERSION = "1.0.0"
)

var (
	mu      sync.RWMutex
	metrics = map[string]interface{}{
		"kyverno_policies_active":   0,
		"admission_requests":        0,
		"admission_blocked":         0,
		"admission_mutated":         0,
		"privacera_policies":        0,
		"data_access_governed":      0,
		"pii_masked":                0,
		"consent_checks":            0,
		"consent_violations":        0,
		"uptime_seconds":            0,
	}
	startTime = time.Now()
)

var KYVERNO_POLICIES = []string{
	"disallow-privileged-containers", "require-labels", "restrict-image-registries",
	"disallow-host-namespaces", "require-resource-limits", "verify-image-signatures",
	"restrict-node-ports", "disallow-latest-tag", "require-pod-probes",
	"data-sovereignty-namespace-policy",
}

var PRIVACERA_POLICIES = []string{
	"pii-masking-citizens", "financial-data-access", "health-records-governance",
	"cross-border-data-transfer", "consent-management", "right-to-erasure",
	"data-minimization", "purpose-limitation",
}

var NAMESPACES = []string{
	"ndsep-production", "ndsep-compliance", "ndsep-analytics",
	"data-lake", "kafka-cluster", "monitoring", "security",
}

var ORG_NAMES = []string{
	"National Bank of Finance", "Federal Ministry of Health",
	"Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
}

func getDB() (*sql.DB, error) {
	dbURL := os.Getenv("WORKER_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

func runKyvernoAdmission(db *sql.DB) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	mu.Lock()
	metrics["kyverno_policies_active"] = len(KYVERNO_POLICIES)
	mu.Unlock()

	for range ticker.C {
		policy := KYVERNO_POLICIES[rand.Intn(len(KYVERNO_POLICIES))]
		ns := NAMESPACES[rand.Intn(len(NAMESPACES))]
		action := []string{"ALLOW", "BLOCK", "MUTATE"}[rand.Intn(3)]

		mu.Lock()
		metrics["admission_requests"] = metrics["admission_requests"].(int) + 1
		switch action {
		case "BLOCK":
			metrics["admission_blocked"] = metrics["admission_blocked"].(int) + 1
		case "MUTATE":
			metrics["admission_mutated"] = metrics["admission_mutated"].(int) + 1
		}
		mu.Unlock()

		log.Printf("[NDSEP-Kyverno] [Admission] %s | policy=%s | ns=%s", action, policy, ns)

		if action == "BLOCK" {
			_, err := db.Exec(`
				INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
				VALUES ($1, $2, $3, $4, $5, NOW())`,
				"kyverno_admission_blocked",
				"kubernetes_resource",
				rand.Intn(100) + 1,
				1,
				fmt.Sprintf(`{"policy":"%s","namespace":"%s","action":"BLOCK"}`, policy, ns),
			)
			if err != nil {
				log.Printf("[Kyverno] Audit error: %v", err)
			}
		}
	}
}

func runPrivaceraGovernance(db *sql.DB) {
	ticker := time.NewTicker(7 * time.Second)
	defer ticker.Stop()

	mu.Lock()
	metrics["privacera_policies"] = len(PRIVACERA_POLICIES)
	mu.Unlock()

	for range ticker.C {
		policy := PRIVACERA_POLICIES[rand.Intn(len(PRIVACERA_POLICIES))]
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		piiMasked := rand.Intn(100) + 10
		consentCheck := rand.Float32() < 0.3
		consentViolation := consentCheck && rand.Float32() < 0.2

		mu.Lock()
		metrics["data_access_governed"] = metrics["data_access_governed"].(int) + 1
		metrics["pii_masked"] = metrics["pii_masked"].(int) + piiMasked
		if consentCheck {
			metrics["consent_checks"] = metrics["consent_checks"].(int) + 1
		}
		if consentViolation {
			metrics["consent_violations"] = metrics["consent_violations"].(int) + 1
		}
		mu.Unlock()

		log.Printf("[NDSEP-Kyverno] [Privacera] policy=%s | org=%s | pii_masked=%d | consent_ok=%v",
			policy, org, piiMasked, !consentViolation)

		if consentViolation {
			_, err := db.Exec(`
				INSERT INTO compliance_violations (organization_id, policy_id, title, description, severity, status, detected_at)
				SELECT o.id, p.id, $1, $2, $3, 'non_compliant', NOW()
				FROM organizations o, compliance_policies p
				WHERE o.name = $4
				LIMIT 1`,
				"Consent Management Violation",
				fmt.Sprintf("Privacera detected data processing without valid consent under policy: %s", policy),
				"high",
				org,
			)
			if err != nil {
				log.Printf("[Kyverno] Violation write error: %v", err)
			}
		}
	}
}

func runDataMinimizationEngine(db *sql.DB) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		fieldsMinimized := rand.Intn(50) + 5
		org := ORG_NAMES[rand.Intn(len(ORG_NAMES))]
		log.Printf("[NDSEP-Kyverno] [DataMin] Minimized %d fields for %s (GDPR Art.5 compliance)", fieldsMinimized, org)
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
		"service": "kyverno-policy",
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
	log.Printf("[NDSEP-Kyverno] === NDSEP Kyverno + Privacera Policy Worker (Go) ===")
	log.Printf("[NDSEP-Kyverno] Version: %s | Port: %s", VERSION, PORT)

	db, err := getDB()
	if err != nil {
		log.Fatalf("[Kyverno] DB connection failed: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("[Kyverno] DB ping failed: %v", err)
	}
	log.Printf("[NDSEP-Kyverno] [DB] Connected to PostgreSQL")

	go runUptimeTracker()
	go runKyvernoAdmission(db)
	go runPrivaceraGovernance(db)
	go runDataMinimizationEngine(db)

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/metrics", metricsHandler)

	log.Printf("[NDSEP-Kyverno] [Policy] Kyverno + Privacera worker listening on :%s", PORT)
	if err := http.ListenAndServe(":"+PORT, nil); err != nil {
		log.Fatalf("[Kyverno] Server error: %v", err)
	}
}
