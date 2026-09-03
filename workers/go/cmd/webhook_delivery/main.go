// webhook_delivery consumes migration-owned webhook_delivery_attempts rows in active mode.
// It never creates or alters database schema at runtime. Canonical outcomes remain
// append-only webhook_deliveries records; receiver delivery is at-least-once and uses
// the stable event ID header for downstream recipient idempotency.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

const (
	queueModeActive = "active"
	maxErrorLength  = 1024
)

var errSubscriptionInactive = errors.New("subscription inactive before worker dispatch")

type workerConfig struct {
	databaseURL    string
	workerID       string
	batchSize      int
	pollInterval   time.Duration
	leaseDuration  time.Duration
	httpTimeout    time.Duration
	metricsAddress string
}

type workerMetrics struct {
	claimed          atomic.Uint64
	delivered        atomic.Uint64
	retried          atomic.Uint64
	dead             atomic.Uint64
	claimErrors      atomic.Uint64
	finalizeErrors   atomic.Uint64
	leaseRecoveries  atomic.Uint64
	lastClaimUnixSec atomic.Int64
}

type webhookDeliveryAttempt struct {
	ID                 int64
	SubscriptionID     int
	EventID            uuid.UUID
	EventType          string
	Payload            json.RawMessage
	TargetURL          string
	Secret             string
	SubscriptionActive bool
	AttemptCount       int
	MaxAttempts        int
	ClaimToken         uuid.UUID
}

func requiredEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}

func boundedIntEnv(key string, fallback, min, max int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer from %d to %d", key, min, max)
	}
	return parsed, nil
}

func boundedDurationEnv(key string, fallback time.Duration, min, max time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be a duration from %s to %s", key, min, max)
	}
	return parsed, nil
}

func loadConfig() (workerConfig, error) {
	if strings.TrimSpace(os.Getenv("WEBHOOK_DELIVERY_QUEUE_MODE")) != queueModeActive {
		return workerConfig{}, errors.New("webhook delivery worker requires WEBHOOK_DELIVERY_QUEUE_MODE=active")
	}
	databaseURL, err := requiredEnv("NDSEP_PG_URL")
	if err != nil {
		return workerConfig{}, err
	}
	workerID, err := requiredEnv("WEBHOOK_WORKER_ID")
	if err != nil {
		return workerConfig{}, err
	}
	batchSize, err := boundedIntEnv("WEBHOOK_WORKER_BATCH_SIZE", 50, 1, 500)
	if err != nil {
		return workerConfig{}, err
	}
	pollInterval, err := boundedDurationEnv("WEBHOOK_WORKER_POLL_INTERVAL", 5*time.Second, time.Second, time.Minute)
	if err != nil {
		return workerConfig{}, err
	}
	leaseDuration, err := boundedDurationEnv("WEBHOOK_WORKER_LEASE_DURATION", 90*time.Second, 30*time.Second, 10*time.Minute)
	if err != nil {
		return workerConfig{}, err
	}
	httpTimeout, err := boundedDurationEnv("WEBHOOK_WORKER_HTTP_TIMEOUT", 10*time.Second, time.Second, 60*time.Second)
	if err != nil {
		return workerConfig{}, err
	}
	metricsAddress := strings.TrimSpace(os.Getenv("WEBHOOK_WORKER_METRICS_ADDRESS"))
	if metricsAddress == "" {
		metricsAddress = ":8094"
	}
	return workerConfig{databaseURL, workerID, batchSize, pollInterval, leaseDuration, httpTimeout, metricsAddress}, nil
}

