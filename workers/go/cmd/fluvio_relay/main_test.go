package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFluvioProduceRejectsUnknownTopic(t *testing.T) {
	t.Setenv("APP_ENV", "test")
	if err := fluvioProduce("unapproved.topic", "key", map[string]string{"event_id": "evt-1"}); err == nil {
		t.Fatal("unapproved topic was accepted")
	}
}

func TestFluvioProduceRejectsPlaintextProductionEndpoint(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("FLUVIO_ENABLED", "true")
	t.Setenv("FLUVIO_AUTH_TOKEN", "test-token")
	t.Setenv("FLUVIO_PRODUCE_URL", "http://fluvio.internal/api/v1/produce")
	if err := fluvioProduce(NdsepTopics[0], "key", map[string]string{"event_id": "evt-2"}); err == nil {
		t.Fatal("production relay accepted plaintext Fluvio endpoint")
	}
}

func TestHandleProduceDeliversPayloadToApprovedEndpoint(t *testing.T) {
	received := make(chan map[string]interface{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if got := r.Header.Get("X-Fluvio-Key"); got != "event-3" {
			t.Fatalf("Fluvio key = %q, want event-3", got)
		}
		var value map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&value); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		received <- value
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()

	t.Setenv("APP_ENV", "test")
	t.Setenv("FLUVIO_PRODUCE_URL", upstream.URL)
	request := httptest.NewRequest(http.MethodPost, "/publish", strings.NewReader(`{"topic":"ndsep.compliance.events","key":"event-3","payload":{"event_id":"evt-3","severity":"high"}}`))
	response := httptest.NewRecorder()
	handleProduce(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	select {
	case payload := <-received:
		if payload["event_id"] != "evt-3" || payload["severity"] != "high" {
			t.Fatalf("upstream payload missing event data: %#v", payload)
		}
		if payload["_ndsep_topic"] != "ndsep.compliance.events" {
			t.Fatalf("upstream payload missing NDSEP topic metadata: %#v", payload)
		}
	default:
		t.Fatal("approved event was not delivered upstream")
	}
}

func TestTopicCreateIsDisabled(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/topics/create", strings.NewReader(`{"name":"ndsep.compliance.events"}`))
	response := httptest.NewRecorder()
	handleTopicCreate(response, request)
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("topic creation status = %d, want 501", response.Code)
	}
}
