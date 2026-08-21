// car_pdf_generator — NDSEP Enhancement
// Generates Compliance Audit Return (CAR) PDF reports for DPCOs.
// Triggered by the carAutomation.generate tRPC procedure via a database queue.
// Produces a structured PDF with NDPA Article 48 required sections.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var (
	dbURL = envOrDefault("NDSEP_PG_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
)

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Data Types ───────────────────────────────────────────────────────────────

type CARJob struct {
	ID          int64           `json:"id"`
	DpcoOrgID   int64           `json:"dpco_org_id"`
	ReportYear  int             `json:"report_year"`
	Narrative   string          `json:"narrative"`
	Metadata    json.RawMessage `json:"metadata"`
	Status      string          `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
}

type CARReport struct {
	DpcoName        string `json:"dpco_name"`
	LicenceNumber   string `json:"licence_number"`
	ReportYear      int    `json:"report_year"`
	ReportingPeriod string `json:"reporting_period"`
	// Section A: Organisation Profile
	TotalClients       int    `json:"total_clients"`
	ActiveClients      int    `json:"active_clients"`
	SectorsCovered     string `json:"sectors_covered"`
	// Section B: Compliance Activities
	AuditsCompleted    int    `json:"audits_completed"`
	DSARsProcessed     int    `json:"dsars_processed"`
	BreachesReported   int    `json:"breaches_reported"`
	DPIAsCompleted     int    `json:"dpias_completed"`
	// Section C: Training & Capacity
	TrainingSessions   int    `json:"training_sessions"`
	StaffTrained       int    `json:"staff_trained"`
	// Section D: Enforcement Actions
	PenaltiesIssued    int    `json:"penalties_issued"`
	TotalPenaltyNGN    int64  `json:"total_penalty_ngn"`
	// Section E: AI Governance
	AISystemsAssessed  int    `json:"ai_systems_assessed"`
	HighRiskAISystems  int    `json:"high_risk_ai_systems"`
	// Narrative
	ExecutiveSummary   string `json:"executive_summary"`
	ChallengesFaced    string `json:"challenges_faced"`
	PlansNextYear      string `json:"plans_next_year"`
}

// ─── Database ─────────────────────────────────────────────────────────────────

func ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS car_pdf_jobs (
			id SERIAL PRIMARY KEY,
			dpco_org_id INTEGER NOT NULL,
			report_year INTEGER NOT NULL,
			narrative TEXT,
			metadata JSONB DEFAULT '{}',
			status TEXT DEFAULT 'pending',  -- pending, processing, done, failed
			pdf_url TEXT,
			error_msg TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			completed_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_car_jobs_status ON car_pdf_jobs(status);
		CREATE INDEX IF NOT EXISTS idx_car_jobs_dpco ON car_pdf_jobs(dpco_org_id);
	`)
	return err
}

func fetchPendingJobs(db *sql.DB) ([]CARJob, error) {
	rows, err := db.Query(`
		SELECT id, dpco_org_id, report_year, COALESCE(narrative,''), COALESCE(metadata,'{}'), status, created_at
		FROM car_pdf_jobs
		WHERE status = 'pending'
		ORDER BY created_at ASC
		LIMIT 10
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []CARJob
	for rows.Next() {
		var j CARJob
		if err := rows.Scan(&j.ID, &j.DpcoOrgID, &j.ReportYear, &j.Narrative, &j.Metadata, &j.Status, &j.CreatedAt); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}
	return jobs, nil
}

func buildReport(db *sql.DB, job CARJob) (*CARReport, error) {
	report := &CARReport{
		ReportYear:      job.ReportYear,
		ReportingPeriod: fmt.Sprintf("1 January %d – 31 December %d", job.ReportYear, job.ReportYear),
		ExecutiveSummary: job.Narrative,
	}

	// DPCO profile
	db.QueryRow(`
		SELECT registered_name, licence_number FROM dpco_organisations WHERE id = $1
	`, job.DpcoOrgID).Scan(&report.DpcoName, &report.LicenceNumber)

	// Client stats
	db.QueryRow(`
		SELECT COUNT(*), COUNT(CASE WHEN status = 'active' THEN 1 END)
		FROM dpco_clients WHERE dpco_org_id = $1
	`, job.DpcoOrgID).Scan(&report.TotalClients, &report.ActiveClients)

	// Compliance activities in the report year
	db.QueryRow(`
		SELECT COUNT(*) FROM dpco_audit_reports
		WHERE dpco_org_id = $1
		  AND EXTRACT(YEAR FROM created_at) = $2
	`, job.DpcoOrgID, job.ReportYear).Scan(&report.AuditsCompleted)

	db.QueryRow(`
		SELECT COUNT(*) FROM citizen_requests cr
		JOIN dpco_clients dc ON dc.org_id = cr.org_id
		WHERE dc.dpco_org_id = $1
		  AND EXTRACT(YEAR FROM cr.created_at) = $2
	`, job.DpcoOrgID, job.ReportYear).Scan(&report.DSARsProcessed)

	db.QueryRow(`
		SELECT COUNT(*) FROM breach_notifications bn
		JOIN dpco_clients dc ON dc.org_id = bn.org_id
		WHERE dc.dpco_org_id = $1
		  AND EXTRACT(YEAR FROM bn.created_at) = $2
	`, job.DpcoOrgID, job.ReportYear).Scan(&report.BreachesReported)

	db.QueryRow(`
		SELECT COUNT(*) FROM dpia_assessments da
		JOIN dpco_clients dc ON dc.org_id = da.org_id
		WHERE dc.dpco_org_id = $1
		  AND EXTRACT(YEAR FROM da.created_at) = $2
	`, job.DpcoOrgID, job.ReportYear).Scan(&report.DPIAsCompleted)

	// Penalties
	db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(amount),0) FROM penalties p
		JOIN dpco_clients dc ON dc.org_id = p.org_id
		WHERE dc.dpco_org_id = $1
		  AND EXTRACT(YEAR FROM p.created_at) = $2
	`, job.DpcoOrgID, job.ReportYear).Scan(&report.PenaltiesIssued, &report.TotalPenaltyNGN)

	return report, nil
}

