package main

import (
	"context"
	"database/sql"
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
