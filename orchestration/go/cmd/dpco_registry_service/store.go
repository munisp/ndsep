package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

var registryDB *sql.DB

func initRegistryStore(ctx context.Context) error {
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL is required for durable DPCO registry storage")
	}
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("open DPCO registry database: %w", err)
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return fmt.Errorf("connect durable DPCO registry storage: %w", err)
	}
	registryDB = db
	return nil
}

func closeRegistryStore() {
	if registryDB != nil {
		_ = registryDB.Close()
		registryDB = nil
	}
}

func requireRegistryStore() (*sql.DB, error) {
	if registryDB == nil {
		return nil, fmt.Errorf("durable DPCO registry storage is unavailable")
	}
	return registryDB, nil
}

func saveRegistryRecord(ctx context.Context, registryID string, payload map[string]interface{}) error {
	db, err := requireRegistryStore()
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode DPCO registry record: %w", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO dpco_registry_service_records (registry_id, payload)
		VALUES ($1::uuid, $2::jsonb)
		ON CONFLICT (registry_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`, registryID, string(encoded))
	if err != nil {
		return fmt.Errorf("persist DPCO registry record: %w", err)
	}
	return nil
}

func loadRegistryRecord(ctx context.Context, registryID string) (map[string]interface{}, error) {
	db, err := requireRegistryStore()
	if err != nil {
		return nil, err
	}
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT payload FROM dpco_registry_service_records WHERE registry_id = $1::uuid`, registryID).Scan(&raw); err != nil {
		return nil, err
	}
	payload := make(map[string]interface{})
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode DPCO registry record: %w", err)
	}
	return payload, nil
}

func listRegistryRecords(ctx context.Context) ([]map[string]interface{}, error) {
	db, err := requireRegistryStore()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT payload FROM dpco_registry_service_records ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list DPCO registry records: %w", err)
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
			return nil, fmt.Errorf("decode DPCO registry record: %w", err)
		}
		result = append(result, payload)
	}
	return result, rows.Err()
}
