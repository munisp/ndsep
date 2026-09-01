package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func withTigerBeetleTestState(t *testing.T, url string, available bool) {
	t.Helper()
	mu.Lock()
	previousURL := tigerbeetleURL
	previousOK := tigerbeetleOK
	tigerbeetleURL = url
	tigerbeetleOK = available
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		tigerbeetleURL = previousURL
		tigerbeetleOK = previousOK
		mu.Unlock()
	})
}

func TestRecordFeeEntryRejectsUnavailableLedger(t *testing.T) {
	withTigerBeetleTestState(t, "http://127.0.0.1:1", false)
	transactionID, err := recordFeeEntry("123", "registration", json.Number("1000.00"))
	if err == nil {
		t.Fatal("expected unavailable TigerBeetle ledger to return an error")
	}
	if transactionID != "" {
		t.Fatalf("expected no fabricated transaction ID, got %q", transactionID)
	}
}

func TestRecordFeeEntryRejectsNetworkFailure(t *testing.T) {
	withTigerBeetleTestState(t, "http://127.0.0.1:1", true)
	transactionID, err := recordFeeEntry("123", "registration", json.Number("1000.00"))
	if err == nil {
		t.Fatal("expected unreachable TigerBeetle endpoint to return an error")
	}
	if transactionID != "" {
		t.Fatalf("expected no fabricated transaction ID, got %q", transactionID)
	}
}

func TestRecordFeeEntryRejectsUpstreamRejectionAndMalformedSuccess(t *testing.T) {
	t.Run("rejected status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/transaction" {
				t.Fatalf("unexpected endpoint %q", r.URL.Path)
			}
			http.Error(w, `{"error":"ledger rejected transfer"}`, http.StatusBadGateway)
		}))
		defer server.Close()
		withTigerBeetleTestState(t, server.URL, true)
		transactionID, err := recordFeeEntry("123", "renewal", json.Number("1000.00"))
		if err == nil || transactionID != "" {
			t.Fatalf("expected rejected ledger request to fail without ID; id=%q err=%v", transactionID, err)
		}
	})

	t.Run("missing durable transaction id", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"accepted"}`))
		}))
		defer server.Close()
		withTigerBeetleTestState(t, server.URL, true)
		transactionID, err := recordFeeEntry("123", "renewal", json.Number("1000.00"))
		if err == nil || transactionID != "" {
			t.Fatalf("expected missing transaction ID to fail; id=%q err=%v", transactionID, err)
		}
	})
}

func TestRecordFeeEntryAcceptsOnlyDurableTransactionID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transaction" {
			t.Fatalf("unexpected endpoint %q", r.URL.Path)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["org_id"] != "123" || body["penalty_id"] != "dpco:registration:123" || body["currency"] != "NGN" || body["type"] != "fine" {
			t.Fatalf("unexpected durable ledger request: %#v", body)
		}
		if body["amount"] != float64(1000) {
			t.Fatalf("expected exact NGN amount, got %#v", body["amount"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"transaction_id":"tb-registry-123"}`))
	}))
	defer server.Close()
	withTigerBeetleTestState(t, server.URL, true)
	before := atomic.LoadInt64(&tbEntries)
	transactionID, err := recordFeeEntry("123", "registration", json.Number("1000.00"))
	if err != nil {
		t.Fatalf("expected durable TigerBeetle response to succeed: %v", err)
	}
	if transactionID != "tb-registry-123" {
		t.Fatalf("unexpected durable transaction ID %q", transactionID)
	}
	if atomic.LoadInt64(&tbEntries) != before+1 {
		t.Fatal("expected durable-entry counter to increment only after a confirmed transaction ID")
	}
}