func verifySchema(ctx context.Context, db *sql.DB) error {
	const schemaCheck = `
		SELECT
		  to_regclass('public.webhook_delivery_attempts') IS NOT NULL
		  AND to_regclass('public.webhook_deliveries') IS NOT NULL
		  AND EXISTS (
		    SELECT 1 FROM information_schema.columns
		    WHERE table_schema = 'public' AND table_name = 'webhook_delivery_attempts'
		      AND column_name IN ('claim_token', 'claim_owner', 'claim_expires_at', 'last_error')
		    GROUP BY table_schema, table_name HAVING count(*) = 4
		  )
		  AND EXISTS (
		    SELECT 1 FROM pg_indexes
		    WHERE schemaname = 'public' AND tablename = 'webhook_deliveries'
		      AND indexname = 'uq_webhook_deliveries_queue_attempt'
		  )
		  AND EXISTS (
		    SELECT 1 FROM pg_constraint
		    WHERE conrelid = 'webhook_deliveries'::regclass
		      AND conname = 'webhook_deliveries_queue_attempt_id_fk'
		  )
			  AND (
			    SELECT count(*) FROM pg_constraint
			    WHERE conrelid = 'webhook_delivery_attempts'::regclass
			      AND conname IN (
			        'webhook_delivery_attempt_processing_claim_check',
			        'webhook_delivery_attempt_terminal_claim_clear_check',
			        'webhook_delivery_attempt_processing_lease_window_check'
			      )
			  ) = 3`
	var ready bool
	if err := db.QueryRowContext(ctx, schemaCheck).Scan(&ready); err != nil {
		return fmt.Errorf("verify webhook queue schema: %w", err)
	}
	if !ready {
		return errors.New("migration-owned webhook queue schema is incomplete; apply root migrations through 0047 before starting the worker")
	}
	return nil
}

func recoverExpiredLeases(ctx context.Context, db *sql.DB, metrics *workerMetrics) error {
	result, err := db.ExecContext(ctx, `
		UPDATE webhook_delivery_attempts
		SET status = 'retrying',
		    next_retry_at = now(),
		    claim_token = NULL,
		    claim_owner = NULL,
		    claim_expires_at = NULL,
		    updated_at = now(),
		    last_error = COALESCE(last_error, 'worker lease expired before finalization')
		WHERE status = 'processing'
		  AND claim_expires_at <= now()`)
	if err != nil {
		return fmt.Errorf("recover expired webhook leases: %w", err)
	}
	if count, err := result.RowsAffected(); err == nil && count > 0 {
		metrics.leaseRecoveries.Add(uint64(count))
	}
	return nil
}

