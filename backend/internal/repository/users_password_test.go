package repository

import (
	"context"
	"testing"
	"time"
)

func TestChangePasswordRevokesOtherSessionsWithTheHashChange(t *testing.T) {
	conn := openPoolTestDB(t)
	users := NewUsersRepo(conn)
	ctx := context.Background()
	u, err := users.Create(ctx, "admin", "old-hash")
	if err != nil {
		t.Fatal(err)
	}
	for _, tok := range []string{"keep", "other1", "other2"} {
		if err := users.CreateSession(ctx, tok, u.ID, time.Now().Add(time.Hour), SessionMeta{}); err != nil {
			t.Fatal(err)
		}
	}

	revoked, err := users.ChangePassword(ctx, u.ID, "new-hash", "keep")
	if err != nil || revoked != 2 {
		t.Fatalf("ChangePassword = %d, %v; want 2 sessions revoked", revoked, err)
	}
	got, err := users.GetByID(ctx, u.ID)
	if err != nil || got.PasswordHash != "new-hash" {
		t.Fatalf("hash = %q, err %v", got.PasswordHash, err)
	}
	if n, _ := users.CountSessions(ctx); n != 1 {
		t.Errorf("%d sessions left, want only the current one", n)
	}
	if _, err := users.GetValidSession(ctx, "keep"); err != nil {
		t.Errorf("the current session was revoked: %v", err)
	}
}

// A user that does not exist changes nothing: no session is deleted.
func TestChangePasswordForUnknownUserTouchesNoSession(t *testing.T) {
	conn := openPoolTestDB(t)
	users := NewUsersRepo(conn)
	ctx := context.Background()
	u, err := users.Create(ctx, "admin", "old-hash")
	if err != nil {
		t.Fatal(err)
	}
	if err := users.CreateSession(ctx, "other", u.ID, time.Now().Add(time.Hour), SessionMeta{}); err != nil {
		t.Fatal(err)
	}
	if _, err := users.ChangePassword(ctx, 999, "x", "keep"); err == nil {
		t.Fatal("expected an error for an unknown user")
	}
	if n, _ := users.CountSessions(ctx); n != 1 {
		t.Errorf("%d sessions, want the untouched 1", n)
	}
}
