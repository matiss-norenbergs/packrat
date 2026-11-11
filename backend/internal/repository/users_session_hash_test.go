package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

func storedTokens(t *testing.T, users *UsersRepo) []string {
	t.Helper()
	rows, err := users.db.Query(`SELECT token FROM sessions ORDER BY id`)
	if err != nil {
		// sessions has no id column in some schemas; fall back to rowid
		rows, err = users.db.Query(`SELECT token FROM sessions ORDER BY rowid`)
		if err != nil {
			t.Fatal(err)
		}
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestSessionTokenIsStoredAsSHA256Hex(t *testing.T) {
	users := NewUsersRepo(openPoolTestDB(t))
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "h")
	raw := "raw-token-value"
	if err := users.CreateSession(ctx, raw, u.ID, time.Now().Add(time.Hour), SessionMeta{}); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(raw))
	want := hex.EncodeToString(sum[:])
	got := storedTokens(t, users)
	if len(got) != 1 || got[0] != want || got[0] == raw || len(got[0]) != 64 {
		t.Fatalf("stored token = %v, want [%s] (and never the raw token)", got, want)
	}

	s, err := users.GetValidSession(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if s.Token != raw || s.TokenHash != want {
		t.Errorf("session carries Token=%q TokenHash=%q, want raw and %q", s.Token, s.TokenHash, want)
	}
	// Presenting the hash itself (what a leaked database contains) must not authenticate.
	if _, err := users.GetValidSession(ctx, want); !errors.Is(err, ErrNotFound) {
		t.Errorf("the stored hash authenticated: %v", err)
	}
	list, _ := users.ListSessions(ctx, u.ID)
	if len(list) != 1 || list[0].Token != "" || list[0].TokenHash != want {
		t.Errorf("ListSessions leaked or lost token info: %+v", list)
	}
}

func TestRowWithRawTokenDoesNotAuthenticate(t *testing.T) {
	users := NewUsersRepo(openPoolTestDB(t))
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "h")
	if _, err := users.db.Exec(`INSERT INTO sessions (token, user_id, expires_at, public_id) VALUES ('plaintext-token', ?, datetime('now','+1 hour'), 'p1')`, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := users.GetValidSession(ctx, "plaintext-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a plaintext row authenticated: %v", err)
	}
}

func TestDeleteSessionAndOthersTakeRawTokens(t *testing.T) {
	users := NewUsersRepo(openPoolTestDB(t))
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "h")
	for _, tok := range []string{"a", "b", "c"} {
		if err := users.CreateSession(ctx, tok, u.ID, time.Now().Add(time.Hour), SessionMeta{}); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := users.DeleteOtherSessions(ctx, u.ID, "a"); err != nil || n != 2 {
		t.Fatalf("DeleteOtherSessions = %d, %v; want 2", n, err)
	}
	if _, err := users.GetValidSession(ctx, "a"); err != nil {
		t.Fatalf("kept session gone: %v", err)
	}
	if err := users.DeleteSession(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if err := users.DeleteSession(ctx, "a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete = %v, want ErrNotFound", err)
	}
}

func TestTouchSessionSlidesOnceUnderConcurrency(t *testing.T) {
	users := NewUsersRepo(openPoolTestDB(t))
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	users.SetClock(func() time.Time { return now })
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "h")
	if err := users.CreateSession(ctx, "tok", u.ID, now.Add(10*24*time.Hour), SessionMeta{}); err != nil {
		t.Fatal(err)
	}
	const n = 8
	res := make(chan bool, n)
	for i := 0; i < n; i++ {
		go func() {
			ext, err := users.TouchSession(ctx, "tok", now)
			if err != nil {
				t.Error(err)
			}
			res <- ext
		}()
	}
	extended := 0
	for i := 0; i < n; i++ {
		if <-res {
			extended++
		}
	}
	if extended != 1 {
		t.Fatalf("%d concurrent touches extended the session, want exactly 1", extended)
	}
	s, err := users.GetValidSession(ctx, "tok")
	if err != nil || !s.ExpiresAt.Equal(now.Add(SessionLifetime)) {
		t.Fatalf("expiry = %v (%v), want now+30d", s.ExpiresAt, err)
	}
}

func TestTouchSessionBoundary(t *testing.T) {
	users := NewUsersRepo(openPoolTestDB(t))
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "h")
	threshold := now.Add(SessionLifetime - SessionSlideAfter)
	for _, c := range []struct {
		tok    string
		expiry time.Time
		want   bool
	}{
		{"edge", threshold, false},                       // exactly 29 days left: not yet
		{"justUnder", threshold.Add(-time.Second), true}, // a second less: slides
		{"fresh", now.Add(SessionLifetime - time.Hour), false},
	} {
		if err := users.CreateSession(ctx, c.tok, u.ID, c.expiry, SessionMeta{}); err != nil {
			t.Fatal(err)
		}
		if got, err := users.TouchSession(ctx, c.tok, now); err != nil || got != c.want {
			t.Errorf("%s: extended = %v, %v; want %v", c.tok, got, err, c.want)
		}
	}
}
