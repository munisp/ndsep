package dpconotificationoutbox

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusDelivered  = "delivered"
	StatusDeadLetter = "dead_letter"
)

var (
	ErrStoreUnavailable = errors.New("durable DPCO notification outbox is unavailable")
	ErrLeaseLost        = errors.New("DPCO notification outbox lease was lost")
)

type IdempotencyConflictError struct {
	TenantID       string
	IdempotencyKey uuid.UUID
}

func (e *IdempotencyConflictError) Error() string {
	return fmt.Sprintf("idempotency key %s was previously used with a different notification intent for tenant %s", e.IdempotencyKey, e.TenantID)
}

type Intent struct {
	TenantID       string
	ActorID        string
	IdempotencyKey uuid.UUID
	RuleID         string
	EntityID       string
	EventData      json.RawMessage
}

type Record struct {
	ID                 uuid.UUID
	TenantID           string
	ActorID            string
	IdempotencyKey     uuid.UUID
	RequestHash        string
	RuleID             string
	EntityID           string
	EventData          json.RawMessage
	Status             string
	Attempts           int
	MaxAttempts        int
	NextAttemptAt      time.Time
	LeaseOwner         *uuid.UUID
	LeaseExpiresAt     *time.Time
	ProviderDeliveryID *string
	ProviderStatus     *string
	DeliveredAt        *time.Time
	DeadLetteredAt     *time.Time
	LastError          *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, ErrStoreUnavailable
	}
	return &Store{db: db}, nil
}

// Enqueue atomically creates a durable delivery intent. A repeated tenant/key pair
// returns the existing record only when its canonical request hash is identical.
// A key reused with different input is rejected rather than silently repurposed.
func (s *Store) Enqueue(ctx context.Context, intent Intent) (record Record, reused bool, err error) {
	if err := validateIntent(intent); err != nil {
		return Record{}, false, err
	}

	payload, err := canonicalEventData(intent.EventData)
	if err != nil {
		return Record{}, false, err
	}
	requestHash := hashIntent(intent, payload)
	candidateID := uuid.New()

	row := s.db.QueryRowContext(ctx, `
		INSERT INTO dpco_notification_outbox (
			id, tenant_id, actor_id, idempotency_key, request_hash,
			rule_id, entity_id, event_data, status, attempts, max_attempts,
			next_attempt_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8::jsonb, $9, 0, 12,
			now(), now(), now()
		)
		ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
		SET updated_at = dpco_notification_outbox.updated_at
		RETURNING
			id, tenant_id, actor_id, idempotency_key, request_hash,
			rule_id, entity_id, event_data, status, attempts, max_attempts,
			next_attempt_at, lease_owner, lease_expires_at,
			provider_delivery_id, provider_status, delivered_at, dead_lettered_at,
			last_error, created_at, updated_at,
			(xmax <> 0) AS reused`,
		candidateID, intent.TenantID, intent.ActorID, intent.IdempotencyKey, requestHash,
		intent.RuleID, intent.EntityID, payload, StatusPending,
	)

	if err := scanRecord(row, &record, &reused); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, false, ErrStoreUnavailable
		}
		return Record{}, false, fmt.Errorf("enqueue durable DPCO notification intent: %w", err)
	}
	if record.RequestHash != requestHash {
		return Record{}, false, &IdempotencyConflictError{TenantID: intent.TenantID, IdempotencyKey: intent.IdempotencyKey}
	}
	return record, reused, nil
}

