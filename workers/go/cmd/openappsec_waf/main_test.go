package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRelayEventDeliversExactSignedPayload(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	accepted := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("X-NDSEP-Worker-ID"); got != workerID {
			t.Fatalf("worker ID = %q, want %q", got, workerID)
		}
		var payload map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode relay body: %v", err)
		}
		if string(payload["event"]) != `"waf_event"` {
			t.Fatalf("event = %s, want waf_event", payload["event"])
		}
		accepted <- struct{}{}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	t.Setenv("APP_ENV", "test")
	if err := relayEvent(server.URL, secret, WAFEvent{
		ID: "waf-test-1", Timestamp: time.Now().UTC(), SourceIP: "198.51.100.7",
		Path: "/api/test", Action: "block", Threat: "sqli", Severity: "high",
	}); err != nil {
		t.Fatalf("relayEvent returned error: %v", err)
	}
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("relay endpoint did not receive signed payload")
	}
}

func TestWorkerEventSignatureBindsExactPayload(t *testing.T) {
	payload := []byte(`{"event":"waf_event","data":{"id":"one"}}`)
	secret := "0123456789abcdef0123456789abcdef"
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce := strings.Repeat("a", 48)
	signature := signWorkerEvent(secret, timestamp, nonce, payload)

	bodyHash := sha256.Sum256(payload)
	material := strings.Join([]string{workerEventSignatureVersion, workerID, timestamp, nonce, hex.EncodeToString(bodyHash[:])}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(material))
	if signature != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal("signature does not match documented NDSEP worker-event protocol")
	}
	if signature == signWorkerEvent(secret, timestamp, nonce, []byte(`{"event":"waf_event","data":{"id":"two"}}`)) {
		t.Fatal("signature must change when exact payload bytes change")
	}
}

func TestProductionRelayRejectsPlaintextEndpoint(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	if _, err := validateRelayURL("http://worker-api.internal/api/workers/event"); err == nil {
		t.Fatal("production relay accepted plaintext HTTP endpoint")
	}
	if _, err := validateRelayURL("https://worker-api.internal/api/workers/event"); err != nil {
		t.Fatalf("production relay rejected HTTPS endpoint: %v", err)
	}
}
