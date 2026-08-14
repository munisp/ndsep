package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

var verificationDB *sql.DB

func initVerificationStore(ctx context.Context) error {
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL is required for durable DPCO verification storage")
	}
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("open DPCO verification database: %w", err)
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return fmt.Errorf("connect durable DPCO verification storage: %w", err)
	}
	verificationDB = db
	return nil
}

func closeVerificationStore() {
	if verificationDB != nil {
		_ = verificationDB.Close()
		verificationDB = nil
	}
}

func requireVerificationStore() (*sql.DB, error) {
	if verificationDB == nil {
		return nil, fmt.Errorf("durable DPCO verification storage is unavailable")
	}
	return verificationDB, nil
}

func saveStatementRecord(ctx context.Context, statementID string, payload map[string]interface{}) error {
	db, err := requireVerificationStore()
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode verification statement: %w", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO dpco_verification_service_records (statement_id, payload)
		VALUES ($1::uuid, $2::jsonb)
		ON CONFLICT (statement_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, statementID, string(encoded))
	if err != nil {
		return fmt.Errorf("persist verification statement: %w", err)
	}
	return nil
}

func loadStatementRecord(ctx context.Context, statementID string) (map[string]interface{}, error) {
	db, err := requireVerificationStore()
	if err != nil {
		return nil, err
	}
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT payload FROM dpco_verification_service_records WHERE statement_id = $1::uuid`, statementID).Scan(&raw); err != nil {
		return nil, err
	}
	payload := make(map[string]interface{})
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode verification statement: %w", err)
	}
	return payload, nil
}

func listStatementRecords(ctx context.Context) ([]map[string]interface{}, error) {
	db, err := requireVerificationStore()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT payload FROM dpco_verification_service_records ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list verification statements: %w", err)
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
			return nil, fmt.Errorf("decode verification statement: %w", err)
		}
		result = append(result, payload)
	}
	return result, rows.Err()
}
