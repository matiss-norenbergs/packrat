package subscriptions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

type testEnv struct {
	conn *sql.DB
	deps CheckDeps
	subs *repository.SubscriptionsRepo
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	subs := repository.NewSubscriptionsRepo(conn)
	deps := CheckDeps{
		SubscriptionsRepo: subs,
		LibraryRepo:       repository.NewLibraryRepo(conn),
		TagsRepo:          repository.NewTagsRepo(conn),
		CollectionsRepo:   repository.NewCollectionsRepo(conn),
		// A missing binary makes the best-effort thumbnail fetch fail fast.
		YtDlp: &downloader.YtDlpService{BinPath: "packrat-test-missing-yt-dlp", SettingsRepo: repository.NewSettingsRepo(conn)},
	}
	return &testEnv{conn: conn, deps: deps, subs: subs}
}

func (e *testEnv) newSub(t *testing.T, checked bool) models.Subscription {
	t.Helper()
	ctx := context.Background()
	sub := models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true}
	id, err := e.subs.Create(ctx, &sub)
	if err != nil {
		t.Fatal(err)
	}
	if checked {
		if err := e.subs.MarkChecked(ctx, id, time.Now(), nil); err != nil {
			t.Fatal(err)
		}
	}
	got, err := e.subs.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return *got
}

func (e *testEnv) count(t *testing.T, table string) int {
	t.Helper()
	var n int
	if err := e.conn.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func entriesN(n int) []downloader.PlaylistEntry {
	out := make([]downloader.PlaylistEntry, n)
	for i := range out {
		out[i] = downloader.PlaylistEntry{ID: fmt.Sprintf("v%d", i), Title: fmt.Sprintf("video %d", i), URL: fmt.Sprintf("https://example.test/v%d", i)}
	}
	return out
}

func TestClaimSeenEntryReportsInsertedOnce(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	ctx := context.Background()
	first, err := env.subs.ClaimSeenEntry(ctx, sub.ID, "a", "t", "https://example.test/a", 1)
	if err != nil || !first {
		t.Fatalf("first claim = %v, %v; want true, nil", first, err)
	}
	second, err := env.subs.ClaimSeenEntry(ctx, sub.ID, "a", "t", "https://example.test/a", 1)
	if err != nil || second {
		t.Fatalf("second claim = %v, %v; want false, nil", second, err)
	}
}

// Many callers racing over the same entries (bypassing the per-subscription
// lock, so only the claim protects them) create each ghost exactly once.
func TestProcessEntriesClaimsEachEntryOnce(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	entries := entriesN(5)

	var wg sync.WaitGroup
	var total int32
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := processEntries(context.Background(), env.deps, sub, entries, false)
			if err != nil {
				t.Error(err)
			}
			atomic.AddInt32(&total, int32(n))
		}()
	}
	wg.Wait()
	if total != 5 {
		t.Fatalf("total new = %d, want 5", total)
	}
	if got := env.count(t, "library"); got != 5 {
		t.Fatalf("ghost items = %d, want 5", got)
	}
	var unlinked int
	if err := env.conn.QueryRow("SELECT COUNT(*) FROM subscription_seen_entries WHERE library_item_id IS NULL").Scan(&unlinked); err != nil {
		t.Fatal(err)
	}
	if unlinked != 0 {
		t.Fatalf("%d seen entries without a library item", unlinked)
	}
}

func TestCheckOneConcurrentCallsCreateEachGhostOnce(t *testing.T) {
	for iter := 0; iter < 10; iter++ {
		env := newTestEnv(t)
		sub := env.newSub(t, true)
		env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
			return entriesN(3), nil
		}
		var wg sync.WaitGroup
		for i := 0; i < 4; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := CheckOne(context.Background(), env.deps, sub); err != nil && !errors.Is(err, ErrCheckInProgress) {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if got := env.count(t, "library"); got != 3 {
			t.Fatalf("iteration %d: ghost items = %d, want 3", iter, got)
		}
	}
}

func TestCheckOneRejectsWhileAnotherCheckRuns(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	entered := make(chan struct{})
	release := make(chan struct{})
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		close(entered)
		<-release
		return nil, nil
	}
	done := make(chan error, 1)
	go func() {
		_, err := CheckOne(context.Background(), env.deps, sub)
		done <- err
	}()
	<-entered
	if _, err := CheckOne(context.Background(), env.deps, sub); !errors.Is(err, ErrCheckInProgress) {
		t.Fatalf("second CheckOne err = %v, want ErrCheckInProgress", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) { return nil, nil }
	if _, err := CheckOne(context.Background(), env.deps, sub); err != nil {
		t.Fatalf("CheckOne after release: %v", err)
	}
}

func TestRunDueChecksSkipsLockedSubscription(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, false) // never checked => due
	var calls int32
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		atomic.AddInt32(&calls, 1)
		return nil, nil
	}
	if !checkLocks.TryLock(sub.ID) {
		t.Fatal("could not take the lock")
	}
	RunDueChecks(context.Background(), env.deps)
	checkLocks.Unlock(sub.ID)
	if calls != 0 {
		t.Fatalf("sweep checked a locked subscription (%d fetches)", calls)
	}
	RunDueChecks(context.Background(), env.deps)
	if calls != 1 {
		t.Fatalf("sweep fetches after unlock = %d, want 1", calls)
	}
}

func TestProcessEntriesDedupesRepeatedIDs(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	e := entriesN(2)
	entries := []downloader.PlaylistEntry{e[0], e[1], e[0]}
	n, err := processEntries(context.Background(), env.deps, sub, entries, false)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 || env.count(t, "library") != 2 || env.count(t, "subscription_seen_entries") != 2 {
		t.Fatalf("n=%d library=%d seen=%d, want 2/2/2", n, env.count(t, "library"), env.count(t, "subscription_seen_entries"))
	}
}

// A failing action leaves the entry recorded as seen with no library item,
// and the next check does not retry it.
func TestProcessEntriesFailedActionStaysRecorded(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	sub.AutoDownload = true
	sub.MediaType = "bogus" // violates downloads.download_type CHECK => enqueue fails
	env.deps.Manager = queue.NewDownloadManager("", "", "", nil, repository.NewDownloadsRepo(env.conn), nil, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	entries := entriesN(1)

	for i := 0; i < 2; i++ {
		n, err := processEntries(context.Background(), env.deps, sub, entries, false)
		if err != nil || n != 0 {
			t.Fatalf("run %d: n=%d err=%v, want 0, nil", i, n, err)
		}
	}
	var linked int
	if err := env.conn.QueryRow("SELECT COUNT(*) FROM subscription_seen_entries WHERE library_item_id IS NOT NULL").Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if env.count(t, "subscription_seen_entries") != 1 || linked != 0 || env.count(t, "downloads") != 0 {
		t.Fatalf("seen=%d linked=%d downloads=%d, want 1/0/0", env.count(t, "subscription_seen_entries"), linked, env.count(t, "downloads"))
	}
}

