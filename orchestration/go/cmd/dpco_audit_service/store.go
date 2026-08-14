package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

var auditDB *sql.DB

func initAuditStore(ctx context.Context) error {
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL is required for durable DPCO audit storage")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("open DPCO audit database: %w", err)
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return fmt.Errorf("connect durable DPCO audit storage: %w", err)
	}
	auditDB = db
	return nil
}

func requireAuditStore() (*sql.DB, error) {
	if auditDB == nil {
		return nil, fmt.Errorf("durable DPCO audit storage is unavailable")
	}
	return auditDB, nil
}

func closeAuditStore() {
	if auditDB != nil {
		_ = auditDB.Close()
		auditDB = nil
	}
}

func saveAuditRecord(ctx context.Context, auditID string, payload map[string]interface{}) error {
	db, err := requireAuditStore()
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode audit record: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO dpco_audit_service_records (audit_id, payload)
		VALUES ($1::uuid, $2::jsonb)
		ON CONFLICT (audit_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, auditID, string(encoded)); err != nil {
		return fmt.Errorf("persist audit record: %w", err)
	}
	return nil
}

func loadAuditRecord(ctx context.Context, auditID string) (map[string]interface{}, error) {
	db, err := requireAuditStore()
	if err != nil {
		return nil, err
	}
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT payload FROM dpco_audit_service_records WHERE audit_id = $1::uuid`, auditID).Scan(&raw); err != nil {
		return nil, err
	}
	payload := make(map[string]interface{})
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode audit record: %w", err)
	}
	return payload, nil
}

func listAuditRecords(ctx context.Context) ([]map[string]interface{}, error) {
	db, err := requireAuditStore()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT payload FROM dpco_audit_service_records ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list audit records: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]interface{}, 0)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		payload := make(map[string]interface{})
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, fmt.Errorf("decode audit record: %w", err)
		}
		result = append(result, payload)
	}
	return result, rows.Err()
}
