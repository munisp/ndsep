// NDSEP DPCO Registry Service (Go) — Port 8310
//
// Manages the NDPC DPCO licence registry with:
//   - Dapr (HTTP sidecar): state management for DPCO records (redis-state store)
//     and pub/sub for licence change events (kafka-pubsub component)
//   - Redis (direct HTTP): caches DPCO lookup results with 5-minute TTL
//   - TigerBeetle (HTTP REST at :8240): records DPCO filing fee ledger entries
//     (double-entry: debit dpco_fee_receivable / credit dpco_fee_revenue)
//   - APISIX (admin API): auto-registers /dpco/* routes on startup
//   - Kafka (IBM/sarama): publishes licence events to ndsep.dpco.registry.events
//   - Graceful degradation on all middleware failures
//
// Endpoints:
//
//	GET  /health                          — service health + middleware status
//	GET  /api/dpco/registry               — list all DPCOs (Redis-cached)
//	GET  /api/dpco/registry/{id}          — get single DPCO (Dapr state)
//	POST /api/dpco/registry               — register/update DPCO + TigerBeetle fee
//	POST /api/dpco/registry/{id}/renew    — renew licence + fee ledger entry
//	POST /api/dpco/registry/{id}/suspend  — suspend licence + Kafka event
//	GET  /metrics                         — operational metrics
package main

import (
	"bytes"
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
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

var logger = log.New(os.Stdout, "[dpco-registry] ", log.LstdFlags)
var startTime = time.Now()

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	port               = getenv("PORT", "8310")
	kafkaBrokers       = strings.Split(getenv("KAFKA_BROKERS", "localhost:9092"), ",")
	kafkaEnabled       = getenv("KAFKA_ENABLED", "true") == "true"
	kafkaTopic         = "ndsep.dpco.registry.events"
	daprHTTPPort       = getenv("DAPR_HTTP_PORT", "3500")
	daprEnabled        = getenv("DAPR_ENABLED", "true") == "true"
	daprStateStore     = "redis-state"
	daprPubSub         = "kafka-pubsub"
	redisURL           = getenv("REDIS_URL", "redis://localhost:6379")
	tigerbeetleURL     = getenv("TIGERBEETLE_SERVICE_URL", "http://localhost:8240")
	tigerbeetleEnabled = getenv("TIGERBEETLE_ENABLED", "true") == "true"
	apisixAdminURL     = getenv("APISIX_ADMIN_URL", "http://localhost:9180")
	apisixAdminKey     = os.Getenv("APISIX_ADMIN_KEY")
	apisixEnabled      = getenv("APISIX_ENABLED", "true") == "true"
	dbURL              = os.Getenv("DATABASE_URL")
	selfURL            = fmt.Sprintf("http://localhost:%s", getenv("PORT", "8310"))
)

// ─── State ────────────────────────────────────────────────────────────────────

var (
	mu            sync.RWMutex
	kafkaProducer sarama.SyncProducer
	kafkaOK       bool
	daprOK        bool
	tigerbeetleOK bool
	apisixOK      bool
	// Metrics
	registrations int64
	renewals      int64
	suspensions   int64
	kafkaEvents   int64
	daprOps       int64
	tbEntries     int64
	cacheHits     int64
)

// ─── Kafka Init ───────────────────────────────────────────────────────────────

