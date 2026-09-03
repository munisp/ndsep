package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func integrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	rawURL := os.Getenv("WEBHOOK_QUEUE_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("WEBHOOK_QUEUE_TEST_DATABASE_URL is required for real PostgreSQL worker integration tests")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		t.Fatalf("WEBHOOK_QUEUE_TEST_DATABASE_URL must target localhost: %q", rawURL)
	}
	if !strings.Contains(parsed.Path, "ndsep_test") && !strings.Contains(parsed.Path, "ndsep_e2e") {
		t.Fatalf("WEBHOOK_QUEUE_TEST_DATABASE_URL must name a disposable ndsep_test or ndsep_e2e database: %q", parsed.Path)
	}
	db, err := sql.Open("postgres", rawURL)
	if err != nil {
		t.Fatalf("open disposable PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatalf("ping disposable PostgreSQL: %v", err)
	}
	return db
}

func resetWorkerFixtures(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`TRUNCATE TABLE webhook_delivery_attempts, webhook_deliveries, webhook_subscriptions RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("reset migration-owned webhook fixtures: %v", err)
	}
}

func attemptIdempotencyKey(subscriptionID int, eventID uuid.UUID) string {
	digest := sha256.Sum256([]byte(strconv.Itoa(subscriptionID) + ":" + eventID.String()))
	return hex.EncodeToString(digest[:])
}

func insertAttempt(t *testing.T, db *sql.DB, status string) (int64, uuid.UUID) {
	t.Helper()
	var subscriptionID int
	if err := db.QueryRow(`
		INSERT INTO webhook_subscriptions (org_id, url, events, secret, active)
		VALUES (1, 'http://receiver.invalid/webhooks', ARRAY['audit.completed'], 'test-secret', true)
		RETURNING id`).Scan(&subscriptionID); err != nil {
		t.Fatalf("insert subscription fixture: %v", err)
	}
	eventID := uuid.New()
	payload, err := json.Marshal(map[string]any{"id": eventID.String(), "kind": "integration-test"})
	if err != nil {
		t.Fatalf("marshal event fixture: %v", err)
	}
	var id int64
	if err := db.QueryRow(`
		INSERT INTO webhook_delivery_attempts
		  (subscription_id, event_id, event_type, payload, destination_url, status, idempotency_key)
		VALUES ($1, $2, 'audit.completed', $3::jsonb, 'http://receiver.invalid/webhooks', $4, $5)
		RETURNING id`, subscriptionID, eventID, string(payload), status, attemptIdempotencyKey(subscriptionID, eventID)).Scan(&id); err != nil {
		t.Fatalf("insert queue fixture: %v", err)
	}
	return id, eventID
}

func testConfig() workerConfig {
	return workerConfig{
		workerID:      "worker-integration-test",
		batchSize:     10,
		leaseDuration: time.Minute,
	}
}

func TestWorkerClaimsAndFinalizesExactlyOneCanonicalOutcomePostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, eventID := insertAttempt(t, db, "pending")
	metrics := &workerMetrics{}
	attempts, err := claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil {
		t.Fatalf("claim pending attempt: %v", err)
	}
	if len(attempts) != 1 || attempts[0].ID != attemptID || attempts[0].EventID != eventID || attempts[0].ClaimToken == uuid.Nil {
		t.Fatalf("unexpected claimed attempt: %#v", attempts)
	}
	var status, owner string
	var claimToken uuid.UUID
	var expiresAt time.Time
	if err := db.QueryRow(`SELECT status, claim_owner, claim_token, claim_expires_at FROM webhook_delivery_attempts WHERE id = $1`, attemptID).Scan(&status, &owner, &claimToken, &expiresAt); err != nil {
		t.Fatalf("inspect claimed attempt: %v", err)
	}
	if status != "processing" || owner != "worker-integration-test" || claimToken != attempts[0].ClaimToken || !expiresAt.After(time.Now().UTC()) {
		t.Fatalf("claim lease was not durably recorded: status=%q owner=%q token=%s expiry=%s", status, owner, claimToken, expiresAt)
	}

	// Explicit local receiver test double; database persistence is real PostgreSQL.
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-NDSEP-Delivery"); got != eventID.String() {
			t.Errorf("stable receiver id=%q want=%q", got, eventID.String())
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	attempts[0].TargetURL = receiver.URL
	statusCode, _, deliveryErr := deliver(context.Background(), receiver.Client(), attempts[0], true)
	if deliveryErr != nil || statusCode != http.StatusNoContent {
		t.Fatalf("deliver to local receiver: status=%d err=%v", statusCode, deliveryErr)
	}
	if err := finalizeAttempt(context.Background(), db, attempts[0], statusCode, nil, metrics); err != nil {
		t.Fatalf("finalize successful attempt: %v", err)
	}

	var finalStatus string
	var clearedToken, clearedOwner, clearedExpiry any
	if err := db.QueryRow(`SELECT status, claim_token, claim_owner, claim_expires_at FROM webhook_delivery_attempts WHERE id = $1`, attemptID).Scan(&finalStatus, &clearedToken, &clearedOwner, &clearedExpiry); err != nil {
		t.Fatalf("inspect finalized attempt: %v", err)
	}
	if finalStatus != "delivered" || clearedToken != nil || clearedOwner != nil || clearedExpiry != nil {
		t.Fatalf("final transition is not terminal/claim-cleared: status=%q token=%v owner=%v expiry=%v", finalStatus, clearedToken, clearedOwner, clearedExpiry)
	}
	var canonicalCount int
	if err := db.QueryRow(`SELECT count(*) FROM webhook_deliveries WHERE queue_attempt_id = $1 AND success = true`, attemptID).Scan(&canonicalCount); err != nil {
		t.Fatalf("inspect canonical ledger: %v", err)
	}
	if canonicalCount != 1 || metrics.delivered.Load() != 1 {
		t.Fatalf("canonical outcome is not exactly once: rows=%d delivered=%d", canonicalCount, metrics.delivered.Load())
	}
	if err := finalizeAttempt(context.Background(), db, attempts[0], statusCode, nil, metrics); err == nil {
		t.Fatal("stale claim token finalization unexpectedly succeeded")
	}
	if err := db.QueryRow(`SELECT count(*) FROM webhook_deliveries WHERE queue_attempt_id = $1`, attemptID).Scan(&canonicalCount); err != nil || canonicalCount != 1 {
		t.Fatalf("stale finalization duplicated canonical ledger: rows=%d err=%v", canonicalCount, err)
	}
}

func TestWorkerClaimSkipsAlreadyLeasedAttemptPostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	_, _ = insertAttempt(t, db, "pending")
	metrics := &workerMetrics{}
	first, err := claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil || len(first) != 1 {
		t.Fatalf("first worker claim: rows=%d err=%v", len(first), err)
	}
	second, err := claimEligibleAttempts(context.Background(), db, workerConfig{workerID: "second-worker", batchSize: 10, leaseDuration: time.Minute}, metrics)
	if err != nil {
		t.Fatalf("second worker claim: %v", err)
	}
	if len(second) != 0 {
		t.Fatalf("leased row was claimed twice: %#v", second)
	}
}

func TestWorkerRecoversExpiredLeaseAndReclaimsPostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, _ := insertAttempt(t, db, "pending")
	if _, err := db.Exec(`
		UPDATE webhook_delivery_attempts
		SET status = 'processing', claimed_at = now() - interval '2 minutes',
		    claim_token = $2::uuid, claim_owner = 'crashed-worker',
		    claim_expires_at = now() - interval '1 minute'
		WHERE id = $1`, attemptID, uuid.New().String()); err != nil {
		t.Fatalf("create expired lease fixture: %v", err)
	}
	metrics := &workerMetrics{}
	if err := recoverExpiredLeases(context.Background(), db, metrics); err != nil {
		t.Fatalf("recover expired lease: %v", err)
	}
	if metrics.leaseRecoveries.Load() != 1 {
		t.Fatalf("expected one lease recovery, got %d", metrics.leaseRecoveries.Load())
	}
	claimed, err := claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil || len(claimed) != 1 || claimed[0].ID != attemptID {
		t.Fatalf("reclaim expired attempt: %#v err=%v", claimed, err)
	}
}

func TestWorkerConcurrentClaimsAreMutuallyExclusivePostgres(t *testing.T) {
	dbFirst := integrationDatabase(t)
	dbSecond := integrationDatabase(t)
	resetWorkerFixtures(t, dbFirst)
	attemptID, _ := insertAttempt(t, dbFirst, "pending")

	type claimResult struct {
		attempts []webhookDeliveryAttempt
		err      error
	}
	start := make(chan struct{})
	results := make(chan claimResult, 2)
	claim := func(db *sql.DB, workerID string) {
		<-start
		attempts, err := claimEligibleAttempts(context.Background(), db, workerConfig{
			workerID:      workerID,
			batchSize:     10,
			leaseDuration: time.Minute,
		}, &workerMetrics{})
		results <- claimResult{attempts: attempts, err: err}
	}
	go claim(dbFirst, "concurrent-worker-one")
	go claim(dbSecond, "concurrent-worker-two")
	close(start)

	first := <-results
	second := <-results
	if first.err != nil || second.err != nil {
		t.Fatalf("concurrent claim failure: first=%v second=%v", first.err, second.err)
	}
	claimed := append(first.attempts, second.attempts...)
	if len(claimed) != 1 || claimed[0].ID != attemptID || claimed[0].ClaimToken == uuid.Nil {
		t.Fatalf("two PostgreSQL connections did not mutually exclude claim: %#v", claimed)
	}
	var status string
	var owner string
	if err := dbFirst.QueryRow(`SELECT status, claim_owner FROM webhook_delivery_attempts WHERE id = $1`, attemptID).Scan(&status, &owner); err != nil {
		t.Fatalf("inspect concurrent claim: %v", err)
	}
	if status != "processing" || (owner != "concurrent-worker-one" && owner != "concurrent-worker-two") {
		t.Fatalf("unexpected durable concurrent claim state: status=%q owner=%q", status, owner)
	}
}

func TestWorkerRecordsCanonicalOutcomeOnlyAfterTerminalStatePostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, _ := insertAttempt(t, db, "pending")
	metrics := &workerMetrics{}
	claimed, err := claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim retry fixture: %#v err=%v", claimed, err)
	}
	if err := finalizeAttempt(context.Background(), db, claimed[0], http.StatusBadGateway, nil, metrics); err != nil {
		t.Fatalf("finalize retryable result: %v", err)
	}
	var status string
	var canonicalCount int
	if err := db.QueryRow(`SELECT status FROM webhook_delivery_attempts WHERE id = $1`, attemptID).Scan(&status); err != nil {
		t.Fatalf("inspect retrying queue state: %v", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM webhook_deliveries WHERE queue_attempt_id = $1`, attemptID).Scan(&canonicalCount); err != nil {
		t.Fatalf("inspect retryable canonical outcome: %v", err)
	}
	if status != "retrying" || canonicalCount != 0 || metrics.retried.Load() != 1 {
		t.Fatalf("retryable failure became a canonical final outcome: status=%q rows=%d retried=%d", status, canonicalCount, metrics.retried.Load())
	}
	if _, err := db.Exec(`UPDATE webhook_delivery_attempts SET next_retry_at = now() WHERE id = $1`, attemptID); err != nil {
		t.Fatalf("make retry claimable: %v", err)
	}
	claimed, err = claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil || len(claimed) != 1 || claimed[0].ID != attemptID {
		t.Fatalf("claim retried attempt: %#v err=%v", claimed, err)
	}
	if err := finalizeAttempt(context.Background(), db, claimed[0], http.StatusNoContent, nil, metrics); err != nil {
		t.Fatalf("finalize eventual success: %v", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM webhook_deliveries WHERE queue_attempt_id = $1 AND success = true`, attemptID).Scan(&canonicalCount); err != nil {
		t.Fatalf("inspect final canonical outcome: %v", err)
	}
	if canonicalCount != 1 || metrics.delivered.Load() != 1 {
		t.Fatalf("terminal success did not create exactly one canonical outcome: rows=%d delivered=%d", canonicalCount, metrics.delivered.Load())
	}
}

func TestWorkerCanonicalLedgerFailureRollsBackQueueFinalizationPostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, _ := insertAttempt(t, db, "pending")
	claimed, err := claimEligibleAttempts(context.Background(), db, testConfig(), &workerMetrics{})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim ledger failure fixture: %#v err=%v", claimed, err)
	}
	if _, err := db.Exec(`ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_force_test_failure CHECK (false) NOT VALID`); err != nil {
		t.Fatalf("install local ledger failure constraint: %v", err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec(`ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_force_test_failure`); err != nil {
			t.Errorf("remove local ledger failure constraint: %v", err)
		}
	})
	if err := finalizeAttempt(context.Background(), db, claimed[0], http.StatusNoContent, nil, &workerMetrics{}); err == nil {
		t.Fatal("canonical ledger failure unexpectedly finalized queue attempt")
	}
	var status string
	var token uuid.UUID
	if err := db.QueryRow(`SELECT status, claim_token FROM webhook_delivery_attempts WHERE id = $1`, attemptID).Scan(&status, &token); err != nil {
		t.Fatalf("inspect queue after ledger rollback: %v", err)
	}
	if status != "processing" || token != claimed[0].ClaimToken {
		t.Fatalf("canonical ledger failure partially finalized queue: status=%q token=%s", status, token)
	}
	var canonicalCount int
	if err := db.QueryRow(`SELECT count(*) FROM webhook_deliveries WHERE queue_attempt_id = $1`, attemptID).Scan(&canonicalCount); err != nil {
		t.Fatalf("inspect failed canonical ledger write: %v", err)
	}
	if canonicalCount != 0 {
		t.Fatalf("failed canonical ledger write unexpectedly persisted rows=%d", canonicalCount)
	}
}

func TestWorkerFinalizesInactiveSubscriptionWithoutDeliveryPostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, _ := insertAttempt(t, db, "pending")
	if _, err := db.Exec(`UPDATE webhook_subscriptions SET active = false WHERE id = 1`); err != nil {
		t.Fatalf("disable subscription after queue admission: %v", err)
	}
	metrics := &workerMetrics{}
	claimed, err := claimEligibleAttempts(context.Background(), db, testConfig(), metrics)
	if err != nil || len(claimed) != 1 || claimed[0].ID != attemptID {
		t.Fatalf("claim inactive-subscription queue attempt: %#v err=%v", claimed, err)
	}
	if claimed[0].SubscriptionActive {
		t.Fatal("claim did not preserve disabled subscription state")
	}
	if err := finalizeAttempt(context.Background(), db, claimed[0], 0, errSubscriptionInactive, metrics); err != nil {
		t.Fatalf("finalize disabled subscription without recipient dispatch: %v", err)
	}
	var status string
	var canonicalSuccess bool
	if err := db.QueryRow(`
		SELECT a.status, d.success
		FROM webhook_delivery_attempts a
		JOIN webhook_deliveries d ON d.queue_attempt_id = a.id
		WHERE a.id = $1`, attemptID).Scan(&status, &canonicalSuccess); err != nil {
		t.Fatalf("inspect disabled-subscription canonical outcome: %v", err)
	}
	if status != "dead" || canonicalSuccess || metrics.dead.Load() != 1 {
		t.Fatalf("disabled subscription was not terminally finalized: status=%q success=%t dead=%d", status, canonicalSuccess, metrics.dead.Load())
	}
}

func TestWorkerLeaseWindowConstraintRejectsNonFutureLeasePostgres(t *testing.T) {
	db := integrationDatabase(t)
	resetWorkerFixtures(t, db)
	attemptID, _ := insertAttempt(t, db, "pending")

	_, err := db.Exec(`
		UPDATE webhook_delivery_attempts
		SET status = 'processing',
		    claimed_at = now(),
		    claim_token = $2::uuid,
		    claim_owner = 'invalid-lease-test',
		    claim_expires_at = now()
		WHERE id = $1`, attemptID, uuid.New().String())
	if err == nil {
		t.Fatal("processing lease with a non-future expiry unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "webhook_delivery_attempt_processing_lease_window_check") {
		t.Fatalf("unexpected invalid-lease constraint error: %v", err)
	}
}
