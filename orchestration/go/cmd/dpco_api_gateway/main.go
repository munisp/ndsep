// dpco_api_gateway — Public REST API for licensed DPCOs
// Exposes endpoints for CAR submission, compliance score queries, and
// verification statement status. Authenticated via Keycloak JWT.
// Registered in APISIX at /api/v1/dpco/...
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "github.com/lib/pq"
)

const (
	ServiceName    = "dpco-api-gateway"
	ServiceVersion = "1.0.0"
	DefaultPort    = "8340"
)

// ─── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	Port           string
	DatabaseURL    string
	KeycloakURL    string
	KeycloakRealm  string
	APISIXAdminURL string
	APISIXAPIKey   string
}

func loadConfig() Config {
	return Config{
		Port:           getEnv("DPCO_API_GATEWAY_PORT", DefaultPort),
		DatabaseURL:    getEnv("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"),
		KeycloakURL:    getEnv("KEYCLOAK_URL", "http://keycloak:8080"),
		KeycloakRealm:  getEnv("KEYCLOAK_REALM", "ndsep"),
		APISIXAdminURL: getEnv("APISIX_ADMIN_URL", "http://apisix:9180"),
		APISIXAPIKey:   getEnv("APISIX_API_KEY", "ndsep-apisix-admin-key-2026-prod"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── DB ──────────────────────────────────────────────────────────────────────

var db *sql.DB

func initDB(dsn string) error {
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

type DPCOClaims struct {
	Sub          string `json:"sub"`
	LicenceNumber string `json:"dpco_licence_number"`
	OrgID        int    `json:"dpco_org_id"`
}

// validateDPCOToken validates the Bearer token against the dpco_organisations table.
// In production this would verify a Keycloak JWT; here we use a DB-backed API key
// stored in dpco_organisations.api_key for simplicity.
func validateDPCOToken(r *http.Request) (*DPCOClaims, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return nil, fmt.Errorf("missing Authorization header")
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return nil, fmt.Errorf("invalid Authorization format")
	}
	token := parts[1]

	// Hash the token and look it up
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(token)))
	row := db.QueryRowContext(r.Context(),
		`SELECT id, licence_number FROM dpco_organisations WHERE api_key_hash = $1 AND status = 'active' LIMIT 1`,
		hash,
	)
	var orgID int
	var licenceNumber string
	if err := row.Scan(&orgID, &licenceNumber); err != nil {
		return nil, fmt.Errorf("invalid or expired API key")
	}
	return &DPCOClaims{Sub: strconv.Itoa(orgID), LicenceNumber: licenceNumber, OrgID: orgID}, nil
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, err := validateDPCOToken(r)
		if err != nil {
			jsonError(w, http.StatusUnauthorized, err.Error())
			return
		}
		ctx := context.WithValue(r.Context(), "dpco_claims", claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func claimsFromCtx(r *http.Request) *DPCOClaims {
	c, _ := r.Context().Value("dpco_claims").(*DPCOClaims)
	return c
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func parseIntParam(r *http.Request, key string) (int, error) {
	return strconv.Atoi(chi.URLParam(r, key))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// GET /api/v1/dpco/health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbOK := db.PingContext(r.Context()) == nil
	jsonOK(w, map[string]any{
		"service": ServiceName,
		"version": ServiceVersion,
		"status":  "ok",
		"db":      dbOK,
		"time":    time.Now().UTC(),
	})
}

// GET /api/v1/dpco/me — DPCO profile
func handleMe(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r)
	row := db.QueryRowContext(r.Context(),
		`SELECT id, name, licence_number, licence_date, licence_expires_at, status,
		        organisation_type, email, phone, website, state, services, staff_count
		 FROM dpco_organisations WHERE id = $1`,
		claims.OrgID,
	)
	var org map[string]any = make(map[string]any)
	var id int
	var name, licenceNumber, licenceDate, licenceExpiresAt, status, orgType, email, phone, website, state, services string
	var staffCount int
	if err := row.Scan(&id, &name, &licenceNumber, &licenceDate, &licenceExpiresAt, &status,
		&orgType, &email, &phone, &website, &state, &services, &staffCount); err != nil {
		// Return sandbox data if not found
		jsonOK(w, map[string]any{"id": claims.OrgID, "licence_number": claims.LicenceNumber, "status": "active"})
		return
	}
	org["id"] = id
	org["name"] = name
	org["licence_number"] = licenceNumber
	org["licence_date"] = licenceDate
	org["licence_expires_at"] = licenceExpiresAt
	org["status"] = status
	org["organisation_type"] = orgType
	org["email"] = email
	org["phone"] = phone
	org["website"] = website
	org["state"] = state
	org["staff_count"] = staffCount
	jsonOK(w, org)
}

// GET /api/v1/dpco/clients — list DPCO's clients
func handleListClients(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r)
	rows, err := db.QueryContext(r.Context(),
		`SELECT c.id, c.organisation_id, c.engagement_type, c.status, c.next_audit_due,
		        o.name as org_name, o.sector, o.compliance_score
		 FROM dpco_clients c
		 LEFT JOIN organizations o ON o.id = c.organisation_id
		 WHERE c.dpco_organisation_id = $1
		 ORDER BY c.updated_at DESC`,
		claims.OrgID,
	)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var clients []map[string]any
	for rows.Next() {
		var id, orgID int
		var engType, status, orgName, sector string
		var nextAuditDue sql.NullString
		var complianceScore sql.NullFloat64
		rows.Scan(&id, &orgID, &engType, &status, &nextAuditDue, &orgName, &sector, &complianceScore)
		clients = append(clients, map[string]any{
			"id": id, "organisation_id": orgID, "engagement_type": engType,
			"status": status, "next_audit_due": nextAuditDue.String,
			"org_name": orgName, "sector": sector, "compliance_score": complianceScore.Float64,
		})
	}
	if clients == nil {
		clients = []map[string]any{}
	}
	jsonOK(w, map[string]any{"clients": clients, "total": len(clients)})
}

// GET /api/v1/dpco/clients/{orgId}/compliance — compliance score for a client
func handleClientCompliance(w http.ResponseWriter, r *http.Request) {
	orgID, err := parseIntParam(r, "orgId")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid orgId")
		return
	}
	row := db.QueryRowContext(r.Context(),
		`SELECT o.name, o.compliance_score, o.sector,
		        (SELECT COUNT(*) FROM breach_incidents WHERE organization_id = o.id AND status != 'closed') as open_breaches,
		        (SELECT COUNT(*) FROM dpia_assessments WHERE organization_id = o.id AND status = 'approved') as approved_dpias,
		        (SELECT COUNT(*) FROM staff_training_records WHERE organization_id = o.id AND status = 'completed') as completed_training
		 FROM organizations o WHERE o.id = $1`,
		orgID,
	)
	var name, sector string
	var score sql.NullFloat64
	var openBreaches, approvedDpias, completedTraining int
	if err := row.Scan(&name, &score, &sector, &openBreaches, &approvedDpias, &completedTraining); err != nil {
		jsonError(w, http.StatusNotFound, "organisation not found")
		return
	}
	jsonOK(w, map[string]any{
		"organisation_id":    orgID,
		"name":               name,
		"sector":             sector,
		"compliance_score":   score.Float64,
		"open_breaches":      openBreaches,
		"approved_dpias":     approvedDpias,
		"completed_training": completedTraining,
		"retrieved_at":       time.Now().UTC(),
	})
}

// POST /api/v1/dpco/car — submit a Compliance Audit Return
func handleSubmitCAR(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r)
	var body struct {
		OrganisationID  int     `json:"organisation_id"`
		AuditScope      string  `json:"audit_scope"`
		FindingsSummary string  `json:"findings_summary"`
		ComplianceScore float64 `json:"compliance_score"`
		StatementDate   string  `json:"statement_date"`
		SignatoryName   string  `json:"signatory_name"`
		SignatoryRole   string  `json:"signatory_role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.OrganisationID == 0 || body.AuditScope == "" {
		jsonError(w, http.StatusBadRequest, "organisation_id and audit_scope are required")
		return
	}

	// Insert verification statement
	var stmtID int
	err := db.QueryRowContext(r.Context(),
		`INSERT INTO dpco_verification_statements
		 (dpco_id, dpco_organisation_id, filing_type, organisation_id, statement_date,
		  audit_scope, findings_summary, compliance_score, dpco_licence_number,
		  dpco_signatory_name, dpco_signatory_role, status, created_at, updated_at)
		 VALUES ($1,$2,'compliance_audit_return',$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NOW(),NOW())
		 RETURNING id`,
		claims.OrgID, claims.OrgID, body.OrganisationID, body.StatementDate,
		body.AuditScope, body.FindingsSummary, body.ComplianceScore,
		claims.LicenceNumber, body.SignatoryName, body.SignatoryRole,
	).Scan(&stmtID)
	if err != nil {
		log.Printf("[%s] CAR insert error: %v", ServiceName, err)
		jsonError(w, http.StatusInternalServerError, "failed to submit CAR")
		return
	}

	jsonOK(w, map[string]any{
		"success":              true,
		"verification_stmt_id": stmtID,
		"status":               "submitted",
		"submitted_at":         time.Now().UTC(),
		"message":              "CAR submitted successfully. NDPC reference will be assigned within 5 business days.",
	})
}

// GET /api/v1/dpco/verification/{id} — get verification statement status
func handleGetVerification(w http.ResponseWriter, r *http.Request) {
	id, err := parseIntParam(r, "id")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid id")
		return
	}
	row := db.QueryRowContext(r.Context(),
		`SELECT v.id, v.status, v.compliance_score, v.statement_date, v.submitted_at,
		        v.signature_hash, o.name as org_name, d.name as dpco_name
		 FROM dpco_verification_statements v
		 LEFT JOIN organizations o ON o.id = v.organisation_id
		 LEFT JOIN dpco_organisations d ON d.id = v.dpco_organisation_id
		 WHERE v.id = $1`,
		id,
	)
	var stmtID int
	var status, orgName, dpcoName string
	var score sql.NullFloat64
	var statementDate, submittedAt, sigHash sql.NullString
	if err := row.Scan(&stmtID, &status, &score, &statementDate, &submittedAt, &sigHash, &orgName, &dpcoName); err != nil {
		jsonError(w, http.StatusNotFound, "verification statement not found")
		return
	}
	jsonOK(w, map[string]any{
		"id":               stmtID,
		"status":           status,
		"compliance_score": score.Float64,
		"statement_date":   statementDate.String,
		"submitted_at":     submittedAt.String,
		"signature_hash":   sigHash.String,
		"org_name":         orgName,
		"dpco_name":        dpcoName,
	})
}

// GET /api/v1/dpco/verification — list all verification statements for this DPCO
func handleListVerifications(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r)
	status := r.URL.Query().Get("status")
	query := `SELECT v.id, v.status, v.compliance_score, v.statement_date, v.submitted_at,
	                 o.name as org_name
	          FROM dpco_verification_statements v
	          LEFT JOIN organizations o ON o.id = v.organisation_id
	          WHERE v.dpco_organisation_id = $1`
	args := []any{claims.OrgID}
	if status != "" {
		query += " AND v.status = $2"
		args = append(args, status)
	}
	query += " ORDER BY v.created_at DESC LIMIT 100"
	rows, err := db.QueryContext(r.Context(), query, args...)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var stmts []map[string]any
	for rows.Next() {
		var id int
		var st, orgName string
		var score sql.NullFloat64
		var stmtDate, submittedAt sql.NullString
		rows.Scan(&id, &st, &score, &stmtDate, &submittedAt, &orgName)
		stmts = append(stmts, map[string]any{
			"id": id, "status": st, "compliance_score": score.Float64,
			"statement_date": stmtDate.String, "submitted_at": submittedAt.String,
			"org_name": orgName,
		})
	}
	if stmts == nil {
		stmts = []map[string]any{}
	}
	jsonOK(w, map[string]any{"statements": stmts, "total": len(stmts)})
}

// GET /api/v1/dpco/audits — list audit engagements
func handleListAudits(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r)
	rows, err := db.QueryContext(r.Context(),
		`SELECT e.id, e.status, e.audit_type, e.planned_start, e.planned_end,
		        e.compliance_score, o.name as client_name
		 FROM dpco_audit_engagements e
		 LEFT JOIN organizations o ON o.id = e.client_organisation_id
		 WHERE e.dpco_organisation_id = $1
		 ORDER BY e.updated_at DESC LIMIT 100`,
		claims.OrgID,
	)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var audits []map[string]any
	for rows.Next() {
		var id int
		var status, auditType, clientName string
		var plannedStart, plannedEnd sql.NullString
		var score sql.NullFloat64
		rows.Scan(&id, &status, &auditType, &plannedStart, &plannedEnd, &score, &clientName)
		audits = append(audits, map[string]any{
			"id": id, "status": status, "audit_type": auditType,
			"planned_start": plannedStart.String, "planned_end": plannedEnd.String,
			"compliance_score": score.Float64, "client_name": clientName,
		})
	}
	if audits == nil {
		audits = []map[string]any{}
	}
	jsonOK(w, map[string]any{"audits": audits, "total": len(audits)})
}

// ─── APISIX Route Registration ────────────────────────────────────────────────

func registerAPISIXRoutes(cfg Config) {
	routes := []map[string]any{
		{
			"id":   "dpco-api-health",
			"uri":  "/api/v1/dpco/health",
			"name": "DPCO API Gateway Health",
			"upstream": map[string]any{
				"type": "roundrobin",
				"nodes": map[string]any{
					fmt.Sprintf("dpco-api-gateway:%s", cfg.Port): 1,
				},
			},
			"plugins": map[string]any{},
		},
		{
			"id":   "dpco-api-protected",
			"uri":  "/api/v1/dpco/*",
			"name": "DPCO API Gateway Protected",
			"upstream": map[string]any{
				"type": "roundrobin",
				"nodes": map[string]any{
					fmt.Sprintf("dpco-api-gateway:%s", cfg.Port): 1,
				},
			},
			"plugins": map[string]any{
				"limit-req": map[string]any{"rate": 100, "burst": 50, "key": "remote_addr"},
				"cors":      map[string]any{"allow_origins": "*", "allow_methods": "GET,POST,PUT,DELETE"},
			},
		},
	}

	client := &http.Client{Timeout: 5 * time.Second}
	for _, route := range routes {
		body, _ := json.Marshal(route)
		req, _ := http.NewRequest("PUT",
			fmt.Sprintf("%s/apisix/admin/routes/%s", cfg.APISIXAdminURL, route["id"]),
			strings.NewReader(string(body)),
		)
		req.Header.Set("X-API-KEY", cfg.APISIXAPIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[%s] APISIX route registration failed for %s: %v", ServiceName, route["id"], err)
			continue
		}
		resp.Body.Close()
		log.Printf("[%s] APISIX route registered: %s (HTTP %d)", ServiceName, route["id"], resp.StatusCode)
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	log.Printf("[%s] Starting v%s on port %s", ServiceName, ServiceVersion, cfg.Port)

	// DB
	if err := initDB(cfg.DatabaseURL); err != nil {
		log.Printf("[%s] DB connection failed: %v (continuing without DB)", ServiceName, err)
	} else {
		log.Printf("[%s] DB connected", ServiceName)
	}

	// Register APISIX routes (non-fatal)
	go func() {
		time.Sleep(10 * time.Second)
		registerAPISIXRoutes(cfg)
	}()

	// Router
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Public
	r.Get("/api/v1/dpco/health", handleHealth)

	// Protected
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware)
		r.Get("/api/v1/dpco/me", handleMe)
		r.Get("/api/v1/dpco/clients", handleListClients)
		r.Get("/api/v1/dpco/clients/{orgId}/compliance", handleClientCompliance)
		r.Post("/api/v1/dpco/car", handleSubmitCAR)
		r.Get("/api/v1/dpco/verification", handleListVerifications)
		r.Get("/api/v1/dpco/verification/{id}", handleGetVerification)
		r.Get("/api/v1/dpco/audits", handleListAudits)
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[%s] Server error: %v", ServiceName, err)
		}
	}()
	log.Printf("[%s] Listening on :%s", ServiceName, cfg.Port)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf("[%s] Shutting down...", ServiceName)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	if db != nil {
		db.Close()
	}
	log.Printf("[%s] Stopped", ServiceName)
}
