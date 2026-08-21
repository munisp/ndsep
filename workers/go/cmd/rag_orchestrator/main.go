// NDSEP RAG Orchestrator (Go)
// ============================
// Orchestrates the Retrieval-Augmented Generation pipeline for the
// AI Compliance Advisor. Coordinates:
//   1. Query routing (Qdrant semantic search → EPR-KGQA → Ollama LLM)
//   2. Context assembly from multiple sources
//   3. Answer generation with citations
//   4. Response caching (in-memory LRU)
//   5. Streaming SSE responses to frontend
//
// Pipeline:
//   User Question → Entity Extraction → Qdrant Retrieval
//                → FalkorDB Graph Query → Context Assembly
//                → Ollama LLM Generation → Cited Answer
//
// Technology: Go · net/http · SSE streaming
// Port: 8211
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Configuration ──────────────────────────────────────────────────────────────
var (
	qdrantWorkerURL = getEnv("QDRANT_WORKER_URL", "http://localhost:8200")
	kgqaWorkerURL   = getEnv("KGQA_WORKER_URL", "http://localhost:8202")
	ollamaWorkerURL = getEnv("OLLAMA_WORKER_URL", "http://localhost:8203")
	falkorWorkerURL = getEnv("FALKOR_WORKER_URL", "http://localhost:8210")
	relayURL        = getEnv("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
	port            = getEnv("RAG_PORT", "8211")
	workerStart     = time.Now()
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────
type CacheEntry struct {
	Answer    string
	Sources   []map[string]interface{}
	CreatedAt time.Time
}

type LRUCache struct {
	mu      sync.RWMutex
	entries map[string]CacheEntry
	maxSize int
}

func newLRUCache(size int) *LRUCache {
	return &LRUCache{entries: make(map[string]CacheEntry), maxSize: size}
}

func (c *LRUCache) Get(key string) (CacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[key]
	if ok && time.Since(e.CreatedAt) > 10*time.Minute {
		return CacheEntry{}, false
	}
	return e, ok
}

func (c *LRUCache) Set(key string, entry CacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= c.maxSize {
		// Evict oldest
		var oldest string
		var oldestTime time.Time
		for k, v := range c.entries {
			if oldest == "" || v.CreatedAt.Before(oldestTime) {
				oldest = k
				oldestTime = v.CreatedAt
			}
		}
		delete(c.entries, oldest)
	}
	c.entries[key] = entry
}

var cache = newLRUCache(100)

// ── State ──────────────────────────────────────────────────────────────────────
var (
	totalQueries  int64
	cacheHits     int64
	errors        int64
	mu            sync.Mutex
)

// ── HTTP helpers ───────────────────────────────────────────────────────────────
func postJSON(url string, payload interface{}) (map[string]interface{}, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

func getJSON(url string) (map[string]interface{}, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

// ── RAG Pipeline ───────────────────────────────────────────────────────────────
type RAGResult struct {
	Question    string                   `json:"question"`
	Answer      string                   `json:"answer"`
	Sources     []map[string]interface{} `json:"sources"`
	GraphData   []map[string]interface{} `json:"graph_data"`
	CacheHit    bool                     `json:"cache_hit"`
	ElapsedMs   int64                    `json:"elapsed_ms"`
	Timestamp   string                   `json:"timestamp"`
	Pipeline    []string                 `json:"pipeline"`
}

func runRAGPipeline(question string) RAGResult {
	start := time.Now()
	mu.Lock()
	totalQueries++
	mu.Unlock()

	// Check cache
	if cached, ok := cache.Get(question); ok {
		mu.Lock()
		cacheHits++
		mu.Unlock()
		return RAGResult{
			Question:  question,
			Answer:    cached.Answer,
			Sources:   cached.Sources,
			CacheHit:  true,
			ElapsedMs: time.Since(start).Milliseconds(),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Pipeline:  []string{"cache"},
		}
	}

	pipeline := []string{}
	var sources []map[string]interface{}
	var graphData []map[string]interface{}
	answer := ""

	// Step 1: Qdrant semantic retrieval
	qdrantResult, err := postJSON(qdrantWorkerURL+"/rag", map[string]string{"query": question})
	if err == nil {
		pipeline = append(pipeline, "qdrant_retrieval")
		if results, ok := qdrantResult["results"].([]interface{}); ok {
			for _, r := range results {
				if rm, ok := r.(map[string]interface{}); ok {
					sources = append(sources, rm)
				}
			}
		}
	}

	// Step 2: EPR-KGQA graph traversal
	kgqaResult, err := postJSON(kgqaWorkerURL+"/ask", map[string]string{"question": question})
	if err == nil {
		pipeline = append(pipeline, "kgqa_graph")
		if gd, ok := kgqaResult["graph_results"].([]interface{}); ok {
			for _, g := range gd {
				if gm, ok := g.(map[string]interface{}); ok {
					graphData = append(graphData, gm)
				}
			}
		}
		if a, ok := kgqaResult["answer"].(string); ok && a != "" {
			answer = a
		}
	}

	// Step 3: FalkorDB graph query for entity relationships
	// Extract potential org name from question for graph lookup
	orgName := extractOrgName(question)
	if orgName != "" {
		falkorResult, err := postJSON(falkorWorkerURL+"/query", map[string]interface{}{
			"query_type": "neighbors",
			"node_id":    "org:" + orgName,
			"relation":   "HAS_VIOLATION",
		})
		if err == nil {
			pipeline = append(pipeline, "falkordb_graph")
			if neighbors, ok := falkorResult["neighbors"].([]interface{}); ok {
				for _, n := range neighbors {
					if nm, ok := n.(map[string]interface{}); ok {
						graphData = append(graphData, nm)
					}
				}
			}
		}
	}

	// Step 4: Ollama LLM generation with assembled context
	if answer == "" || len(sources) > 0 {
		contextParts := []string{}
		for _, s := range sources {
			if payload, ok := s["payload"].(map[string]interface{}); ok {
				text := ""
				if t, ok := payload["text"].(string); ok {
					text = t
				} else if t, ok := payload["chunk_text"].(string); ok {
					text = t
				}
				if text != "" {
					source := ""
					if src, ok := payload["source"].(string); ok {
						source = src
					}
					contextParts = append(contextParts, fmt.Sprintf("[%s] %s", source, text[:min(300, len(text))]))
				}
			}
		}
		context := strings.Join(contextParts, "\n\n")

		ollamaResult, err := postJSON(ollamaWorkerURL+"/compliance-qa", map[string]string{
			"question": question,
			"context":  context,
		})
		if err == nil {
			pipeline = append(pipeline, "ollama_llm")
			if resp, ok := ollamaResult["response"].(string); ok && resp != "" {
				answer = resp
			}
		}
	}

	// Fallback answer
	if answer == "" {
		answer = buildFallbackAnswer(question, sources, graphData)
		pipeline = append(pipeline, "fallback")
	}

	result := RAGResult{
		Question:  question,
		Answer:    answer,
		Sources:   sources,
		GraphData: graphData,
		CacheHit:  false,
		ElapsedMs: time.Since(start).Milliseconds(),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Pipeline:  pipeline,
	}

	// Cache result
	cache.Set(question, CacheEntry{
		Answer:    answer,
		Sources:   sources,
		CreatedAt: time.Now(),
	})

	return result
}

func extractOrgName(question string) string {
	// Simple heuristic: look for capitalized words that might be org names
	words := strings.Fields(question)
	for i, word := range words {
		if len(word) > 3 && word[0] >= 'A' && word[0] <= 'Z' {
			// Check if next word is also capitalized (multi-word org name)
			if i+1 < len(words) && len(words[i+1]) > 2 && words[i+1][0] >= 'A' && words[i+1][0] <= 'Z' {
				return word + " " + words[i+1]
			}
			return word
		}
	}
	return ""
}

func buildFallbackAnswer(question string, sources []map[string]interface{}, graphData []map[string]interface{}) string {
	if len(sources) == 0 && len(graphData) == 0 {
		return "I could not find specific information to answer this question. Please consult the NDPA 2023 directly or contact the NDPC at info@ndpc.gov.ng."
	}

	parts := []string{"Based on the available compliance data:\n"}
	for i, s := range sources {
		if i >= 3 {
			break
		}
		if payload, ok := s["payload"].(map[string]interface{}); ok {
			if text, ok := payload["text"].(string); ok && text != "" {
				parts = append(parts, "• "+text[:min(200, len(text))])
			}
		}
	}
	return strings.Join(parts, "\n")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ── HTTP Handlers ──────────────────────────────────────────────────────────────
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	mu.Lock()
	tq := totalQueries
	ch := cacheHits
	errs := errors
	mu.Unlock()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "healthy",
		"worker":          "rag_orchestrator",
		"total_queries":   tq,
		"cache_hits":      ch,
		"cache_hit_rate":  fmt.Sprintf("%.1f%%", safeDiv(float64(ch), float64(tq))*100),
		"errors":          errs,
		"uptime_seconds":  time.Since(workerStart).Seconds(),
		"pipeline_stages": []string{"qdrant_retrieval", "kgqa_graph", "falkordb_graph", "ollama_llm"},
	})
}

func safeDiv(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

func askHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Question string `json:"question"`
		Stream   bool   `json:"stream"`
	}
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil || req.Question == "" {
		http.Error(w, "question required", http.StatusBadRequest)
		return
	}

	result := runRAGPipeline(req.Question)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Question string `json:"question"`
	}
	body, _ := io.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Stream pipeline stages
	stages := []string{"Searching knowledge base...", "Querying compliance graph...", "Generating answer..."}
	for _, stage := range stages {
		fmt.Fprintf(w, "data: %s\n\n", jsonStr(map[string]string{"stage": stage}))
		flusher.Flush()
		time.Sleep(500 * time.Millisecond)
	}

	result := runRAGPipeline(req.Question)
	fmt.Fprintf(w, "data: %s\n\n", jsonStr(map[string]interface{}{
		"done":   true,
		"result": result,
	}))
	flusher.Flush()
}

func jsonStr(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// ── Main ───────────────────────────────────────────────────────────────────────
func main() {
	log.Printf("[RAG] Starting NDSEP RAG Orchestrator on port %s", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/ask", askHandler)
	mux.HandleFunc("/stream", streamHandler)

	log.Printf("[RAG] RAG Orchestrator listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[RAG] Server failed: %v", err)
	}
}
