// NDSEP Policy-as-Code Evaluator Worker (Go)
// ============================================
// Evaluates JSON DSL policy rules against organization data.
// Runs every 5 minutes, evaluating all active policy templates.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"context"
	"os/signal"
	"syscall"
	_ "github.com/lib/pq"
)

const (
	workerID     = "policy-evaluator"
	listenPort   = ":8110"
	evalInterval = 5 * time.Minute
)

var (
	db                *sql.DB
	evalCount         int64
	lastEvalAt        time.Time
	violationsCreated int64
)

type PolicyRule struct {
	Field    string      `json:"field"`
	Operator string      `json:"operator"`
	Value    interface{} `json:"value"`
}

type PolicyDefinition struct {
	Rules []PolicyRule `json:"rules"`
	Logic string       `json:"logic"`
}

type OrgState struct {
	ID              int
	Name            string
	ComplianceScore float64
	RiskScore       float64
	AgentInstalled  bool
	AssetCount      int
}

func evaluateRule(rule PolicyRule, org OrgState) bool {
	var fieldVal float64
	switch rule.Field {
	case "compliance_score":
		fieldVal = org.ComplianceScore
	case "risk_score":
		fieldVal = org.RiskScore
	case "asset_count":
		fieldVal = float64(org.AssetCount)
	default:
		return false
	}
	rv, ok := rule.Value.(float64)
	if !ok {
		return false
	}
	switch rule.Operator {
	case "lt":
		return fieldVal < rv
	case "gt":
		return fieldVal > rv
	case "lte":
		return fieldVal <= rv
	case "gte":
		return fieldVal >= rv
	case "eq":
		return fieldVal == rv
	}
	return false
}

func runEvaluation() {
	if db == nil {
		return
	}
	rows, err := db.Query(`SELECT id, name, framework, policy_definition FROM policy_templates WHERE status = 'active'`)
	if err != nil {
		return
	}
	defer rows.Close()

	type Tmpl struct {
		ID, Name, Framework, Def string
	}
	var templates []Tmpl
	for rows.Next() {
		var t Tmpl
		rows.Scan(&t.ID, &t.Name, &t.Framework, &t.Def)
		templates = append(templates, t)
	}

	orgRows, err := db.Query(`SELECT id, name, compliance_score, risk_score, agent_installed, declared_asset_count FROM organizations`)
	if err != nil {
		return
	}
	defer orgRows.Close()

	var orgs []OrgState
	for orgRows.Next() {
		var o OrgState
		orgRows.Scan(&o.ID, &o.Name, &o.ComplianceScore, &o.RiskScore, &o.AgentInstalled, &o.AssetCount)
		orgs = append(orgs, o)
	}

	newViolations := 0
	for _, tmpl := range templates {
		var def PolicyDefinition
		if err := json.Unmarshal([]byte(tmpl.Def), &def); err != nil {
			continue
		}
		for _, org := range orgs {
			violated := false
			for _, rule := range def.Rules {
				if evaluateRule(rule, org) {
					violated = true
					break
				}
			}
			if violated {
				var count int
				db.QueryRow(`SELECT COUNT(*) FROM compliance_violations WHERE organization_id = $1 AND title = $2 AND status != 'compliant'`,
					org.ID, fmt.Sprintf("Policy: %s", tmpl.Name)).Scan(&count)
				if count == 0 {
					db.Exec(`INSERT INTO compliance_violations (organization_id, title, description, severity, status, enforcement_status, detected_at, created_at) VALUES ($1,$2,$3,'medium','non_compliant','pending',NOW(),NOW())`,
						org.ID, fmt.Sprintf("Policy: %s", tmpl.Name),
						fmt.Sprintf("[%s] %s violation for %s", tmpl.Framework, tmpl.Name, org.Name))
					newViolations++
					violationsCreated++
				}
			}
		}
	}
	evalCount++
	lastEvalAt = time.Now()
	if newViolations > 0 {
		log.Printf("[%s] %d new violations created", workerID, newViolations)
	}
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
	log.Printf("[%s] Starting on %s", workerID, listenPort)
	dbURL := os.Getenv("WORKER_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err == nil {
		if err = db.Ping(); err != nil {
			log.Printf("[%s] DB ping failed: %v", workerID, err)
			db = nil
		} else {
			log.Printf("[%s] Connected to PostgreSQL", workerID)
		}
	}

	go runEvaluation()
	go func() {
		t := time.NewTicker(evalInterval)
		defer t.Stop()
		for range t.C {
			runEvaluation()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok", "worker": workerID,
			"eval_count": evalCount, "violations_created": violationsCreated,
		})
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"eval_count": evalCount, "violations_created": violationsCreated,
			"last_eval_at": lastEvalAt.Unix(),
		})
	})
	log.Fatal(http.ListenAndServe(listenPort, mux))
}
