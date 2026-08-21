// NDSEP RSS & Webhook Feed Server (Go)
// =======================================
// Exposes public feeds for platform changelog and compliance updates:
//   GET /api/changelog.rss    → RSS 2.0 feed of platform changelog entries
//   GET /api/changelog.atom   → Atom 1.0 feed
//   GET /api/changelog.json   → JSON Feed 1.1
//   POST /api/webhooks/subscribe    → Register a webhook endpoint
//   POST /api/webhooks/unsubscribe  → Remove a webhook endpoint
//   POST /api/webhooks/trigger      → Internal: trigger webhook dispatch
//
// Webhook events:
//   - changelog.published   : new platform update published
//   - compliance.alert      : compliance score anomaly detected
//   - enforcement.action    : new enforcement action filed
//   - breach.reported       : data breach notification submitted
//
// Technology: Go · net/http · encoding/xml · database/sql
// Port: 8213
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

var (
	dbURL       = getEnv("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
	baseURL     = getEnv("BASE_URL", "https://ndsep.ndpc.gov.ng")
	port        = getEnv("RSS_PORT", "8213")
	workerStart = time.Now()
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── RSS 2.0 structures ─────────────────────────────────────────────────────────
type RSS struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel RSSChannel `xml:"channel"`
}

type RSSChannel struct {
	Title         string    `xml:"title"`
	Link          string    `xml:"link"`
	Description   string    `xml:"description"`
	Language      string    `xml:"language"`
	LastBuildDate string    `xml:"lastBuildDate"`
	Items         []RSSItem `xml:"item"`
}

type RSSItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	PubDate     string `xml:"pubDate"`
	GUID        string `xml:"guid"`
	Category    string `xml:"category"`
}

// ── Atom 1.0 structures ────────────────────────────────────────────────────────
type AtomFeed struct {
	XMLName  xml.Name    `xml:"feed"`
	XMLNS    string      `xml:"xmlns,attr"`
	Title    string      `xml:"title"`
	Link     AtomLink    `xml:"link"`
	Updated  string      `xml:"updated"`
	ID       string      `xml:"id"`
	Subtitle string      `xml:"subtitle"`
	Entries  []AtomEntry `xml:"entry"`
}

type AtomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr,omitempty"`
}

type AtomEntry struct {
	Title   string   `xml:"title"`
	Link    AtomLink `xml:"link"`
	ID      string   `xml:"id"`
	Updated string   `xml:"updated"`
	Summary string   `xml:"summary"`
	Content string   `xml:"content"`
}

// ── Webhook registry ───────────────────────────────────────────────────────────
type WebhookSubscription struct {
	ID       string   `json:"id"`
	URL      string   `json:"url"`
	Events   []string `json:"events"`
	Secret   string   `json:"secret"`
	OrgID    string   `json:"org_id"`
	Active   bool     `json:"active"`
	Created  string   `json:"created_at"`
}

var (
	webhookMu   sync.RWMutex
	webhooks    = make(map[string]WebhookSubscription)
	totalDispatched int64
	totalErrors     int64
)

// ── Changelog query ────────────────────────────────────────────────────────────
type ChangelogEntry struct {
	ID          string
	Version     string
	Title       string
	Body        string
	Category    string
	PublishedAt time.Time
}