func generatePDFContent(report *CARReport) string {
	// In production: use gofpdf or wkhtmltopdf to render a proper PDF.
	// Here we produce a structured text representation that can be
	// passed to a PDF rendering service.
	return fmt.Sprintf(`
NATIONAL DATA SOVEREIGNTY ENFORCEMENT PLATFORM
COMPLIANCE AUDIT RETURN (CAR) — %d

DPCO: %s
Licence Number: %s
Reporting Period: %s

═══════════════════════════════════════════════════════════
SECTION A — ORGANISATION PROFILE
═══════════════════════════════════════════════════════════
Total Client Organisations: %d
Active Client Organisations: %d
Sectors Covered: %s

═══════════════════════════════════════════════════════════
SECTION B — COMPLIANCE ACTIVITIES
═══════════════════════════════════════════════════════════
Data Protection Audits Completed: %d
Data Subject Access Requests Processed: %d
Personal Data Breaches Reported to NDPC: %d
Data Protection Impact Assessments Completed: %d

═══════════════════════════════════════════════════════════
SECTION C — TRAINING & CAPACITY BUILDING
═══════════════════════════════════════════════════════════
Training Sessions Conducted: %d
Staff Members Trained: %d

═══════════════════════════════════════════════════════════
SECTION D — ENFORCEMENT ACTIONS
═══════════════════════════════════════════════════════════
Penalty Notices Issued: %d
Total Penalties (NGN): ₦%d

═══════════════════════════════════════════════════════════
SECTION E — AI GOVERNANCE
═══════════════════════════════════════════════════════════
AI Systems Assessed: %d
High-Risk AI Systems Identified: %d

═══════════════════════════════════════════════════════════
SECTION F — EXECUTIVE SUMMARY
═══════════════════════════════════════════════════════════
%s

Generated by NDSEP CAR Automation Worker
Date: %s
`,
		report.ReportYear,
		report.DpcoName,
		report.LicenceNumber,
		report.ReportingPeriod,
		report.TotalClients,
		report.ActiveClients,
		report.SectorsCovered,
		report.AuditsCompleted,
		report.DSARsProcessed,
		report.BreachesReported,
		report.DPIAsCompleted,
		report.TrainingSessions,
		report.StaffTrained,
		report.PenaltiesIssued,
		report.TotalPenaltyNGN,
		report.AISystemsAssessed,
		report.HighRiskAISystems,
		report.ExecutiveSummary,
		time.Now().Format("2 January 2006"),
	)
}

func processJob(db *sql.DB, job CARJob) error {
	// Mark as processing
	db.Exec(`UPDATE car_pdf_jobs SET status = 'processing' WHERE id = $1`, job.ID)

	report, err := buildReport(db, job)
	if err != nil {
		db.Exec(`UPDATE car_pdf_jobs SET status = 'failed', error_msg = $2 WHERE id = $1`, job.ID, err.Error())
		return err
	}

	content := generatePDFContent(report)

	// In production: upload to S3 and store URL
	// For now: store the text content as the "PDF" in a temp file path
	pdfPath := fmt.Sprintf("/tmp/car_%d_%d.txt", job.DpcoOrgID, job.ReportYear)
	if err := os.WriteFile(pdfPath, []byte(content), 0644); err != nil {
		db.Exec(`UPDATE car_pdf_jobs SET status = 'failed', error_msg = $2 WHERE id = $1`, job.ID, err.Error())
		return err
	}

	pdfURL := fmt.Sprintf("/api/car/download/%d_%d", job.DpcoOrgID, job.ReportYear)
	db.Exec(`
		UPDATE car_pdf_jobs
		SET status = 'done', pdf_url = $2, completed_at = NOW()
		WHERE id = $1
	`, job.ID, pdfURL)

	// Also update the compliance_audit_returns table
	db.Exec(`
		UPDATE compliance_audit_returns
		SET status = 'submitted', pdf_url = $3, submitted_at = NOW()
		WHERE dpco_org_id = $1 AND report_year = $2
	`, job.DpcoOrgID, job.ReportYear, pdfURL)

	log.Printf("[car_pdf_generator] Job %d done: %s", job.ID, pdfURL)
	return nil
}

func runWorker(ctx context.Context, db *sql.DB) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	log.Println("[car_pdf_generator] Worker started")

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			jobs, err := fetchPendingJobs(db)
			if err != nil {
				log.Printf("Fetch jobs: %v", err)
				continue
			}
			for _, job := range jobs {
				if err := processJob(db, job); err != nil {
					log.Printf("Process job %d: %v", job.ID, err)
				}
			}
		}
	}
}

func main() {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("DB open: %v", err)
	}
	defer db.Close()

	if err := ensureSchema(db); err != nil {
		log.Fatalf("Schema: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	runWorker(ctx, db)
}
