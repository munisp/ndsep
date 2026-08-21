// webhook_delivery — NDSEP Enhancement
// Reliable webhook delivery worker with exponential backoff, signature signing,
// and dead-letter queue. Delivers platform events to registered DPCO/org endpoints.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var (
	dbURL      = envOrDefault("NDSEP_PG_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	workerID   = envOrDefault("WEBHOOK_WORKER_ID", "webhook-worker-1")
	maxRetries = 5
	baseDelay  = 30 * time.Second
)

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Data Types ───────────────────────────────────────────────────────────────

type WebhookDelivery struct {
	ID          int64           `json:"id"`
	WebhookID   int64           `json:"webhook_id"`
	EventType   string          `json:"event_type"`
	Payload     json.RawMessage `json:"payload"`
	TargetURL   string          `json:"target_url"`
	Secret      string          `json:"-"`
	Attempts    int             `json:"attempts"`
	Status      string          `json:"status"`
	NextRetryAt time.Time       `json:"next_retry_at"`
	CreatedAt   time.Time       `json:"created_at"`
}

// ─── Database ─────────────────────────────────────────────────────────────────

func ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_deliveries (
			id SERIAL PRIMARY KEY,
			webhook_id INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL,
			target_url TEXT NOT NULL,
			secret TEXT,
			attempts INTEGER DEFAULT 0,
			status TEXT DEFAULT 'pending',  -- pending, delivered, failed, dead
			last_response_code INTEGER,
			last_response_body TEXT,
			next_retry_at TIMESTAMPTZ DEFAULT NOW(),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			delivered_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_wh_del_status ON webhook_deliveries(status, next_retry_at);
		CREATE INDEX IF NOT EXISTS idx_wh_del_webhook ON webhook_deliveries(webhook_id);
	`)
	return err
}

func fetchPendingDeliveries(db *sql.DB, limit int) ([]WebhookDelivery, error) {
	rows, err := db.Query(`
		SELECT id, webhook_id, event_type, payload, target_url,
		       COALESCE(secret, ''), attempts, status, next_retry_at, created_at
		FROM webhook_deliveries
		WHERE status IN ('pending', 'retrying')
		  AND next_retry_at <= NOW()
		ORDER BY next_retry_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var deliveries []WebhookDelivery
	for rows.Next() {
		var d WebhookDelivery
		if err := rows.Scan(
			&d.ID, &d.WebhookID, &d.EventType, &d.Payload,
			&d.TargetURL, &d.Secret, &d.Attempts, &d.Status,
			&d.NextRetryAt, &d.CreatedAt,
		); err != nil {
			continue
		}
		deliveries = append(deliveries, d)
	}
	return deliveries, nil
}

func markDelivered(db *sql.DB, id int64, statusCode int, body string) error {
	_, err := db.Exec(`
		UPDATE webhook_deliveries
		SET status = 'delivered', delivered_at = NOW(),
		    last_response_code = $2, last_response_body = $3,
		    attempts = attempts + 1
		WHERE id = $1
	`, id, statusCode, body)
	return err
}

func markFailed(db *sql.DB, id int64, attempts int, statusCode int, body string) error {
	if attempts >= maxRetries {
		_, err := db.Exec(`
			UPDATE webhook_deliveries
			SET status = 'dead', last_response_code = $2, last_response_body = $3,
			    attempts = attempts + 1
			WHERE id = $1
		`, id, statusCode, body)
		return err
	}

	// Exponential backoff: 30s, 2m, 8m, 32m, 2h
	delay := baseDelay * time.Duration(1<<uint(attempts))
	nextRetry := time.Now().Add(delay)

	_, err := db.Exec(`
		UPDATE webhook_deliveries
		SET status = 'retrying', next_retry_at = $2,
		    last_response_code = $3, last_response_body = $4,
		    attempts = attempts + 1
		WHERE id = $1
	`, id, nextRetry, statusCode, body)
	return err
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

func signPayload(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func deliver(d WebhookDelivery) (int, string, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest("POST", d.TargetURL, bytes.NewReader(d.Payload))
	if err != nil {
		return 0, "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NDSEP-Event", d.EventType)
	req.Header.Set("X-NDSEP-Delivery", fmt.Sprintf("%d", d.ID))
	req.Header.Set("X-NDSEP-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))

	if d.Secret != "" {
		req.Header.Set("X-NDSEP-Signature", signPayload(d.Payload, d.Secret))
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, err.Error(), err
	}
	defer resp.Body.Close()

	bodyBuf := make([]byte, 512)
	n, _ := resp.Body.Read(bodyBuf)
	body := string(bodyBuf[:n])

	return resp.StatusCode, body, nil
}

// ─── Worker Loop ──────────────────────────────────────────────────────────────

func runWorker(ctx context.Context, db *sql.DB) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	log.Printf("[webhook_delivery] Worker %s started", workerID)

	for {
		select {
		case <-ctx.Done():
			log.Println("[webhook_delivery] Shutting down")
			return
		case <-ticker.C:
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				log.Printf("Begin tx: %v", err)
				continue
			}

			deliveries, err := fetchPendingDeliveries(db, 50)
			if err != nil {
				tx.Rollback()
				log.Printf("Fetch deliveries: %v", err)
				continue
			}
			tx.Commit()

			for _, d := range deliveries {
				statusCode, body, err := deliver(d)
				if err != nil || statusCode < 200 || statusCode >= 300 {
					if err != nil {
						log.Printf("[FAIL] Delivery %d → %s: %v", d.ID, d.TargetURL, err)
					} else {
						log.Printf("[FAIL] Delivery %d → %s: HTTP %d", d.ID, d.TargetURL, statusCode)
					}
					if dbErr := markFailed(db, d.ID, d.Attempts+1, statusCode, body); dbErr != nil {
						log.Printf("Mark failed: %v", dbErr)
					}
				} else {
					log.Printf("[OK] Delivery %d → %s: HTTP %d", d.ID, d.TargetURL, statusCode)
					if dbErr := markDelivered(db, d.ID, statusCode, body); dbErr != nil {
						log.Printf("Mark delivered: %v", dbErr)
					}
				}
			}
		}
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