func claimEligibleAttempts(ctx context.Context, db *sql.DB, cfg workerConfig, metrics *workerMetrics) ([]webhookDeliveryAttempt, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin webhook claim transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		UPDATE webhook_delivery_attempts
		SET status = 'retrying',
		    next_retry_at = now(),
		    claim_token = NULL,
		    claim_owner = NULL,
		    claim_expires_at = NULL,
		    updated_at = now(),
		    last_error = COALESCE(last_error, 'worker lease expired before finalization')
		WHERE status = 'processing'
		  AND claim_expires_at <= now()`); err != nil {
		return nil, fmt.Errorf("recover expired webhook leases in claim transaction: %w", err)
	}

	rows, err := tx.QueryContext(ctx, `
			SELECT a.id, a.subscription_id, a.event_id, a.event_type, a.payload,
			       a.destination_url, s.secret, s.active, a.attempt_count, a.max_attempts
			FROM webhook_delivery_attempts AS a
			JOIN webhook_subscriptions AS s ON s.id = a.subscription_id
			WHERE a.status IN ('pending', 'retrying')
			  AND a.next_retry_at <= now()
		ORDER BY a.next_retry_at ASC, a.id ASC
		LIMIT $1
		FOR UPDATE OF a SKIP LOCKED`, cfg.batchSize)
	if err != nil {
		return nil, fmt.Errorf("select claimable webhook attempts: %w", err)
	}
	defer rows.Close()

	claimed := make([]webhookDeliveryAttempt, 0, cfg.batchSize)
	for rows.Next() {
		var attempt webhookDeliveryAttempt
		if err := rows.Scan(&attempt.ID, &attempt.SubscriptionID, &attempt.EventID, &attempt.EventType, &attempt.Payload, &attempt.TargetURL, &attempt.Secret, &attempt.SubscriptionActive, &attempt.AttemptCount, &attempt.MaxAttempts); err != nil {
			return nil, fmt.Errorf("scan claimable webhook attempt: %w", err)
		}
		attempt.ClaimToken = uuid.New()
		claimed = append(claimed, attempt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate claimable webhook attempts: %w", err)
	}
	// PostgreSQL locks are held by this transaction, but lib/pq requires the
	// result cursor to be closed before issuing the tokenized claim updates.
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close claimable webhook cursor: %w", err)
	}
	for index := range claimed {
		attempt := &claimed[index]
		result, err := tx.ExecContext(ctx, `
			UPDATE webhook_delivery_attempts
			SET status = 'processing',
			    attempt_count = attempt_count + 1,
			    claimed_at = now(),
			    claim_token = $2::uuid,
			    claim_owner = $3,
			    claim_expires_at = now() + $4::interval,
			    updated_at = now(),
			    last_error = NULL
			WHERE id = $1
			  AND status IN ('pending', 'retrying')`, attempt.ID, attempt.ClaimToken.String(), cfg.workerID, fmt.Sprintf("%d milliseconds", cfg.leaseDuration.Milliseconds()))
		if err != nil {
			return nil, fmt.Errorf("mark webhook attempt %d processing: %w", attempt.ID, err)
		}
		updated, err := result.RowsAffected()
		if err != nil || updated != 1 {
			return nil, fmt.Errorf("claim webhook attempt %d affected %d rows", attempt.ID, updated)
		}
		attempt.AttemptCount++
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit webhook claim transaction: %w", err)
	}
	if len(claimed) > 0 {
		metrics.claimed.Add(uint64(len(claimed)))
		metrics.lastClaimUnixSec.Store(time.Now().UTC().Unix())
	}
	return claimed, nil
}

func signPayload(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func deliver(ctx context.Context, client *http.Client, attempt webhookDeliveryAttempt, allowLocalTestTarget bool) (int, string, error) {
	target, err := validateWebhookTarget(attempt.TargetURL, allowLocalTestTarget)
	if err != nil {
		return 0, boundedError(err.Error()), err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(attempt.Payload))
	if err != nil {
		return 0, "", fmt.Errorf("construct webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NDSEP-Event", attempt.EventType)
	req.Header.Set("X-NDSEP-Delivery", attempt.EventID.String())
	req.Header.Set("X-NDSEP-Timestamp", strconv.FormatInt(time.Now().UTC().Unix(), 10))
	if attempt.Secret != "" {
		req.Header.Set("X-NDSEP-Signature", signPayload(attempt.Payload, attempt.Secret))
	}

	response, err := client.Do(req)
	if err != nil {
		return 0, boundedError(err.Error()), err
	}
	defer response.Body.Close()
	return response.StatusCode, "", nil
}

func retryDelay(attemptCount int) time.Duration {
	// Bounded exponential backoff: 30s, 60s, 120s, 240s, then 300s.
	if attemptCount < 1 {
		attemptCount = 1
	}
	if attemptCount > 5 {
		attemptCount = 5
	}
	return 30 * time.Second * time.Duration(1<<uint(attemptCount-1))
}

func boundedError(value string) string {
	if len(value) <= maxErrorLength {
		return value
	}
	return value[:maxErrorLength]
}

func blockedWebhookAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() || address.IsLoopback() || address.IsPrivate() ||
		address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() ||
		address.IsMulticast() || address.IsUnspecified() {
		return true
	}
	if !address.Is4() {
		return false
	}
	octets := address.As4()
	// Block non-public IPv4 ranges not covered by netip.Addr.IsPrivate.
	return octets[0] == 0 || octets[0] >= 240 ||
		(octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127) ||
		(octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
}

func validateWebhookTarget(rawURL string, allowLocalTestTarget bool) (*url.URL, error) {
	target, err := url.ParseRequestURI(rawURL)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, errors.New("webhook destination must be an absolute URL")
	}
	if target.User != nil {
		return nil, errors.New("webhook destination must not include user credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" {
		return nil, errors.New("webhook destination hostname is required")
	}
	if allowLocalTestTarget && target.Scheme == "http" {
		if address, err := netip.ParseAddr(host); err == nil && address.IsLoopback() {
			return target, nil
		}
		return nil, errors.New("test-only HTTP webhook destination must use a loopback IP literal")
	}
	if target.Scheme != "https" {
		return nil, errors.New("webhook destination must use HTTPS")
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil, errors.New("webhook destination must not use localhost")
	}
	if address, err := netip.ParseAddr(host); err == nil && blockedWebhookAddress(address) {
		return nil, errors.New("webhook destination must not use a loopback, private, link-local, multicast, or unspecified IP")
	}
	return target, nil
}

func newWebhookHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("split webhook destination host/port: %w", err)
		}
		resolved, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(resolved) == 0 {
			return nil, fmt.Errorf("resolve webhook destination: %w", err)
		}
		for _, resolvedAddress := range resolved {
			if blockedWebhookAddress(resolvedAddress) {
				return nil, errors.New("webhook destination resolved to a blocked network address")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(resolved[0].String(), port))
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			_, err := validateWebhookTarget(request.URL.String(), false)
			return err
		},
	}
}

func recordCanonicalOutcome(ctx context.Context, tx *sql.Tx, attempt webhookDeliveryAttempt, statusCode int, success bool) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO webhook_deliveries
		  (subscription_id, event, payload, response_status, response_body, attempt, delivered_at, success, queue_attempt_id)
		VALUES ($1, $2, $3::jsonb, $4, NULL, $5, now(), $6, $7)
		ON CONFLICT (queue_attempt_id) WHERE queue_attempt_id IS NOT NULL DO NOTHING`,
		attempt.SubscriptionID, attempt.EventType, string(attempt.Payload), nullableResponseCode(statusCode), attempt.AttemptCount, success, attempt.ID)
	if err != nil {
		return fmt.Errorf("record canonical webhook ledger outcome: %w", err)
	}
	return nil
}

