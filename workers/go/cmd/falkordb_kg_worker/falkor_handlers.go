package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

func realFalkorHealthHandler(w http.ResponseWriter, r *http.Request) {
	if err := falkorAdapter.health(r.Context()); err != nil {
		atomicAddError()
		http.Error(w, `{"status":"unavailable","error":"FalkorDB dependency unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ready","worker":"falkordb_kg_worker","graph_backend":"falkordb","mode":"real_client_adapter","uptime_seconds":` + formatDurationSeconds(time.Since(workerStart)) + `}`))
}

type falkorQueryRequest struct {
	QueryType string `json:"query_type"`
	NodeID    string `json:"node_id"`
	Relation  string `json:"relation"`
	FromID    string `json:"from_id"`
	ToID      string `json:"to_id"`
	MaxDepth  int    `json:"max_depth"`
}

func falkorQueryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}
	if falkorAdapter == nil {
		http.Error(w, `{"error":"FalkorDB adapter unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	var req falkorQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid graph query request"}`, http.StatusBadRequest)
		return
	}
	atomic.AddInt64(&queriesRun, 1)
	w.Header().Set("Content-Type", "application/json")

	switch req.QueryType {
	case "neighbors":
		neighbors, err := falkorAdapter.neighbors(req.NodeID, req.Relation)
		if err != nil {
			writeFalkorQueryError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"node_id":   req.NodeID,
			"relation":  req.Relation,
			"neighbors": neighbors,
			"count":     len(neighbors),
		})
	case "path":
		path, err := falkorAdapter.boundedPath(req.FromID, req.ToID, req.MaxDepth)
		if err != nil {
			writeFalkorQueryError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"from":   req.FromID,
			"to":     req.ToID,
			"path":   path,
			"length": len(path),
		})
	default:
		http.Error(w, `{"error":"only neighbors and path queries are implemented against the real FalkorDB adapter"}`, http.StatusNotImplemented)
	}
}

func writeFalkorQueryError(w http.ResponseWriter, err error) {
	atomicAddError()
	message := err.Error()
	if message == "node_id is required" || message == "from_id and to_id are required" || len(message) >= 9 && message[:9] == "max_depth" || len(message) >= 8 && message[:8] == "unsupported" {
		http.Error(w, `{"error":"`+message+`"}`, http.StatusBadRequest)
		return
	}
	http.Error(w, `{"error":"FalkorDB graph query unavailable"}`, http.StatusServiceUnavailable)
}

// Rebuild remains deliberately disabled until the durable PostgreSQL snapshot and
// idempotent MERGE writer are implemented; it must never rebuild an in-memory graph.
func retiredGraphOperationHandler(w http.ResponseWriter, r *http.Request) {
	if falkorAdapter == nil {
		http.Error(w, `{"error":"FalkorDB adapter unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	if err := falkorAdapter.health(r.Context()); err != nil {
		atomicAddError()
		http.Error(w, `{"error":"FalkorDB dependency unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	http.Error(w, `{"error":"graph rebuild is disabled until durable FalkorDB snapshot writes are implemented"}`, http.StatusNotImplemented)
}

func atomicAddError() {
	atomic.AddInt64(&errors, 1)
}

func formatDurationSeconds(d time.Duration) string {
	return strconv.FormatFloat(d.Seconds(), 'f', 3, 64)
}