// Claim atomically leases records that are ready for delivery or whose previous
// worker lease expired. Attempts increments exactly when a delivery attempt begins.
func (s *Store) Claim(ctx context.Context, limit int, lease time.Duration) ([]Record, error) {
	if limit < 1 || limit > 500 {
		return nil, fmt.Errorf("claim limit must be between 1 and 500")
	}
	if lease < time.Second || lease > 30*time.Minute {
		return nil, fmt.Errorf("lease must be between one second and thirty minutes")
	}

	owner := uuid.New()
	rows, err := s.db.QueryContext(ctx, `
		WITH candidates AS (
			SELECT id
			FROM dpco_notification_outbox
			WHERE (
				(status = 'pending' AND next_attempt_at <= now())
				OR (status = 'processing' AND lease_expires_at <= now())
			)
			AND attempts < max_attempts
			ORDER BY next_attempt_at ASC, created_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE dpco_notification_outbox AS outbox
		SET status = 'processing',
			attempts = outbox.attempts + 1,
			lease_owner = $2,
			lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
			updated_at = now()
		FROM candidates
		WHERE outbox.id = candidates.id
		RETURNING
			outbox.id, outbox.tenant_id, outbox.actor_id, outbox.idempotency_key, outbox.request_hash,
			outbox.rule_id, outbox.entity_id, outbox.event_data, outbox.status, outbox.attempts,
			outbox.max_attempts, outbox.next_attempt_at, outbox.lease_owner, outbox.lease_expires_at,
			outbox.provider_delivery_id, outbox.provider_status, outbox.delivered_at,
			outbox.dead_lettered_at, outbox.last_error, outbox.created_at, outbox.updated_at`,
		limit, owner, lease.Milliseconds(),
	)
	if err != nil {
		return nil, fmt.Errorf("claim durable DPCO notification intents: %w", err)
	}
	defer rows.Close()

	records := make([]Record, 0, limit)
	for rows.Next() {
		var record Record
		if err := scanRecord(rows, &record, nil); err != nil {
			return nil, fmt.Errorf("scan claimed DPCO notification intent: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate claimed DPCO notification intents: %w", err)
	}
	return records, nil
}

func (s *Store) MarkDelivered(ctx context.Context, record Record, providerDeliveryID, providerStatus string) error {
	if record.LeaseOwner == nil {
		return ErrLeaseLost
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE dpco_notification_outbox
		SET status = 'delivered',
			provider_delivery_id = $3,
			provider_status = $4,
			delivered_at = now(),
			last_error = NULL,
			lease_owner = NULL,
			lease_expires_at = NULL,
			updated_at = now()
		WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
		record.ID, *record.LeaseOwner, nullableString(providerDeliveryID), nullableString(providerStatus),
	)
	if err != nil {
		return fmt.Errorf("mark DPCO notification delivered: %w", err)
	}
	return requireOneRow(result)
}

// MarkRetry converts an in-flight record to pending with a bounded retry delay,
// or dead-letters it if the attempted delivery exhausted max_attempts. A worker
// that no longer owns the lease cannot change delivery state.
func (s *Store) MarkRetry(ctx context.Context, record Record, retryAfter time.Duration, deliveryErr error) (deadLetter bool, err error) {
	if record.LeaseOwner == nil {
		return false, ErrLeaseLost
	}
	if retryAfter < time.Second || retryAfter > 24*time.Hour {
		return false, fmt.Errorf("retry delay must be between one second and twenty-four hours")
	}
	message := "delivery failed"
	if deliveryErr != nil {
		message = deliveryErr.Error()
	}

	var status string
	err = s.db.QueryRowContext(ctx, `
		UPDATE dpco_notification_outbox
		SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
			next_attempt_at = CASE
				WHEN attempts >= max_attempts THEN next_attempt_at
				ELSE now() + ($3::bigint * interval '1 millisecond')
			END,
			dead_lettered_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
			last_error = $4,
			lease_owner = NULL,
			lease_expires_at = NULL,
			updated_at = now()
		WHERE id = $1 AND status = 'processing' AND lease_owner = $2
		RETURNING status`,
		record.ID, *record.LeaseOwner, retryAfter.Milliseconds(), message,
	).Scan(&status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, ErrLeaseLost
		}
		return false, fmt.Errorf("schedule DPCO notification retry: %w", err)
	}
	return status == StatusDeadLetter, nil
}

// MarkDeadLetter records a terminal non-retryable failure. The current lease owner
// must match so a stale worker cannot overwrite a recovered record's state.
func (s *Store) MarkDeadLetter(ctx context.Context, record Record, deliveryErr error) error {
	if record.LeaseOwner == nil {
		return ErrLeaseLost
	}
	message := "non-retryable delivery failure"
	if deliveryErr != nil {
		message = deliveryErr.Error()
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE dpco_notification_outbox
		SET status = 'dead_letter',
			dead_lettered_at = now(),
			last_error = $3,
			lease_owner = NULL,
			lease_expires_at = NULL,
			updated_at = now()
		WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
		record.ID, *record.LeaseOwner, message,
	)
	if err != nil {
		return fmt.Errorf("dead-letter DPCO notification: %w", err)
	}
	return requireOneRow(result)
}

