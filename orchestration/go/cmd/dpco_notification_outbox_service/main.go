package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ndsep/orchestration/internal/dpconotificationoutbox"
	_ "github.com/lib/pq"
)

func main() {
	port := getenv("PORT", "8340")
	databaseURL := os.Getenv("DATABASE_URL")
	deliveryURL := os.Getenv("DPCO_NOTIFICATION_PROVIDER_URL")
	internalToken := os.Getenv("DPCO_NOTIFICATION_INTERNAL_TOKEN")
	if databaseURL == "" || deliveryURL == "" || internalToken == "" {
		log.Fatal("DATABASE_URL, DPCO_NOTIFICATION_PROVIDER_URL, and DPCO_NOTIFICATION_INTERNAL_TOKEN are required")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("open durable notification outbox database: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
	if err := db.PingContext(pingCtx); err != nil {
		pingCancel()
		log.Fatalf("connect durable notification outbox database: %v", err)
	}
	pingCancel()

	store, err := dpconotificationoutbox.NewStore(db)
	if err != nil {
		log.Fatalf("initialize durable notification outbox: %v", err)
	}
	deliverer, err := dpconotificationoutbox.NewHTTPDeliverer(deliveryURL)
	if err != nil {
		log.Fatalf("configure DPCO notification provider: %v", err)
	}
	processor := dpconotificationoutbox.Processor{
		Store:          store,
		Deliverer:      deliverer,
		LeaseDuration:  2 * time.Minute,
		RequestTimeout: 5 * time.Second,
	}

	go drainLoop(ctx, processor)

	handler := dpconotificationoutbox.MutationHandler{
		Store: store,
		ResolvePrincipal: func(_ context.Context, request *http.Request) (dpconotificationoutbox.Principal, error) {
			provided := request.Header.Get("X-NDSEP-Internal-Token")
			if subtle.ConstantTimeCompare([]byte(provided), []byte(internalToken)) != 1 {
				return dpconotificationoutbox.Principal{}, fmt.Errorf("internal caller authentication failed")
			}
			tenantID := strings.TrimSpace(request.Header.Get("X-NDSEP-Tenant-ID"))
			actorID := strings.TrimSpace(request.Header.Get("X-NDSEP-Actor-ID"))
			if tenantID == "" || actorID == "" {
				return dpconotificationoutbox.Principal{}, fmt.Errorf("trusted tenant and actor headers are required")
			}
			return dpconotificationoutbox.Principal{TenantID: tenantID, ActorID: actorID}, nil
		},
	}

	mux := http.NewServeMux()
	mux.Handle("POST /api/dpco/notifications/send", handler)
	mux.HandleFunc("GET /api/dpco/notifications/deliveries/{idempotencyKey}", handler.DeliveryStatus)
	mux.HandleFunc("GET /health", healthHandler(db, deliveryURL))

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("DPCO durable notification outbox service listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve durable notification outbox: %v", err)
	}
}

func drainLoop(ctx context.Context, processor dpconotificationoutbox.Processor) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := processor.DrainOnce(ctx, 50); err != nil && ctx.Err() == nil {
			log.Printf("DPCO notification outbox drain failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func healthHandler(db *sql.DB, providerURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable", "dependency": "postgresql"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "delivery_provider": providerURL})
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
