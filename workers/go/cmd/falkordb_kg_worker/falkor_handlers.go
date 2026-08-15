package main

import (
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
	http.Error(w, `{"error":"graph endpoint is disabled until parameterized FalkorDB query handlers are implemented"}`, http.StatusNotImplemented)
}

func atomicAddError() {
	atomic.AddInt64(&errors, 1)
}

func formatDurationSeconds(d time.Duration) string {
	return strconv.FormatFloat(d.Seconds(), 'f', 3, 64)
}