func (s *Store) GetByIdempotencyKey(ctx context.Context, tenantID string, key uuid.UUID) (Record, error) {
	if tenantID == "" || key == uuid.Nil {
		return Record{}, fmt.Errorf("tenant ID and idempotency key are required")
	}
	var record Record
	if err := scanRecord(s.db.QueryRowContext(ctx, `
		SELECT
			id, tenant_id, actor_id, idempotency_key, request_hash,
			rule_id, entity_id, event_data, status, attempts, max_attempts,
			next_attempt_at, lease_owner, lease_expires_at,
			provider_delivery_id, provider_status, delivered_at, dead_lettered_at,
			last_error, created_at, updated_at
		FROM dpco_notification_outbox
		WHERE tenant_id = $1 AND idempotency_key = $2`, tenantID, key), &record, nil); err != nil {
		return Record{}, err
	}
	return record, nil
}

func validateIntent(intent Intent) error {
	if intent.TenantID == "" || intent.ActorID == "" || intent.RuleID == "" || intent.EntityID == "" {
		return fmt.Errorf("tenant ID, actor ID, rule ID, and entity ID are required")
	}
	if intent.IdempotencyKey == uuid.Nil {
		return fmt.Errorf("idempotency key must be a UUID")
	}
	return nil
}

func canonicalEventData(raw json.RawMessage) ([]byte, error) {
	if len(raw) == 0 {
		return []byte("{}"), nil
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("event data must be valid JSON: %w", err)
	}
	canonical, err := json.Marshal(parsed)
	if err != nil {
		return nil, fmt.Errorf("canonicalize event data: %w", err)
	}
	return canonical, nil
}

func hashIntent(intent Intent, eventData []byte) string {
	canonical, _ := json.Marshal(struct {
		TenantID  string          `json:"tenant_id"`
		ActorID   string          `json:"actor_id"`
		RuleID    string          `json:"rule_id"`
		EntityID  string          `json:"entity_id"`
		EventData json.RawMessage `json:"event_data"`
	}{
		TenantID: intent.TenantID, ActorID: intent.ActorID, RuleID: intent.RuleID,
		EntityID: intent.EntityID, EventData: eventData,
	})
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:])
}

func scanRecord(scanner interface {
	Scan(...any) error
}, record *Record, reused *bool) error {
	var (
		leaseOwner         sql.NullString
		leaseExpiresAt     sql.NullTime
		providerDeliveryID sql.NullString
		providerStatus     sql.NullString
		deliveredAt        sql.NullTime
		deadLetteredAt     sql.NullTime
		lastError          sql.NullString
	)
	values := []any{
		&record.ID, &record.TenantID, &record.ActorID, &record.IdempotencyKey, &record.RequestHash,
		&record.RuleID, &record.EntityID, &record.EventData, &record.Status, &record.Attempts,
		&record.MaxAttempts, &record.NextAttemptAt, &leaseOwner, &leaseExpiresAt,
		&providerDeliveryID, &providerStatus, &deliveredAt, &deadLetteredAt,
		&lastError, &record.CreatedAt, &record.UpdatedAt,
	}
	if reused != nil {
		values = append(values, reused)
	}
	if err := scanner.Scan(values...); err != nil {
		return err
	}
	if leaseOwner.Valid {
		value, err := uuid.Parse(leaseOwner.String)
		if err != nil {
			return fmt.Errorf("decode lease owner UUID: %w", err)
		}
		record.LeaseOwner = &value
	}
	if leaseExpiresAt.Valid {
		record.LeaseExpiresAt = &leaseExpiresAt.Time
	}
	if providerDeliveryID.Valid {
		record.ProviderDeliveryID = &providerDeliveryID.String
	}
	if providerStatus.Valid {
		record.ProviderStatus = &providerStatus.String
	}
	if deliveredAt.Valid {
		record.DeliveredAt = &deliveredAt.Time
	}
	if deadLetteredAt.Valid {
		record.DeadLetteredAt = &deadLetteredAt.Time
	}
	if lastError.Valid {
		record.LastError = &lastError.String
	}
	return nil
}

func requireOneRow(result sql.Result) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect outbox update: %w", err)
	}
	if affected != 1 {
		return ErrLeaseLost
	}
	return nil
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
