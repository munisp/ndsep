package main

import (
  "encoding/json"
  "log"
  "net/http"
  "os"
  "time"
)

type HealthResponse struct {
  Service string `json:"service"`
  Language string `json:"language"`
  Middleware []string `json:"middleware"`
  Status string `json:"status"`
  Mode string `json:"mode"`
  Disclaimer string `json:"disclaimer"`
  Timestamp string `json:"timestamp"`
}
type PermitEvent struct { CaseID string `json:"caseId"`; Sector string `json:"sector"`; Stage string `json:"stage"`; UpdatedAt string `json:"updatedAt"` }
func writeJSON(w http.ResponseWriter, status int, payload any) { w.Header().Set("Content-Type", "application/json"); w.WriteHeader(status); _ = json.NewEncoder(w).Encode(payload) }
func emulatorEnabled() bool { return os.Getenv("IDLR_EMULATOR_MODE") == "true" }
func healthHandler(w http.ResponseWriter, _ *http.Request) {
  emulator := emulatorEnabled(); status, mode := "unconfigured", "fail_closed"; if emulator { status, mode = "emulator", "development_only" }
  writeJSON(w, http.StatusOK, HealthResponse{Service:"go-event-gateway", Language:"go", Middleware:[]string{"kafka", "redis", "tigerbeetle"}, Status:status, Mode:mode, Disclaimer:"This service does not prove a Kafka, Redis, TigerBeetle, or production event-delivery connection.", Timestamp:time.Now().UTC().Format(time.RFC3339)})
}
func publishPermitEventHandler(w http.ResponseWriter, r *http.Request) {
  if r.Method != http.MethodPost { writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error":"method_not_allowed"}); return }
  if !emulatorEnabled() { writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error":"event_broker_unconfigured", "detail":"Set IDLR_EMULATOR_MODE=true only for labelled local simulation; configure a real broker for production."}); return }
  var event PermitEvent
  if err := json.NewDecoder(r.Body).Decode(&event); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"error":"invalid_json"}); return }
  if event.CaseID == "" || event.Stage == "" { writeJSON(w, http.StatusBadRequest, map[string]string{"error":"missing_case_data"}); return }
  writeJSON(w, http.StatusAccepted, map[string]any{"accepted":true, "mode":"development_emulator", "publishedTo":[]string{"local_emulator_only"}, "disclaimer":"No Kafka, Redis, TigerBeetle, or settlement event was contacted.", "event":event})
}
func main() { mux := http.NewServeMux(); mux.HandleFunc("/health", healthHandler); mux.HandleFunc("/publish/permit-case", publishPermitEventHandler); server := &http.Server{Addr:":8091", Handler:mux, ReadHeaderTimeout:5*time.Second}; log.Println("go-event-gateway listening on :8091"); log.Fatal(server.ListenAndServe()) }