func nullableResponseCode(statusCode int) any {
	if statusCode == 0 {
		return nil
	}
	return statusCode
}

func finalizeAttempt(ctx context.Context, db *sql.DB, attempt webhookDeliveryAttempt, statusCode int, deliveryErr error, metrics *workerMetrics) error {
	success := deliveryErr == nil && statusCode >= 200 && statusCode < 300
	terminal := success || errors.Is(deliveryErr, errSubscriptionInactive) || attempt.AttemptCount >= attempt.MaxAttempts
	status := "retrying"
	if success {
		status = "delivered"
	} else if terminal {
		status = "dead"
	}

	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("begin webhook finalization transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var lastError any
	if deliveryErr != nil {
		lastError = boundedError(deliveryErr.Error())
	}
	var nextRetry any
	if status == "retrying" {
		nextRetry = time.Now().UTC().Add(retryDelay(attempt.AttemptCount))
	}
	// Advance the queue row under its unique lease token before recording a
	// canonical outcome. A stale worker therefore cannot consume the unique
	// queue_attempt_id ledger link, and retryable outcomes do not become final.
	result, err := tx.ExecContext(ctx, `
		UPDATE webhook_delivery_attempts
		SET status = $3::varchar,
		    next_retry_at = COALESCE($4::timestamptz, next_retry_at),
		    claim_token = NULL,
		    claim_owner = NULL,
		    claim_expires_at = NULL,
		    delivered_at = CASE WHEN $3::varchar = 'delivered' THEN now() ELSE delivered_at END,
		    last_response_code = $5,
		    last_error = $6,
		    updated_at = now()
		WHERE id = $1
		  AND status = 'processing'
		  AND claim_token = $2::uuid`, attempt.ID, attempt.ClaimToken.String(), status, nextRetry, nullableResponseCode(statusCode), lastError)
	if err != nil {
		return fmt.Errorf("finalize webhook attempt %d: %w", attempt.ID, err)
	}
	updated, err := result.RowsAffected()
	if err != nil || updated != 1 {
		return fmt.Errorf("finalize webhook attempt %d affected %d rows; lease was lost or terminal state already recorded", attempt.ID, updated)
	}
	if terminal {
		if err := recordCanonicalOutcome(ctx, tx, attempt, statusCode, success); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit webhook finalization transaction: %w", err)
	}
	if status == "delivered" {
		metrics.delivered.Add(1)
	} else if status == "dead" {
		metrics.dead.Add(1)
	} else {
		metrics.retried.Add(1)
	}
	return nil
}

func runWorker(ctx context.Context, db *sql.DB, cfg workerConfig, metrics *workerMetrics) {
	client := newWebhookHTTPClient(cfg.httpTimeout)
	ticker := time.NewTicker(cfg.pollInterval)
	defer ticker.Stop()
	log.Printf("[webhook_delivery] worker=%s mode=active batch=%d lease=%s", cfg.workerID, cfg.batchSize, cfg.leaseDuration)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[webhook_delivery] worker=%s stopping; no new attempts will be claimed", cfg.workerID)
			return
		case <-ticker.C:
			attempts, err := claimEligibleAttempts(ctx, db, cfg, metrics)
			if err != nil {
				metrics.claimErrors.Add(1)
				log.Printf("[webhook_delivery] claim failure: %v", err)
				continue
			}
			for _, attempt := range attempts {
				if !attempt.SubscriptionActive {
					if err := finalizeAttempt(ctx, db, attempt, 0, errSubscriptionInactive, metrics); err != nil {
						metrics.finalizeErrors.Add(1)
						log.Printf("[webhook_delivery] inactive subscription finalization failure attempt=%d: %v", attempt.ID, err)
					}
					continue
				}
				statusCode, _, deliveryErr := deliver(ctx, client, attempt, false)
				if err := finalizeAttempt(ctx, db, attempt, statusCode, deliveryErr, metrics); err != nil {
					metrics.finalizeErrors.Add(1)
					log.Printf("[webhook_delivery] finalization failure attempt=%d: %v", attempt.ID, err)
				}
			}
		}
	}
}

