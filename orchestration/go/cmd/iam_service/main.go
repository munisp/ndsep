// NDSEP IAM Service (Go) — Real Keycloak OIDC + Permify HTTP REST. Port 8150.
//
// Keycloak (gocloak v13):
//   - Validates JWT bearer tokens via Keycloak token introspection API
//   - Realm: ndsep (configurable via KEYCLOAK_REALM)
//   - Client: ndsep-platform (configurable via KEYCLOAK_CLIENT_ID)
//   - Rejects requests when Keycloak cannot make an authoritative decision.
//
// Permify (HTTP REST v1):
//   - Checks permissions through the configured tenant endpoint.
//   - Schema: ndsep-enforcement (org, user, resource entities)
//   - Rejects requests when Permify is unavailable or returns an invalid response.
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

	"github.com/Nerzal/gocloak/v13"
	"github.com/gorilla/mux"
)

var logger = log.New(os.Stdout, "[iam-service] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	keycloakURL      = strings.TrimRight(strings.TrimSpace(os.Getenv("KEYCLOAK_URL")), "/")
	keycloakRealm    = strings.TrimSpace(os.Getenv("KEYCLOAK_REALM"))
	keycloakClientID = strings.TrimSpace(os.Getenv("KEYCLOAK_CLIENT_ID"))
	keycloakSecret   = strings.TrimSpace(os.Getenv("KEYCLOAK_CLIENT_SECRET"))
	permifyURL       = strings.TrimRight(strings.TrimSpace(os.Getenv("PERMIFY_URL")), "/")
	permifyTenant    = strings.TrimSpace(os.Getenv("PERMIFY_TENANT"))
	keycloakEnabled  = getenv("KEYCLOAK_ENABLED", "true") == "true"
	permifyEnabled   = getenv("PERMIFY_ENABLED", "true") == "true"
)

var (
	mu              sync.RWMutex
	keycloakClient  *gocloak.GoCloak
	keycloakOK      bool
	permifyOK       bool
	tokensValidated int64
	tokenErrors     int64
	permChecks      int64
)

func validateIAMConfiguration() error {
	if keycloakEnabled {
		if keycloakURL == "" || keycloakRealm == "" || keycloakClientID == "" || keycloakSecret == "" {
			return fmt.Errorf("KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, and KEYCLOAK_CLIENT_SECRET are required when Keycloak is enabled")
		}
		if os.Getenv("NODE_ENV") == "production" && !strings.HasPrefix(keycloakURL, "https://") {
			return fmt.Errorf("KEYCLOAK_URL must use https:// in production")
		}
	}
	if permifyEnabled && (permifyURL == "" || permifyTenant == "") {
		return fmt.Errorf("PERMIFY_URL and PERMIFY_TENANT are required when Permify is enabled")
	}
	if os.Getenv("NODE_ENV") == "production" && (!keycloakEnabled || !permifyEnabled) {
		return fmt.Errorf("Keycloak and Permify must remain enabled in production")
	}
	return nil
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
			logger.Printf("[Keycloak] Connected to %s realm=%s", keycloakURL, keycloakRealm)
			return
		}
	}()
}

// ─── Permify Init ─────────────────────────────────────────────────────────────

func initPermify() {
	if !permifyEnabled {
		logger.Println("[Permify] Disabled")
		return
	}
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, permifyURL+"/healthz", nil)
			var resp *http.Response
			if err == nil {
				resp, err = (&http.Client{Timeout: 5 * time.Second}).Do(req)
			}
			cancel()
			mu.Lock()
			if err == nil && resp.StatusCode == 200 {
				if !permifyOK {
					logger.Printf("[Permify] Connected to %s", permifyURL)
				}
				permifyOK = true
			} else {
				permifyOK = false
			}
			mu.Unlock()
			if resp != nil {
				resp.Body.Close()
			}
			time.Sleep(30 * time.Second)
		}
	}()
}

// ─── Token Validation ─────────────────────────────────────────────────────────

func validateToken(token string) (map[string]interface{}, error) {
	mu.RLock()
	kc := keycloakClient
	kOK := keycloakOK
	mu.RUnlock()

	if kOK && kc != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		result, err := kc.RetrospectToken(ctx, token, keycloakClientID, keycloakSecret, keycloakRealm)
		if err != nil {
			atomic.AddInt64(&tokenErrors, 1)
			return nil, fmt.Errorf("keycloak introspect: %w", err)
		}
		if result.Active == nil || !*result.Active {
			atomic.AddInt64(&tokenErrors, 1)
			return nil, fmt.Errorf("token inactive")
		}
		atomic.AddInt64(&tokensValidated, 1)
		// gocloak RetrospectTokenResult fields: Active, Exp, Nbf, Iat, Jti, Type, Aud, Permissions
		var jti string
		if result.Jti != nil {
			jti = *result.Jti
		}
		return map[string]interface{}{
			"active":       true,
			"jti":          jti,
			"exp":          result.Exp,
			"validated_by": "keycloak",
		}, nil
	}

	atomic.AddInt64(&tokenErrors, 1)
	return nil, fmt.Errorf("keycloak token validation is unavailable")
}

