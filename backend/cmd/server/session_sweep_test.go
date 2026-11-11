package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/bgtasks"
	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

func newSessionsTestRepo(t *testing.T) *repository.UsersRepo {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "p.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	return repository.NewUsersRepo(conn)
}

func countSessions(t *testing.T, r *repository.UsersRepo) int {
	t.Helper()
	n, err := r.CountSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func seedSessions(t *testing.T, r *repository.UsersRepo) {
	t.Helper()
	ctx := context.Background()
	u, err := r.Create(ctx, "admin", "h")
	if err != nil {
		t.Fatal(err)
	}
	for tok, at := range map[string]time.Time{
		"old1": time.Now().Add(-time.Hour), "old2": time.Now().Add(-48 * time.Hour), "live": time.Now().Add(time.Hour),
	} {
		if err := r.CreateSession(ctx, tok, u.ID, at, repository.SessionMeta{}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDeleteExpiredSessionsKeepsLiveOnes(t *testing.T) {
	r := newSessionsTestRepo(t)
	seedSessions(t, r)
	revoked := false
	r.SetOnSessionsRevoked(func() { revoked = true })
	n, err := r.DeleteExpiredSessions(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("DeleteExpiredSessions = %d, %v; want 2", n, err)
	}
	if _, err := r.GetValidSession(context.Background(), "live"); err != nil || countSessions(t, r) != 1 {
		t.Fatalf("live session lost (err %v, %d rows)", err, countSessions(t, r))
	}
	if revoked {
		t.Error("expired rows must not trigger onSessionsRevoked")
	}
}

func TestSessionSweepRunsAtStartupThenOnEachTickAndStopsOnShutdown(t *testing.T) {
	r := newSessionsTestRepo(t)
	seedSessions(t, r)
	ctx, cancel := context.WithCancel(context.Background())
	tasks := &bgtasks.Tracker{}
	tasks.Go(func() { runSessionSweep(ctx, r, 20*time.Millisecond) })

	waitFor(t, func() bool { return countSessions(t, r) == 1 }, "startup sweep")
	// A row that expires later is picked up by a following tick.
	u, _ := r.First(context.Background())
	if err := r.CreateSession(context.Background(), "late", u.ID, time.Now().Add(-time.Second), repository.SessionMeta{}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return countSessions(t, r) == 1 }, "periodic sweep")

	cancel()
	if !tasks.Wait(5 * time.Second) {
		t.Fatalf("sweep still running after shutdown (%d tasks)", tasks.Running())
	}
}

func waitFor(t *testing.T, ok func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

type fakeDeleter struct {
	calls atomic.Int32
	n     int64
	err   error
}

func (f *fakeDeleter) DeleteExpiredSessions(context.Context) (int64, error) {
	f.calls.Add(1)
	return f.n, f.err
}

func captureLog(t *testing.T) *bytes.Buffer {
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestSessionSweepLogging(t *testing.T) {
	ctx := context.Background()

	buf := captureLog(t)
	sweepExpiredSessions(ctx, &fakeDeleter{n: 0})
	if buf.Len() != 0 {
		t.Errorf("nothing removed must log nothing, got %q", buf)
	}
	sweepExpiredSessions(ctx, &fakeDeleter{n: 3})
	if !strings.Contains(buf.String(), "removed 3 expired session") {
		t.Errorf("count not logged: %q", buf)
	}

	buf.Reset()
	sweepExpiredSessions(ctx, &fakeDeleter{err: errors.New("database is locked (5) (SQLITE_BUSY)")})
	if got := buf.String(); strings.Count(got, "\n") != 1 || !strings.Contains(got, "busy") {
		t.Errorf("a busy database must log exactly one line: %q", got)
	}
}
