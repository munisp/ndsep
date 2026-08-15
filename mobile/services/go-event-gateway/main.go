package main

import (
  "encoding/json"
  "log"
  "net/http"
  "time"
)

type HealthResponse struct {
  Service    string   `json:"service"`
  Language   string   `json:"language"`
  Middleware []string `json:"middleware"`
  Status     string   `json:"status"`
  Timestamp  string   `json:"timestamp"`
}

type PermitEvent struct {
  CaseID    string `json:"caseId"`
  Sector    string `json:"sector"`
  Stage     string `json:"stage"`
  UpdatedAt string `json:"updatedAt"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
  w.Header().Set("Content-Type", "application/json")
  w.WriteHeader(status)
  _ = json.NewEncoder(w).Encode(payload)
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
  writeJSON(w, http.StatusOK, HealthResponse{
    Service:    "go-event-gateway",
    Language:   "go",
    Middleware: []string{"kafka", "redis", "tigerbeetle"},
    Status:     "healthy",
    Timestamp:  time.Now().UTC().Format(time.RFC3339),
  })
}

func publishPermitEventHandler(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost {
    writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
    return
  }

  var event PermitEvent
  if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
    return
  }

  if event.CaseID == "" || event.Stage == "" {
    writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_case_data"})
    return
  }

  writeJSON(w, http.StatusAccepted, map[string]any{
    "accepted":   true,
    "publishedTo": []string{"kafka", "redis"},
    "event":      event,
  })
}

func main() {
  mux := http.NewServeMux()
  mux.HandleFunc("/health", healthHandler)
  mux.HandleFunc("/publish/permit-case", publishPermitEventHandler)

  server := &http.Server{
    Addr:              ":8091",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
  }

  log.Println("go-event-gateway listening on :8091")
  log.Fatal(server.ListenAndServe())
}
