// NDSEP Citizen Request SLA Tracker (Go)
// ========================================
// Runs every hour to:
//   1. Find citizen_requests older than 30 days without a response
//   2. Update their status to 'overdue'
//   3. Insert a sla_breach record for each overdue request
//   4. Notify the platform owner via the Forge notification API
//   5. Expose /health and /metrics endpoints for monitoring
//
// SLA rules (NDPA Section 34):
//   - Access requests:      30 days
//   - Erasure requests:     30 days
//   - Portability requests: 30 days
//   - Rectification:        30 days
//   - Objection:            30 days
//   - Restriction:          30 days

package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

const (
	defaultPort   = "8130"
	slaWindowDays = 30
	checkInterval = 1 * time.Hour
)

var (
	pgDSN         = getEnv("WORKER_DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	forgeAPIURL   = getEnv("BUILT_IN_FORGE_API_URL", "")
	forgeAPIKey   = getEnv("BUILT_IN_FORGE_API_KEY", "")
	ownerOpenID   = getEnv("OWNER_OPEN_ID", "")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
var metrics = struct {
	LastRunAt      time.Time
	LastRunMarked  int
	TotalMarked    int
	TotalBreaches  int
	Errors         int
}{}

// ─── DB helpers ───────────────────────────────────────────────────────────────
func openDB() (*sql.DB, error) {
	db, err := sql.Open("postgres", pgDSN)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}

// ─── Notification helper ──────────────────────────────────────────────────────
func notifyOwner(title, content string) {
	if forgeAPIURL == "" || forgeAPIKey == "" || ownerOpenID == "" {
		log.Printf("[citizen-sla-tracker] Notification skipped (FORGE env not set): %s", title)
		return
	}
	payload := map[string]interface{}{
		"user_open_id": ownerOpenID,
		"title":        title,
		"content":      content,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", forgeAPIURL+"/v1/notifications/push", bytes.NewReader(body))
	if err != nil {
		log.Printf("[citizen-sla-tracker] Notification request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+forgeAPIKey)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[citizen-sla-tracker] Notification send error: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[citizen-sla-tracker] Notification sent: %s (status %d)", title, resp.StatusCode)
}

// ─── Core SLA check ───────────────────────────────────────────────────────────
func runSLACheck() {
	log.Println("[citizen-sla-tracker] Running SLA check...")
	db, err := openDB()
	if err != nil {
		log.Printf("[citizen-sla-tracker] DB connection error: %v", err)
		metrics.Errors++
		return
	}
	defer db.Close()

	// 1. Find requests that are overdue (submitted > 30 days ago, not completed/cancelled/overdue)
	rows, err := db.Query(`
		SELECT id, citizen_name, citizen_email, request_type, organization_id,
		       submitted_at,
		       EXTRACT(EPOCH FROM (NOW() - submitted_at)) / 86400 AS days_elapsed
		FROM citizen_requests
		WHERE status NOT IN ('completed', 'cancelled', 'overdue')
		  AND submitted_at < NOW() - INTERVAL '30 days'
	`)
	if err != nil {
		log.Printf("[citizen-sla-tracker] Query error: %v", err)
		metrics.Errors++
		return
	}
	defer rows.Close()

	type OverdueRequest struct {
		ID             int
		CitizenName    string
		CitizenEmail   string
		RequestType    string
		OrganizationID sql.NullInt64
		SubmittedAt    time.Time
		DaysElapsed    float64
	}

	var overdueRequests []OverdueRequest
	for rows.Next() {
		var r OverdueRequest
		if err := rows.Scan(&r.ID, &r.CitizenName, &r.CitizenEmail, &r.RequestType,
			&r.OrganizationID, &r.SubmittedAt, &r.DaysElapsed); err != nil {
			log.Printf("[citizen-sla-tracker] Row scan error: %v", err)
			continue
		}
		overdueRequests = append(overdueRequests, r)
	}

	if len(overdueRequests) == 0 {
		log.Println("[citizen-sla-tracker] No overdue citizen requests found.")
		metrics.LastRunAt = time.Now()
		metrics.LastRunMarked = 0
		return
	}

	marked := 0
	breachesInserted := 0

	for _, r := range overdueRequests {
		// 2. Update status to 'overdue'
		_, err := db.Exec(`
			UPDATE citizen_requests
			SET status = 'overdue', updated_at = NOW()
			WHERE id = $1
		`, r.ID)
		if err != nil {
			log.Printf("[citizen-sla-tracker] Failed to update request %d: %v", r.ID, err)
			metrics.Errors++
			continue
		}
		marked++

		// 3. Insert SLA breach record
		orgID := sql.NullInt64{Valid: false}
		if r.OrganizationID.Valid {
			orgID = r.OrganizationID
		}

		_, err = db.Exec(`
			INSERT INTO sla_breaches (organization_id, sla_type, threshold, actual, severity, status, notes, detected_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			ON CONFLICT DO NOTHING
		`,
			func() interface{} {
				if orgID.Valid {
					return orgID.Int64
				}
				return 1 // default to org 1 if no org assigned
			}(),
			"citizen_request_response_time",
			float64(slaWindowDays),
			r.DaysElapsed,
			func() string {
				if r.DaysElapsed > 60 {
					return "critical"
				} else if r.DaysElapsed > 45 {
					return "high"
				}
				return "medium"
			}(),
			"open",
			fmt.Sprintf("Citizen %s request (ID %d) from %s overdue by %.0f days. Type: %s",
				r.RequestType, r.ID, r.CitizenName, r.DaysElapsed-float64(slaWindowDays), r.RequestType),
		)
		if err != nil {
			log.Printf("[citizen-sla-tracker] Failed to insert SLA breach for request %d: %v", r.ID, err)
		} else {
			breachesInserted++
		}
	}

	metrics.LastRunAt = time.Now()
	metrics.LastRunMarked = marked
	metrics.TotalMarked += marked
	metrics.TotalBreaches += breachesInserted

	log.Printf("[citizen-sla-tracker] Marked %d requests as overdue, inserted %d SLA breaches.", marked, breachesInserted)

	// 4. Notify owner if any breaches found
	if marked > 0 {
		notifyOwner(
			"⚠️ Citizen Request SLA Breaches Detected",
			fmt.Sprintf("%d citizen request(s) have exceeded the 30-day NDPA Section 34 response SLA and have been marked overdue. %d SLA breach records created. Immediate review required.", marked, breachesInserted),
		)
	}
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────
func healthHandler(w http.ResponseWriter, r *http.Request) {
	db, err := openDB()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "healthy",
		"service":        "citizen-sla-tracker",
		"last_run_at":    metrics.LastRunAt,
		"last_run_marked": metrics.LastRunMarked,
		"total_marked":   metrics.TotalMarked,
		"total_breaches": metrics.TotalBreaches,
		"errors":         metrics.Errors,
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP ndsep_citizen_sla_marked_total Total citizen requests marked overdue\n")
	fmt.Fprintf(w, "# TYPE ndsep_citizen_sla_marked_total counter\n")
	fmt.Fprintf(w, "ndsep_citizen_sla_marked_total %d\n", metrics.TotalMarked)
	fmt.Fprintf(w, "# HELP ndsep_citizen_sla_breaches_total Total SLA breach records inserted\n")
	fmt.Fprintf(w, "# TYPE ndsep_citizen_sla_breaches_total counter\n")
	fmt.Fprintf(w, "ndsep_citizen_sla_breaches_total %d\n", metrics.TotalBreaches)
	fmt.Fprintf(w, "# HELP ndsep_citizen_sla_errors_total Total errors in SLA check runs\n")
	fmt.Fprintf(w, "# TYPE ndsep_citizen_sla_errors_total counter\n")
	fmt.Fprintf(w, "ndsep_citizen_sla_errors_total %d\n", metrics.Errors)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
func main() {
	port := getEnv("PORT", defaultPort)
	log.Printf("[citizen-sla-tracker] Starting on port %s (SLA window: %d days, check interval: %s)",
		port, slaWindowDays, checkInterval)

	// Run immediately on startup
	go runSLACheck()

	// Schedule recurring checks
	go func() {
		ticker := time.NewTicker(checkInterval)
		defer ticker.Stop()
		for range ticker.C {
			runSLACheck()
		}
	}()

	// HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/run", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		go runSLACheck()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "triggered"})
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
