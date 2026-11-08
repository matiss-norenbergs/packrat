package subscriptions

import (
	"context"
	"errors"
	"testing"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// Enqueue refusing because the server is shutting down is not a real failure of
// the entry: the claim is released (so the entry is not stuck "seen" with no
// download for ever) and the check stops; the next check after the restart
// picks every entry up.
func TestShuttingDownEnqueueReleasesClaimAndStops(t *testing.T) {
	env := newTestEnv(t)
	downloads := repository.NewDownloadsRepo(env.conn)
	mgr := queue.NewDownloadManager("", "", "", nil, downloads, nil, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	env.deps.Manager = mgr

	sub := models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true, AutoDownload: true}
	id, err := env.subs.Create(context.Background(), &sub)
	if err != nil {
		t.Fatal(err)
	}
	sub.ID = id
	if err := env.subs.MarkChecked(context.Background(), id, time.Now(), nil); err != nil {
		t.Fatal(err)
	}
	env.deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		return entriesN(3), nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	mgr.Start(ctx, 0)
	cancel() // the server is shutting down

	if _, err := CheckOne(context.Background(), env.deps, sub); !errors.Is(err, queue.ErrShuttingDown) {
		t.Fatalf("CheckOne err = %v, want ErrShuttingDown", err)
	}
	if n := env.count(t, "subscription_seen_entries"); n != 0 {
		t.Fatalf("seen rows = %d, want 0 (claims released)", n)
	}
	if n := env.count(t, "downloads"); n != 0 {
		t.Fatalf("downloads = %d, want none created", n)
	}

	// After the "restart" (a live manager) the same entries are acted on once.
	live := queue.NewDownloadManager("", "", "", nil, downloads, nil, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	env.deps.Manager = live
	n, err := CheckOne(context.Background(), env.deps, sub)
	if err != nil || n != 3 {
		t.Fatalf("second check: n=%d err=%v, want 3", n, err)
	}
	if env.count(t, "downloads") != 3 {
		t.Fatalf("downloads = %d, want 3", env.count(t, "downloads"))
	}
}
