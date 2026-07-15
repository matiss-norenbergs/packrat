package jellyfin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRefreshFull(t *testing.T) {
	var gotMethod, gotPath, gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Emby-Token")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient()
	if err := c.RefreshFull(context.Background(), srv.URL, "secret"); err != nil {
		t.Fatalf("RefreshFull: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/Library/Refresh" {
		t.Errorf("path = %q, want /Library/Refresh", gotPath)
	}
	if gotToken != "secret" {
		t.Errorf("token = %q, want secret", gotToken)
	}
}

func TestRefreshItem(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient()
	if err := c.RefreshItem(context.Background(), srv.URL, "secret", "abc-123"); err != nil {
		t.Fatalf("RefreshItem: %v", err)
	}
	if gotPath != "/Items/abc-123/Refresh" {
		t.Errorf("path = %q, want /Items/abc-123/Refresh", gotPath)
	}
}

func TestRefreshFullErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient()
	if err := c.RefreshFull(context.Background(), srv.URL, "wrong"); err == nil {
		t.Fatal("expected an error for a 401 response, got nil")
	}
}

func TestRefreshFullDNSFailureMessage(t *testing.T) {
	c := NewClient()
	err := c.RefreshFull(context.Background(), "http://this-host-does-not-exist.invalid", "secret")
	if err == nil {
		t.Fatal("expected an error for an unresolvable hostname, got nil")
	}
	if !strings.Contains(err.Error(), "could not resolve") {
		t.Fatalf("expected a DNS-specific error message, got: %v", err)
	}
}
