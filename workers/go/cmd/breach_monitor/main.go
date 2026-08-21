/*
 * NDSEP Breach Notification Monitor (Go)
 * ========================================
 * High-performance breach timer checker that runs as a cron job.
 * Checks all active breach timers and sends escalation alerts.
 *
 * Recommendation M15: 72-hour NDPA breach notification enforcement
 *
 * Usage: breach_monitor -interval 300  (check every 5 minutes)
 */

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

type BreachTimer struct {
	BreachID        int       `json:"breach_id"`
	DiscoveredAt    time.Time `json:"discovered_at"`
	DeadlineAt      time.Time `json:"deadline_at"`
	NotifiedAt      *time.Time `json:"notified_at"`
	EscalationsSent int       `json:"escalations_sent"`
	Status          string    `json:"status"`
}

type EscalationAlert struct {
	BreachID       int     `json:"breach_id"`
	HoursRemaining float64 `json:"hours_remaining"`
	Urgency        string  `json:"urgency"` // warning, urgent, critical
	Message        string  `json:"message"`
}

func main() {
	interval := flag.Int("interval", 300, "Check interval in seconds")
	once := flag.Bool("once", false, "Run once and exit")
	flag.Parse()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)

	log.Printf("[BreachMonitor] Starting (interval=%ds)", *interval)

	if *once {
		checkTimers(db)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(time.Duration(*interval) * time.Second)
	defer ticker.Stop()

	// Initial check
	checkTimers(db)

	for {
		select {
		case <-ticker.C:
			checkTimers(db)
		case <-sigCh:
			log.Println("[BreachMonitor] Shutting down...")
			cancel()
			return
		case <-ctx.Done():
			return
		}
	}
}

func checkTimers(db *sql.DB) {
	rows, err := db.Query(
		`SELECT breach_id, discovered_at, deadline_at, notified_at, escalations_sent, status
		 FROM breach_timers WHERE status = 'active' ORDER BY deadline_at ASC`)
	if err != nil {
		log.Printf("[BreachMonitor] Query failed: %v", err)
		return
	}
	defer rows.Close()

	now := time.Now()
	var alerts []EscalationAlert
	var overdue []int

	for rows.Next() {
		var t BreachTimer
		var notifiedAt sql.NullTime
		if err := rows.Scan(&t.BreachID, &t.DiscoveredAt, &t.DeadlineAt, &notifiedAt, &t.EscalationsSent, &t.Status); err != nil {
			log.Printf("[BreachMonitor] Scan error: %v", err)
			continue
		}
		if notifiedAt.Valid {
			t.NotifiedAt = &notifiedAt.Time
		}

		hoursRemaining := t.DeadlineAt.Sub(now).Hours()

		if hoursRemaining <= 0 {
			overdue = append(overdue, t.BreachID)
			// Mark overdue
			db.Exec(`UPDATE breach_timers SET status = 'overdue' WHERE breach_id = $1`, t.BreachID)
			alerts = append(alerts, EscalationAlert{
				BreachID:       t.BreachID,
				HoursRemaining: 0,
				Urgency:        "critical",
				Message:        fmt.Sprintf("BREACH #%d OVERDUE — 72-hour NDPA deadline PASSED", t.BreachID),
			})
		} else {
			urgency := "warning"
			if hoursRemaining <= 6 {
				urgency = "critical"
			} else if hoursRemaining <= 24 {
				urgency = "urgent"
			}

			// Check escalation thresholds
			thresholds := []float64{48, 24, 12, 6, 2, 1}
			for i, threshold := range thresholds {
				if hoursRemaining <= threshold && t.EscalationsSent <= i {
					alerts = append(alerts, EscalationAlert{
						BreachID:       t.BreachID,
						HoursRemaining: hoursRemaining,
						Urgency:        urgency,
						Message:        fmt.Sprintf("Breach #%d: %.1f hours remaining (72-hour NDPA deadline)", t.BreachID, hoursRemaining),
					})
					db.Exec(`UPDATE breach_timers SET escalations_sent = escalations_sent + 1 WHERE breach_id = $1`, t.BreachID)
					break
				}
			}
		}
	}

	if len(alerts) > 0 {
		log.Printf("[BreachMonitor] %d escalation alerts, %d overdue", len(alerts), len(overdue))
		for _, alert := range alerts {
			log.Printf("[BreachMonitor] [%s] %s", strings.ToUpper(alert.Urgency), alert.Message)
			// Forward to platform API for notification dispatch
			sendAlert(alert)
		}
	} else {
		log.Printf("[BreachMonitor] All clear — no escalations needed")
	}
}

func sendAlert(alert EscalationAlert) {
	apiURL := os.Getenv("NDSEP_API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:3000"
	}
	body, _ := json.Marshal(alert)
	resp, err := http.Post(apiURL+"/api/workers/event", "application/json",
		strings.NewReader(fmt.Sprintf(`{"event":"breach_escalation","data":%s}`, string(body))))
	if err != nil {
		log.Printf("[BreachMonitor] Failed to send alert: %v", err)
		return
	}
	defer resp.Body.Close()
}