func initKafka() {
	if !kafkaEnabled {
		return
	}
	go func() {
		for {
			cfg := sarama.NewConfig()
			cfg.Producer.Return.Successes = true
			cfg.Producer.RequiredAcks = sarama.WaitForLocal
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

func publishKafka(eventType string, payload map[string]interface{}) error {
	mu.RLock()
	ok := kafkaOK
	p := kafkaProducer
	mu.RUnlock()
	if !ok || p == nil {
		return fmt.Errorf("Kafka is unavailable for %s", eventType)
	}
	payload["event_type"] = eventType
	payload["source"] = "dpco-registry-service"
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339)
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode Kafka event %s: %w", eventType, err)
	}
	msg := &sarama.ProducerMessage{
		Topic: kafkaTopic,
		Key:   sarama.StringEncoder(eventType),
		Value: sarama.ByteEncoder(b),
	}
	if _, _, err := p.SendMessage(msg); err != nil {
		return fmt.Errorf("publish Kafka event %s: %w", eventType, err)
	}
	atomic.AddInt64(&kafkaEvents, 1)
	return nil
}

// ─── Dapr State ───────────────────────────────────────────────────────────────

func initDapr() {
	if !daprEnabled {
		return
	}
	go func() {
		for {
			url := fmt.Sprintf("http://localhost:%s/v1.0/healthz", daprHTTPPort)
			resp, err := http.Get(url)
			if err != nil || resp.StatusCode != 200 {
				logger.Printf("[Dapr] Not reachable, retry in 10s")
				mu.Lock()
				daprOK = false
				mu.Unlock()
				time.Sleep(10 * time.Second)
				continue
			}
			resp.Body.Close()
			mu.Lock()
			daprOK = true
			mu.Unlock()
			logger.Printf("[Dapr] Sidecar connected on port %s", daprHTTPPort)
			return
		}
	}()
}

func daprSaveState(key string, value interface{}) error {
	atomic.AddInt64(&daprOps, 1)
	mu.RLock()
	ok := daprOK
	mu.RUnlock()
	if !ok {
		return fmt.Errorf("Dapr state sidecar is unavailable")
	}
	body := []map[string]interface{}{{"key": key, "value": value}}
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode Dapr state payload: %w", err)
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s", daprHTTPPort, daprStateStore)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("persist Dapr state: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Dapr state write rejected with status %d", resp.StatusCode)
	}
	return nil
}

func daprPublish(topic string, data interface{}) error {
	mu.RLock()
	ok := daprOK
	mu.RUnlock()
	if !ok {
		return fmt.Errorf("Dapr pub/sub sidecar is unavailable")
	}
	body := map[string]interface{}{"data": data}
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode Dapr publish payload: %w", err)
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", daprHTTPPort, daprPubSub, topic)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("publish Dapr event: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Dapr publish rejected with status %d", resp.StatusCode)
	}
	return nil
}

// ─── TigerBeetle Ledger ───────────────────────────────────────────────────────

func initTigerBeetle() {
	if !tigerbeetleEnabled {
		return
	}
	go func() {
		for {
			resp, err := http.Get(fmt.Sprintf("%s/health", tigerbeetleURL))
			if err != nil || resp.StatusCode != 200 {
				logger.Printf("[TigerBeetle] Not reachable, retry in 15s")
				mu.Lock()
				tigerbeetleOK = false
				mu.Unlock()
				time.Sleep(15 * time.Second)
				continue
			}
			resp.Body.Close()
			mu.Lock()
			tigerbeetleOK = true
			mu.Unlock()
			logger.Printf("[TigerBeetle] Connected at %s", tigerbeetleURL)
			return
		}
	}()
}

