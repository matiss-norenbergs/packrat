package subscriptions

import (
	"context"
	"errors"
	"testing"
	"time"

	"packrat/backend/internal/downloader"
)

func lastCheckError(t *testing.T, env *testEnv, id int64) *string {
	t.Helper()
	var s *string
	if err := env.conn.QueryRow("SELECT last_check_error FROM subscriptions WHERE id = ?", id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// A failed fetch must not stamp a never-baselined subscription as checked:
// the next attempt still baselines it instead of acting on the back catalog.
func TestFailedFetchKeepsNeverBaselinedSubscriptionUnbaselined(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, false)
	ctx := context.Background()
	failing := true
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		if failing {
			return nil, errors.New("network down")
		}
		return entriesN(5), nil
	}

	if _, err := CheckOne(ctx, env.deps, sub); err == nil {
		t.Fatal("expected the fetch error")
	}
	got, _ := env.subs.Get(ctx, sub.ID)
	if got.LastCheckedAt != nil {
		t.Fatalf("last_checked_at = %v, want still NULL", got.LastCheckedAt)
	}
	if e := lastCheckError(t, env, sub.ID); e == nil || *e == "" {
		t.Fatal("the error text was not stored")
	}

	failing = false
	n, err := CheckOne(ctx, env.deps, sub)
	if err != nil || n != 0 {
		t.Fatalf("healing run: n=%d err=%v", n, err)
	}
	if env.count(t, "subscription_seen_entries") != 5 || env.count(t, "library") != 0 || env.count(t, "downloads") != 0 {
		t.Fatal("healing run must record the entries as seen without acting")
	}
	got, _ = env.subs.Get(ctx, sub.ID)
	if got.LastCheckedAt == nil {
		t.Fatal("healing run must set last_checked_at")
	}
	if e := lastCheckError(t, env, sub.ID); e != nil {
		t.Fatalf("error should be cleared after a good run, got %q", *e)
	}
}

// A subscription that has been checked before keeps today's behavior: a
// failing URL still gets last_checked_at and the error.
func TestFailedFetchOnCheckedSubscriptionStillStampsIt(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	old := time.Now().Add(-48 * time.Hour).UTC()
	if err := env.subs.MarkChecked(context.Background(), sub.ID, old, nil); err != nil {
		t.Fatal(err)
	}
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		return nil, errors.New("dead url")
	}
	if _, err := CheckOne(context.Background(), env.deps, sub); err == nil {
		t.Fatal("expected the fetch error")
	}
	got, _ := env.subs.Get(context.Background(), sub.ID)
	if got.LastCheckedAt == nil || !got.LastCheckedAt.After(old.Add(time.Hour)) {
		t.Fatalf("last_checked_at = %v, want updated to now", got.LastCheckedAt)
	}
	if e := lastCheckError(t, env, sub.ID); e == nil {
		t.Fatal("the error text was not stored")
	}
}

// Cancelling the context between a claim and its action releases the claim
// and stops; a later check with a live context then acts on each entry once.
func TestCancelledActionReleasesClaimAndStops(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		return entriesN(3), nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	claims := 0
	env.deps.afterClaim = func(string) {
		claims++
		cancel() // the client went away right after the first claim
	}
	if _, err := CheckOne(ctx, env.deps, sub); !errors.Is(err, context.Canceled) {
		t.Fatalf("CheckOne err = %v, want context.Canceled", err)
	}
	if claims != 1 {
		t.Fatalf("claimed %d entries, want processing to stop after the first", claims)
	}
	if n := env.count(t, "subscription_seen_entries"); n != 0 {
		t.Fatalf("seen rows after cancellation = %d, want 0 (claim released, later entries unclaimed)", n)
	}
	if env.count(t, "library") != 0 {
		t.Fatal("nothing should have been created")
	}

	env.deps.afterClaim = nil
	n, err := CheckOne(context.Background(), env.deps, sub)
	if err != nil || n != 3 {
		t.Fatalf("second check: n=%d err=%v, want 3", n, err)
	}
	if env.count(t, "library") != 3 || env.count(t, "subscription_seen_entries") != 3 {
		t.Fatalf("library=%d seen=%d, want 3/3", env.count(t, "library"), env.count(t, "subscription_seen_entries"))
	}
}

// ReleaseSeenEntryClaim only removes rows that were never linked.
func TestReleaseSeenEntryClaimNeverRemovesLinkedRow(t *testing.T) {
	env := newTestEnv(t)
	sub := env.newSub(t, true)
	ctx := context.Background()

	if _, err := processEntries(ctx, env.deps, sub, entriesN(1), false); err != nil {
		t.Fatal(err)
	}
	released, err := env.subs.ReleaseSeenEntryClaim(ctx, sub.ID, "v0")
	if err != nil || released {
		t.Fatalf("release of a linked row = %v, %v; want false, nil", released, err)
	}
	if env.count(t, "subscription_seen_entries") != 1 {
		t.Fatal("a linked row must survive")
	}

	if ok, err := env.subs.ClaimSeenEntry(ctx, sub.ID, "bare", "t", "https://example.test/bare", 0); err != nil || !ok {
		t.Fatal("claim failed")
	}
	released, err = env.subs.ReleaseSeenEntryClaim(ctx, sub.ID, "bare")
	if err != nil || !released {
		t.Fatalf("release of an unlinked row = %v, %v; want true, nil", released, err)
	}
}