func fetchChangelog(db *sql.DB, limit int) ([]ChangelogEntry, error) {
	rows, err := db.Query(`
		SELECT id::text, version, title, body, COALESCE(category, 'update'), published_at
		FROM changelogs
		ORDER BY published_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []ChangelogEntry
	for rows.Next() {
		var e ChangelogEntry
		if err := rows.Scan(&e.ID, &e.Version, &e.Title, &e.Body, &e.Category, &e.PublishedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// ── RSS handler ────────────────────────────────────────────────────────────────
func rssHandler(w http.ResponseWriter, r *http.Request) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer db.Close()

	entries, err := fetchChangelog(db, 20)
	if err != nil {
		http.Error(w, "failed to fetch changelog", http.StatusInternalServerError)
		return
	}

	items := make([]RSSItem, 0, len(entries))
	for _, e := range entries {
		items = append(items, RSSItem{
			Title:       fmt.Sprintf("[%s] %s", e.Version, e.Title),
			Link:        fmt.Sprintf("%s/changelog#%s", baseURL, e.ID),
			Description: e.Body,
			PubDate:     e.PublishedAt.Format(time.RFC1123Z),
			GUID:        fmt.Sprintf("%s/changelog/%s", baseURL, e.ID),
			Category:    e.Category,
		})
	}

	feed := RSS{
		Version: "2.0",
		Channel: RSSChannel{
			Title:         "NDSEP Platform Changelog",
			Link:          baseURL + "/changelog",
			Description:   "National Data Sovereignty Enforcement Platform — official changelog and update feed",
			Language:      "en-ng",
			LastBuildDate: time.Now().Format(time.RFC1123Z),
			Items:         items,
		},
	}

	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write([]byte(xml.Header))
	xml.NewEncoder(w).Encode(feed)
}

// ── Atom handler ───────────────────────────────────────────────────────────────
func atomHandler(w http.ResponseWriter, r *http.Request) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer db.Close()

	entries, err := fetchChangelog(db, 20)
	if err != nil {
		http.Error(w, "failed to fetch changelog", http.StatusInternalServerError)
		return
	}

	atomEntries := make([]AtomEntry, 0, len(entries))
	for _, e := range entries {
		atomEntries = append(atomEntries, AtomEntry{
			Title:   fmt.Sprintf("[%s] %s", e.Version, e.Title),
			Link:    AtomLink{Href: fmt.Sprintf("%s/changelog#%s", baseURL, e.ID)},
			ID:      fmt.Sprintf("%s/changelog/%s", baseURL, e.ID),
			Updated: e.PublishedAt.Format(time.RFC3339),
			Summary: e.Body[:min(200, len(e.Body))],
			Content: e.Body,
		})
	}

	updated := time.Now().Format(time.RFC3339)
	if len(entries) > 0 {
		updated = entries[0].PublishedAt.Format(time.RFC3339)
	}

	feed := AtomFeed{
		XMLNS:    "http://www.w3.org/2005/Atom",
		Title:    "NDSEP Platform Changelog",
		Link:     AtomLink{Href: baseURL + "/changelog", Rel: "alternate"},
		Updated:  updated,
		ID:       baseURL + "/changelog",
		Subtitle: "National Data Sovereignty Enforcement Platform official updates",
		Entries:  atomEntries,
	}

	w.Header().Set("Content-Type", "application/atom+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write([]byte(xml.Header))
	xml.NewEncoder(w).Encode(feed)
}

// ── JSON Feed handler ──────────────────────────────────────────────────────────
func jsonFeedHandler(w http.ResponseWriter, r *http.Request) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer db.Close()

	entries, err := fetchChangelog(db, 20)
	if err != nil {
		http.Error(w, "failed to fetch changelog", http.StatusInternalServerError)
		return
	}

	items := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		items = append(items, map[string]interface{}{
			"id":             fmt.Sprintf("%s/changelog/%s", baseURL, e.ID),
			"url":            fmt.Sprintf("%s/changelog#%s", baseURL, e.ID),
			"title":          fmt.Sprintf("[%s] %s", e.Version, e.Title),
			"content_text":   e.Body,
			"date_published": e.PublishedAt.Format(time.RFC3339),
			"tags":           []string{e.Category},
		})
	}

	feed := map[string]interface{}{
		"version":       "https://jsonfeed.org/version/1.1",
		"title":         "NDSEP Platform Changelog",
		"home_page_url": baseURL,
		"feed_url":      baseURL + "/api/changelog.json",
		"description":   "National Data Sovereignty Enforcement Platform official changelog",
		"language":      "en-NG",
		"items":         items,
	}

	w.Header().Set("Content-Type", "application/feed+json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	json.NewEncoder(w).Encode(feed)
}

// ── Webhook handlers ───────────────────────────────────────────────────────────
func subscribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		URL    string   `json:"url"`
		Events []string `json:"events"`
		Secret string   `json:"secret"`
		OrgID  string   `json:"org_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("wh_%d", time.Now().UnixNano())
	sub := WebhookSubscription{
		ID:      id,
		URL:     req.URL,
		Events:  req.Events,
		Secret:  req.Secret,
		OrgID:   req.OrgID,
		Active:  true,
		Created: time.Now().UTC().Format(time.RFC3339),
	}

	webhookMu.Lock()
	webhooks[id] = sub
	webhookMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"status":  "subscribed",
		"events":  req.Events,
	})
}

func dispatchWebhook(event string, payload interface{}) {
	webhookMu.RLock()
	subs := make([]WebhookSubscription, 0)
	for _, sub := range webhooks {
		if !sub.Active {
			continue
		}
		for _, e := range sub.Events {
			if e == event || e == "*" {
				subs = append(subs, sub)
				break
			}
		}
	}
	webhookMu.RUnlock()

	for _, sub := range subs {
		go func(s WebhookSubscription) {
			body, _ := json.Marshal(map[string]interface{}{
				"event":     event,
				"payload":   payload,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			})

			req, _ := http.NewRequest("POST", s.URL, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-NDSEP-Event", event)

			if s.Secret != "" {
				mac := hmac.New(sha256.New, []byte(s.Secret))
				mac.Write(body)
				req.Header.Set("X-NDSEP-Signature", fmt.Sprintf("sha256=%x", mac.Sum(nil)))
			}

			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				totalErrors++
				log.Printf("[RSS] Webhook dispatch to %s failed: %v", s.URL, err)
				return
			}
			resp.Body.Close()
			totalDispatched++
		}(sub)
	}
}

func triggerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Event   string      `json:"event"`
		Payload interface{} `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	go dispatchWebhook(req.Event, req.Payload)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "dispatching"})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	webhookMu.RLock()
	wCount := len(webhooks)
	webhookMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "healthy",
		"worker":            "rss_webhook_server",
		"webhook_count":     wCount,
		"total_dispatched":  totalDispatched,
		"total_errors":      totalErrors,
		"uptime_seconds":    time.Since(workerStart).Seconds(),
		"feeds":             []string{"rss", "atom", "json"},
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	log.Printf("[RSS] Starting NDSEP RSS & Webhook Feed Server on port %s", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/changelog.rss", rssHandler)
	mux.HandleFunc("/api/changelog.atom", atomHandler)
	mux.HandleFunc("/api/changelog.json", jsonFeedHandler)
	mux.HandleFunc("/api/webhooks/subscribe", subscribeHandler)
	mux.HandleFunc("/api/webhooks/trigger", triggerHandler)

	log.Printf("[RSS] RSS & Webhook Feed Server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[RSS] Server failed: %v", err)
	}
}
