package subscriptions

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

func subEvents(t *testing.T, env *testEnv) []string {
	t.Helper()
	repo := repository.NewSystemEventsRepo(env.conn)
	items, _, err := repo.Query(context.Background(), repository.SystemEventQuery{Sort: "createdAt"})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, it := range items {
		if it.Category != sysevents.CategorySubscription {
			t.Fatalf("unexpected category %q", it.Category)
		}
		out = append(out, it.Level+": "+it.Message+" "+string(it.Details))
	}
	return out
}

// OK -> failing records once, repeated failures do not, failing -> OK records the recovery.
func TestSubscriptionFailureTransitionsAreRecordedOnce(t *testing.T) {
	env := newTestEnv(t)
	now := time.Now()
	rec := sysevents.New(repository.NewSystemEventsRepo(env.conn), repository.NewSettingsRepo(env.conn))
	rec.SetClock(func() time.Time { return now })
	env.deps.Events = rec
	ctx := context.Background()
	sub := env.newSub(t, true)

	fail := func() {
		env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
			return nil, errors.New("ERROR: unable to download https://example.test/c?token=secret: 404")
		}
		if _, err := CheckOne(ctx, env.deps, sub); err == nil {
			t.Fatal("expected the check to fail")
		}
	}
	ok := func() {
		env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) { return nil, nil }
		if _, err := CheckOne(ctx, env.deps, sub); err != nil {
			t.Fatal(err)
		}
	}

	ok() // healthy and staying healthy records nothing
	if got := subEvents(t, env); len(got) != 0 {
		t.Fatalf("healthy checks recorded %v", got)
	}

	fail()
	got := subEvents(t, env)
	if len(got) != 1 || !strings.HasPrefix(got[0], "warning: ") {
		t.Fatalf("OK -> failing: %v", got)
	}
	for _, bad := range []string{"example.test", "token=secret", "https://"} {
		if strings.Contains(got[0], bad) {
			t.Fatalf("%q leaked into the event: %s", bad, got[0])
		}
	}

	// Past the flood window, so only the transition logic (not the flood guard) is under test.
	now = now.Add(5 * time.Minute)
	fail()
	fail()
	if got := subEvents(t, env); len(got) != 1 {
		t.Fatalf("repeated failures must not record again: %v", got)
	}

	ok()
	got = subEvents(t, env)
	if len(got) != 2 || !strings.HasPrefix(got[1], "info: ") {
		t.Fatalf("failing -> OK: %v", got)
	}
	ok()
	if got := subEvents(t, env); len(got) != 2 {
		t.Fatalf("staying healthy recorded again: %v", got)
	}

	// And it can fail (and be recorded) again after recovering.
	now = now.Add(5 * time.Minute)
	fail()
	if got := subEvents(t, env); len(got) != 3 {
		t.Fatalf("second failure episode: %v", got)
	}
}

// A subscription that has never been baselined (last_checked_at NULL) also records the transition once.
func TestSubscriptionNeverBaselinedFailureRecordsOnce(t *testing.T) {
	env := newTestEnv(t)
	env.deps.Events = sysevents.New(repository.NewSystemEventsRepo(env.conn), repository.NewSettingsRepo(env.conn))
	sub := env.newSub(t, false)
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		return nil, errors.New("boom")
	}
	for i := 0; i < 3; i++ {
		_, _ = CheckOne(context.Background(), env.deps, sub)
	}
	if got := subEvents(t, env); len(got) != 1 {
		t.Fatalf("%v", got)
	}
}
