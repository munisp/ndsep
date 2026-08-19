package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
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
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
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
	case "node":
		node, err := falkorAdapter.node(req.NodeID)
		if err != nil {
			writeFalkorQueryError(w, err)
			return
		}
		if node == nil {
			writeFalkorJSONError(w, http.StatusNotFound, "graph node not found")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"node": node})
	case "stats":
		stats, err := falkorAdapter.stats()
		if err != nil {
			writeFalkorQueryError(w, err)
			return
		}
		_ = json.NewEncoder(w).Encode(stats)
	default:
		http.Error(w, `{"error":"supported query types are neighbors, path, node, and stats"}`, http.StatusNotImplemented)
	}
}

func writeFalkorQueryError(w http.ResponseWriter, err error) {
	atomicAddError()
	message := err.Error()
	if message == "node_id is required" || message == "from_id is required" || message == "to_id is required" || len(message) >= 9 && message[:9] == "max_depth" || len(message) >= 8 && message[:8] == "unsupported" || len(message) >= 7 && (message[:7] == "node_id" || message[:7] == "from_id" || message[:5] == "to_id") {
		writeFalkorJSONError(w, http.StatusBadRequest, message)
		return
	}
	writeFalkorJSONError(w, http.StatusServiceUnavailable, "FalkorDB graph query unavailable")
}

func writeFalkorJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// falkorRebuildHandler materializes the bounded PostgreSQL source snapshot into
// the real FalkorDB graph. It is disabled unless explicitly enabled by deployment
// configuration because it replaces the complete NDSEP-labelled graph snapshot.
func falkorRebuildHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeFalkorJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if os.Getenv("FALKORDB_REBUILD_ENABLED") != "true" {
		writeFalkorJSONError(w, http.StatusForbidden, "FalkorDB rebuild is disabled by configuration")
		return
	}
	if falkorAdapter == nil {
		writeFalkorJSONError(w, http.StatusServiceUnavailable, "FalkorDB adapter unavailable")
		return
	}
	if dbURL == "" {
		writeFalkorJSONError(w, http.StatusServiceUnavailable, "PostgreSQL source is not configured")
		return
	}
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		atomicAddError()
		writeFalkorJSONError(w, http.StatusServiceUnavailable, "PostgreSQL source unavailable")
		return
	}
	defer db.Close()
	if err := db.PingContext(r.Context()); err != nil {
		atomicAddError()
		writeFalkorJSONError(w, http.StatusServiceUnavailable, "PostgreSQL source unavailable")
		return
	}
	stats, err := falkorAdapter.rebuildFromPostgres(db)
	if err != nil {
		atomicAddError()
		writeFalkorQueryError(w, err)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "rebuilt", "nodes": stats.Nodes, "relationships": stats.Relationships, "rebuilt_at": lastBuildTime,
	})
}

func atomicAddError() {
	atomic.AddInt64(&errors, 1)
}

func formatDurationSeconds(d time.Duration) string {
	return strconv.FormatFloat(d.Seconds(), 'f', 3, 64)
}