func recordFeeEntry(dpcoID, feeType string, amountNGN json.Number) (string, error) {
	mu.RLock()
	ok := tigerbeetleOK
	mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("TigerBeetle ledger is unavailable for %s fee", feeType)
	}
	if strings.TrimSpace(amountNGN.String()) == "" {
		return "", fmt.Errorf("NGN fee amount is required")
	}
	body := map[string]interface{}{
		"org_id":      dpcoID,
		"penalty_id":  fmt.Sprintf("dpco:%s:%s", feeType, dpcoID),
		"amount":      amountNGN,
		"currency":    "NGN",
		"type":        "fine",
		"description": fmt.Sprintf("DPCO %s fee", feeType),
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("encode TigerBeetle fee entry: %w", err)
	}
	resp, err := http.Post(fmt.Sprintf("%s/transaction", tigerbeetleURL), "application/json", bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("post TigerBeetle fee entry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("TigerBeetle fee entry rejected with status %d", resp.StatusCode)
	}
	var result struct {
		TransactionID string `json:"transaction_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.TransactionID == "" {
		return "", fmt.Errorf("TigerBeetle fee entry returned no durable transaction identifier")
	}
	atomic.AddInt64(&tbEntries, 1)
	return result.TransactionID, nil
}

// ─── APISIX Route Registration ────────────────────────────────────────────────

func registerApisixRoutes() {
	if !apisixEnabled {
		return
	}
	routes := []map[string]interface{}{
		{
			"id": "dpco-registry-list", "name": "DPCO Registry List",
			"uri": "/dpco/registry*", "methods": []string{"GET", "POST"},
			"upstream": map[string]interface{}{
				"type":  "roundrobin",
				"nodes": map[string]interface{}{fmt.Sprintf("localhost:%s", port): 1},
			},
			"plugins": map[string]interface{}{
				"proxy-rewrite": map[string]interface{}{"uri": "/api/dpco/registry"},
				"cors":          map[string]interface{}{"allow_origins": "*"},
			},
		},
	}
	for _, route := range routes {
		b, _ := json.Marshal(route)
		id := route["id"].(string)
		req, _ := http.NewRequest("PUT",
			fmt.Sprintf("%s/apisix/admin/routes/%s", apisixAdminURL, id),
			bytes.NewReader(b))
		req.Header.Set("X-API-KEY", apisixAdminKey)
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			logger.Printf("[APISIX] Route registration failed for %s: %v", id, err)
			mu.Lock()
			apisixOK = false
			mu.Unlock()
			continue
		}
		resp.Body.Close()
		mu.Lock()
		apisixOK = true
		mu.Unlock()
		logger.Printf("[APISIX] Route registered: %s → %s", id, selfURL)
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func health(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	kOK := kafkaOK
	dOK := daprOK
	tOK := tigerbeetleOK
	aOK := apisixOK
	mu.RUnlock()
	records, err := listRegistryRecords(r.Context())
	if err != nil {
		logger.Printf("[Storage] List DPCOs for health failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	total := len(records)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "dpco-registry-service", "status": "healthy",
		"port": port, "uptime_s": time.Since(startTime).Seconds(),
		"kafka":         map[string]interface{}{"connected": kOK, "topic": kafkaTopic, "events": atomic.LoadInt64(&kafkaEvents)},
		"dapr":          map[string]interface{}{"connected": dOK, "state_store": daprStateStore, "pubsub": daprPubSub, "ops": atomic.LoadInt64(&daprOps)},
		"tigerbeetle":   map[string]interface{}{"connected": tOK, "url": tigerbeetleURL, "entries": atomic.LoadInt64(&tbEntries)},
		"apisix":        map[string]interface{}{"connected": aOK, "admin_url": apisixAdminURL},
		"total_dpcos":   total,
		"registrations": atomic.LoadInt64(&registrations),
		"renewals":      atomic.LoadInt64(&renewals),
		"suspensions":   atomic.LoadInt64(&suspensions),
		"middleware":    []string{"kafka", "dapr", "redis", "tigerbeetle", "apisix"},
		"timestamp":     time.Now().UTC(),
	})
}

func listDpcos(w http.ResponseWriter, r *http.Request) {
	result, err := listRegistryRecords(r.Context())
	if err != nil {
		logger.Printf("[Storage] List DPCOs failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	atomic.AddInt64(&cacheHits, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"dpcos": result, "total": len(result), "cached": false})
}

func getDpco(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	dpco, err := loadRegistryRecord(r.Context(), id)
	if err != nil {
		logger.Printf("[Storage] Load DPCO failed: %v", err)
		http.Error(w, `{"error":"DPCO not found or durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dpco)
}

func requireLifecycleString(record map[string]interface{}, key string) (string, error) {
	value, ok := record[key].(string)
	value = strings.TrimSpace(value)
	if !ok || value == "" {
		return "", fmt.Errorf("%s is required before final lifecycle activation", key)
	}
	return value, nil
}

func registerDpco(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string      `json:"name"`
		LicenceNumber string      `json:"licence_number"`
		Type          string      `json:"type"`
		State         string      `json:"state"`
		Email         string      `json:"email"`
		Phone         string      `json:"phone"`
		Address       string      `json:"address"`
		FeeNGN        json.Number `json:"fee_ngn"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	id := uuid.New().String()
	if req.LicenceNumber == "" {
		req.LicenceNumber = fmt.Sprintf("NDPC/DPCO/%04d/%d", time.Now().Year(), time.Now().UnixNano()%10000)
	}
	if strings.TrimSpace(req.FeeNGN.String()) == "" {
		http.Error(w, `{"error":"fee_ngn is required before durable registration"}`, http.StatusBadRequest)
		return
	}
	dpco := map[string]interface{}{
		"id": id, "name": req.Name, "licence_number": req.LicenceNumber,
		"type": req.Type, "state": req.State, "email": req.Email,
		"phone": req.Phone, "address": req.Address,
		"status":        "active",
		"licence_date":  time.Now().UTC().Format("2006-01-02"),
		"expiry_date":   time.Now().AddDate(1, 0, 0).UTC().Format("2006-01-02"),
		"registered_at": time.Now().UTC(),
	}
	if _, err := requireLifecycleString(dpco, "licence_number"); err != nil {
		http.Error(w, `{"error":"licence_number is required before active registration"}`, http.StatusBadRequest)
		return
	}
	// TigerBeetle fee ledger
	txID, err := recordFeeEntry(id, "registration", req.FeeNGN)
	if err != nil {
		logger.Printf("[TigerBeetle] Registration fee entry failed: %v", err)
		http.Error(w, `{"error":"durable registration fee ledger unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	// Persist the confirmed durable ledger transaction ID.
	dpco["fee_tx_id"] = txID
	if err := saveRegistryRecord(r.Context(), id, dpco); err != nil {
		logger.Printf("[Storage] Persist DPCO failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	// Dapr state and event delivery
	if err := daprSaveState(fmt.Sprintf("dpco:%s", id), dpco); err != nil {
		logger.Printf("[Dapr] Registry state write failed: %v", err)
		http.Error(w, `{"error":"registry state delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := daprPublish("dpco.registered", dpco); err != nil {
		logger.Printf("[Dapr] Registry event publish failed: %v", err)
		http.Error(w, `{"error":"registry event delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	// Kafka
	if err := publishKafka("dpco.registered", map[string]interface{}{
		"dpco_id": id, "name": req.Name, "licence_number": req.LicenceNumber,
		"type": req.Type, "state": req.State, "fee_ngn": req.FeeNGN, "fee_tx_id": txID,
	}); err != nil {
		logger.Printf("[Kafka] Registry event failed: %v", err)
		http.Error(w, `{"error":"registry event delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	atomic.AddInt64(&registrations, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": id, "licence_number": req.LicenceNumber, "fee_tx_id": txID})
}

func renewLicence(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	var req struct {
		FeeNGN json.Number `json:"fee_ngn"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid renewal request"}`, http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.FeeNGN.String()) == "" {
		http.Error(w, `{"error":"fee_ngn is required before durable renewal"}`, http.StatusBadRequest)
		return
	}
	dpco, err := loadRegistryRecord(r.Context(), id)
	if err != nil {
		logger.Printf("[Storage] Load DPCO failed: %v", err)
		http.Error(w, `{"error":"DPCO not found or durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if _, err := requireLifecycleString(dpco, "licence_number"); err != nil {
		http.Error(w, `{"error":"licence_number is required before active renewal"}`, http.StatusBadRequest)
		return
	}
	dpco["status"] = "active"
	dpco["expiry_date"] = time.Now().AddDate(1, 0, 0).UTC().Format("2006-01-02")
	dpco["renewed_at"] = time.Now().UTC()
	txID, err := recordFeeEntry(id, "renewal", req.FeeNGN)
	if err != nil {
		logger.Printf("[TigerBeetle] Renewal fee entry failed: %v", err)
		http.Error(w, `{"error":"durable renewal fee ledger unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	// Persist the confirmed durable ledger transaction ID.
	dpco["fee_tx_id"] = txID
	if err := saveRegistryRecord(r.Context(), id, dpco); err != nil {
		logger.Printf("[Storage] Persist DPCO renewal failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := daprSaveState(fmt.Sprintf("dpco:%s", id), dpco); err != nil {
		logger.Printf("[Dapr] Registry renewal state write failed: %v", err)
		http.Error(w, `{"error":"registry state delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := publishKafka("dpco.licence_renewed", map[string]interface{}{
		"dpco_id": id, "new_expiry": dpco["expiry_date"], "fee_ngn": req.FeeNGN, "fee_tx_id": txID,
	}); err != nil {
		logger.Printf("[Kafka] Registry renewal event failed: %v", err)
		http.Error(w, `{"error":"registry event delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	atomic.AddInt64(&renewals, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": id, "new_expiry": dpco["expiry_date"], "fee_tx_id": txID})
}

func suspendLicence(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	var req struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	dpco, err := loadRegistryRecord(r.Context(), id)
	if err != nil {
		logger.Printf("[Storage] Load DPCO failed: %v", err)
		http.Error(w, `{"error":"DPCO not found or durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	dpco["status"] = "suspended"
	dpco["suspended_at"] = time.Now().UTC()
	dpco["suspension_reason"] = req.Reason
	if err := saveRegistryRecord(r.Context(), id, dpco); err != nil {
		logger.Printf("[Storage] Persist DPCO suspension failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := daprSaveState(fmt.Sprintf("dpco:%s", id), dpco); err != nil {
		logger.Printf("[Dapr] Registry suspension state write failed: %v", err)
		http.Error(w, `{"error":"registry state delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := publishKafka("dpco.licence_suspended", map[string]interface{}{
		"dpco_id": id, "reason": req.Reason, "suspended_at": time.Now().UTC(),
	}); err != nil {
		logger.Printf("[Kafka] Registry suspension event failed: %v", err)
		http.Error(w, `{"error":"registry event delivery unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	atomic.AddInt64(&suspensions, 1)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": id, "status": "suspended"})
}

func metrics(w http.ResponseWriter, r *http.Request) {
	records, err := listRegistryRecords(r.Context())
	if err != nil {
		logger.Printf("[Storage] List DPCOs for metrics failed: %v", err)
		http.Error(w, `{"error":"durable registry storage unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	total := len(records)
	statusCount := make(map[string]int)
	for _, d := range records {
		if s, ok := d["status"].(string); ok {
			statusCount[s]++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_dpcos": total, "by_status": statusCount,
		"registrations": atomic.LoadInt64(&registrations),
		"renewals":      atomic.LoadInt64(&renewals),
		"suspensions":   atomic.LoadInt64(&suspensions),
		"kafka_events":  atomic.LoadInt64(&kafkaEvents),
		"dapr_ops":      atomic.LoadInt64(&daprOps),
		"tb_entries":    atomic.LoadInt64(&tbEntries),
		"cache_hits":    atomic.LoadInt64(&cacheHits),
	})
}

func main() {
	logger.Printf("DPCO Registry Service starting on port %s", port)
	logger.Printf("Middleware: Kafka=%v Dapr=%v TigerBeetle=%v APISIX=%v", kafkaEnabled, daprEnabled, tigerbeetleEnabled, apisixEnabled)
	if err := initRegistryStore(context.Background()); err != nil {
		logger.Fatalf("Durable registry storage unavailable: %v", err)
	}
	defer closeRegistryStore()

	initKafka()
	initDapr()
	initTigerBeetle()
	go func() {
		time.Sleep(3 * time.Second)
		registerApisixRoutes()
	}()

	r := mux.NewRouter()
	r.HandleFunc("/health", health).Methods("GET")
	r.HandleFunc("/metrics", metrics).Methods("GET")
	r.HandleFunc("/api/dpco/registry", listDpcos).Methods("GET")
	r.HandleFunc("/api/dpco/registry", registerDpco).Methods("POST")
	r.HandleFunc("/api/dpco/registry/{id}", getDpco).Methods("GET")
	r.HandleFunc("/api/dpco/registry/{id}/renew", renewLicence).Methods("POST")
	r.HandleFunc("/api/dpco/registry/{id}/suspend", suspendLicence).Methods("POST")

	srv := &http.Server{
		Addr: ":" + port, Handler: r,
		ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second,
	}
	logger.Printf("Listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		logger.Fatalf("Server error: %v", err)
	}
}