func metricsHandler(metrics *workerMetrics) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_claimed_total counter\nndsep_webhook_queue_worker_claimed_total %d\n", metrics.claimed.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_delivered_total counter\nndsep_webhook_queue_worker_delivered_total %d\n", metrics.delivered.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_retried_total counter\nndsep_webhook_queue_worker_retried_total %d\n", metrics.retried.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_dead_total counter\nndsep_webhook_queue_worker_dead_total %d\n", metrics.dead.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_claim_errors_total counter\nndsep_webhook_queue_worker_claim_errors_total %d\n", metrics.claimErrors.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_finalization_errors_total counter\nndsep_webhook_queue_worker_finalization_errors_total %d\n", metrics.finalizeErrors.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_lease_recoveries_total counter\nndsep_webhook_queue_worker_lease_recoveries_total %d\n", metrics.leaseRecoveries.Load())
		_, _ = fmt.Fprintf(w, "# TYPE ndsep_webhook_queue_worker_last_claim_unixtime gauge\nndsep_webhook_queue_worker_last_claim_unixtime %d\n", metrics.lastClaimUnixSec.Load())
	}
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("[webhook_delivery] configuration: %v", err)
	}
	db, err := sql.Open("postgres", cfg.databaseURL)
	if err != nil {
		log.Fatalf("[webhook_delivery] database open: %v", err)
	}
	defer db.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("[webhook_delivery] database ping: %v", err)
	}
	if err := verifySchema(ctx, db); err != nil {
		log.Fatalf("[webhook_delivery] schema readiness: %v", err)
	}

	metrics := &workerMetrics{}
	server := &http.Server{Addr: cfg.metricsAddress, ReadHeaderTimeout: 5 * time.Second}
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	http.HandleFunc("/metrics", metricsHandler(metrics))
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[webhook_delivery] metrics server: %v", err)
		}
	}()

	runWorker(ctx, db, cfg, metrics)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[webhook_delivery] metrics shutdown: %v", err)
	}
}