// ─── Permission Check ─────────────────────────────────────────────────────────

func checkPermission(subjectType, subjectID, permission, resourceType, resourceID string) (bool, error) {
	mu.RLock()
	pOK := permifyOK
	mu.RUnlock()
	atomic.AddInt64(&permChecks, 1)

	if !pOK {
		return false, fmt.Errorf("permify authorization service is unavailable")
	}

	body, err := json.Marshal(map[string]interface{}{
		"metadata":   map[string]interface{}{"schema_version": "", "snap_token": "", "depth": 20},
		"entity":     map[string]interface{}{"type": resourceType, "id": resourceID},
		"permission": permission,
		"subject":    map[string]interface{}{"type": subjectType, "id": subjectID},
	})
	if err != nil {
		return false, fmt.Errorf("encode Permify request: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", permifyURL+"/v1/tenants/"+permifyTenant+"/permissions/check", strings.NewReader(string(body)))
	if err != nil {
		return false, fmt.Errorf("create Permify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("call Permify: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("Permify returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		Can string `json:"can"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("decode Permify response: %w", err)
	}
	return result.Can == "RESULT_ALLOWED", nil
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	kOK := keycloakOK
	pOK := permifyOK
	mu.RUnlock()
	status := "healthy"
	if !kOK || !pOK {
		status = "unavailable"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":            "iam-service",
		"status":             status,
		"keycloak_url":       keycloakURL,
		"keycloak_realm":     keycloakRealm,
		"keycloak_connected": kOK,
		"permify_url":        permifyURL,
		"permify_connected":  pOK,
		"tokens_validated":   atomic.LoadInt64(&tokensValidated),
		"token_errors":       atomic.LoadInt64(&tokenErrors),
		"permission_checks":  atomic.LoadInt64(&permChecks),
		"uptime_seconds":     time.Since(startTime).Seconds(),
		"timestamp":          time.Now().UTC(),
	})
}

func validateHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		http.Error(w, `{"error":"token required"}`, http.StatusBadRequest)
		return
	}
	result, err := validateToken(req.Token)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"valid": true, "claims": result})
}

func checkHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusGone)
	json.NewEncoder(w).Encode(map[string]interface{}{"error": "role-only authorization is retired; use /auth/permission with an authenticated subject and resource"})
}

func permissionHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SubjectType  string `json:"subjectType"`
		SubjectID    string `json:"subjectId"`
		Permission   string `json:"permission"`
		ResourceType string `json:"resourceType"`
		ResourceID   string `json:"resourceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	allowed, err := checkPermission(req.SubjectType, req.SubjectID, req.Permission, req.ResourceType, req.ResourceID)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"allowed": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"allowed": allowed})
}

func metricsHandler(w http.ResponseWriter, _ *http.Request) {
	mu.RLock()
	kOK := keycloakOK
	pOK := permifyOK
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"keycloakConnected": kOK,
		"permifyConnected":  pOK,
		"tokensValidated":   atomic.LoadInt64(&tokensValidated),
		"tokenErrors":       atomic.LoadInt64(&tokenErrors),
		"permissionChecks":  atomic.LoadInt64(&permChecks),
		"uptimeSeconds":     time.Since(startTime).Seconds(),
	})
}

func main() {
	if err := validateIAMConfiguration(); err != nil {
		logger.Fatal(err)
	}
	port := getenv("PORT", "8150")
	initKeycloak()
	initPermify()

	r := mux.NewRouter()
	r.HandleFunc("/health", healthHandler).Methods(http.MethodGet)
	r.HandleFunc("/auth/validate", validateHandler).Methods(http.MethodPost)
	r.HandleFunc("/auth/check", checkHandler).Methods(http.MethodPost)
	r.HandleFunc("/auth/permission", permissionHandler).Methods(http.MethodPost)
	r.HandleFunc("/metrics", metricsHandler).Methods(http.MethodGet)

	logger.Printf("NDSEP IAM Service starting on :%s (Keycloak=%s, Permify=%s)", port, keycloakURL, permifyURL)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		logger.Fatalf("Server failed: %v", err)
	}
}
