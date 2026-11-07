package repository

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"packrat/backend/internal/db"
)

func openRawTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return conn
}

// completesWithin runs fn and fails the test if it doesn't return in time.
func completesWithin(t *testing.T, d time.Duration, what string, fn func()) {
	t.Helper()
	done := make(chan struct{})
	go func() { fn(); close(done) }()
	select {
	case <-done:
	case <-time.After(d):
		t.Fatalf("%s did not complete within %s", what, d)
	}
}

// blocksUntil reports whether fn stays blocked until release is called and
// then completes (i.e. it really waited on the lock).
func blocksUntil(t *testing.T, fn func(), release func()) {
	t.Helper()
	done := make(chan struct{})
	go func() { fn(); close(done) }()
	select {
	case <-done:
		t.Fatal("call returned while the mutex was held elsewhere: it did not lock")
	case <-time.After(150 * time.Millisecond):
	}
	release()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("call never completed after the mutex was released")
	}
}

// A plain WithTx copy (caller does NOT hold the lock) keeps locking exactly
// as before, for all three repos.
func TestWithTx_StillLocks(t *testing.T) {
	conn := openRawTestDB(t)
	tags, artists, cols := NewTagsRepo(conn), NewArtistsRepo(conn), NewCollectionsRepo(conn)
	ctx := context.Background()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	tags.mu.Lock()
	blocksUntil(t, func() { _, _ = tags.WithTx(tx).GetOrCreateByNames(ctx, []string{"x"}) }, tags.mu.Unlock)
	artists.mu.Lock()
	blocksUntil(t, func() { _, _ = artists.WithTx(tx).Create(ctx, "x", nil) }, artists.mu.Unlock)
	cols.mu.Lock()
	blocksUntil(t, func() { _, _ = cols.WithTx(tx).EnsureChain(ctx, []string{"x"}) }, cols.mu.Unlock)
}

// A WithLockedTx copy must not touch the mutex (that would self-deadlock),
// and the mutex stays held by the lock owner throughout.
func TestWithLockedTx_DoesNotRelock(t *testing.T) {
	conn := openRawTestDB(t)
	tags, artists, cols := NewTagsRepo(conn), NewArtistsRepo(conn), NewCollectionsRepo(conn)
	ctx := context.Background()

	lk := LockForRestore(tags, artists, cols)
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}

	completesWithin(t, 5*time.Second, "tx-scoped writes under a held lock", func() {
		if _, err := tags.WithLockedTx(tx, lk).GetOrCreateByNames(ctx, []string{"a", "b"}); err != nil {
			t.Errorf("tags: %v", err)
		}
		if _, err := artists.WithLockedTx(tx, lk).Create(ctx, "art", nil); err != nil {
			t.Errorf("artists: %v", err)
		}
		if _, err := cols.WithLockedTx(tx, lk).EnsureChain(ctx, []string{"p", "c"}); err != nil {
			t.Errorf("collections: %v", err)
		}
	})

	// The owner still holds the real mutexes.
	if tags.mu.TryLock() || artists.mu.TryLock() || cols.mu.TryLock() {
		t.Fatal("a mutex was released while the restore lock was held")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	lk.Unlock()
	lk.Unlock() // idempotent

	for name, mu := range map[string]*sync.Mutex{"tags": tags.mu, "artists": artists.mu, "collections": cols.mu} {
		if !mu.TryLock() {
			t.Fatalf("%s mutex still held after Unlock", name)
		}
		mu.Unlock()
	}
}

func TestWithLockedTx_PanicsWithoutLock(t *testing.T) {
	conn := openRawTestDB(t)
	tags := NewTagsRepo(conn)
	other := NewTagsRepo(conn)
	lk := LockForRestore(other, nil, nil)
	defer lk.Unlock()

	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	defer func() {
		if recover() == nil {
			t.Fatal("WithLockedTx with a lock that doesn't cover the repo should panic")
		}
	}()
	tags.WithLockedTx(tx, lk)
}

// Callers that use plain WithTx without holding the lock still serialize
// correctly and never create duplicates.
func TestWithTx_ConcurrentCallersNoDuplicates(t *testing.T) {
	conn := openRawTestDB(t)
	tags, cols := NewTagsRepo(conn), NewCollectionsRepo(conn)
	ctx := context.Background()

	completesWithin(t, 20*time.Second, "concurrent WithTx callers", func() {
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				tx, err := conn.BeginTx(ctx, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer tx.Rollback()
				if _, err := tags.WithTx(tx).GetOrCreateByNames(ctx, []string{"t1", "t2", "t3"}); err != nil {
					t.Error(err)
					return
				}
				if _, err := cols.WithTx(tx).EnsureChain(ctx, []string{"r", "s"}); err != nil {
					t.Error(err)
					return
				}
				if err := tx.Commit(); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
	})

	list, _ := tags.List(ctx)
	if len(list) != 3 {
		t.Fatalf("got %d tags, want 3", len(list))
	}
	all, _ := cols.List(ctx)
	if len(all) != 2 {
		t.Fatalf("got %d collections, want 2", len(all))
	}
}
