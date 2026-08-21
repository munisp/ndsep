package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestLoadConfigRequiresArkimeCredentials(t *testing.T) {
	t.Setenv("ARKIME_URL", "")
	t.Setenv("ARKIME_AUTHORIZATION", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected missing Arkime configuration to fail")
	}
}

func TestArkimeSessionsUsesAuthorizedViewerResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sessions" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-arkime-token" {
			t.Fatalf("missing authorization header")
		}
		if got := r.URL.Query().Get("length"); got != "25" {
			t.Fatalf("expected length 25, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"authoritative-session"}]}`))
	}))
	defer server.Close()

	t.Setenv("ARKIME_URL", server.URL)
	t.Setenv("ARKIME_AUTHORIZATION", "Bearer test-arkime-token")
	t.Setenv("PORT", "8142")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	client := newArkimeClient(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	sessions, err := client.sessions(ctx, 25, 0, "ip.src == 203.0.113.5")
	if err != nil {
		t.Fatal(err)
	}
	if string(sessions) != `[{"id":"authoritative-session"}]` {
		t.Fatalf("unexpected upstream session payload: %s", sessions)
	}
	_ = os.Unsetenv("NODE_ENV")
}
