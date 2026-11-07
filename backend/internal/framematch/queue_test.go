package framematch

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// A queue item whose ffmpeg hangs fails on its own timeout and the queue
// moves on to the next item.
func TestQueueItemTimeoutFailsItemAndQueueAdvances(t *testing.T) {
	conn, err := db.Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrations, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrations); err != nil {
		t.Fatal(err)
	}
	lib := repository.NewLibraryRepo(conn)
	qr := repository.NewFrameMatchQueueRepo(conn)

	ctx := context.Background()
	mk := func(name string) int64 {
		thumb := name + ".jpg"
		id, err := lib.Create(ctx, &models.LibraryItem{Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed", Thumbnail: &thumb})
		if err != nil {
			t.Fatal(err)
		}
		qid, err := qr.Create(ctx, id, name, "current")
		if err != nil {
			t.Fatal(err)
		}
		return qid
	}
	hangID := mk("hang")
	okID := mk("fine")

	ffmpeg := useFake(t, "hang")
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go RunQueue(rctx, QueueDeps{
		QueueRepo: qr, LibraryRepo: lib,
		YtDlp:        &downloader.YtDlpService{FFmpegPath: ffmpeg},
		FFProbePath:  "ffprobe-does-not-exist",
		MediaRoot:    t.TempDir(),
		ImagesRoot:   t.TempDir(),
		MatchTimeout: 1500 * time.Millisecond,
	})

	var hung, next models.FrameMatchQueueItem
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		hung, _ = qr.Get(ctx, hangID)
		next, _ = qr.Get(ctx, okID)
		if hung.State == "error" && (next.State == "error" || next.State == "done") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if hung.State != "error" || hung.ErrorMsg == nil || !strings.Contains(*hung.ErrorMsg, "timed out") {
		t.Fatalf("hung item: state %q err %v", hung.State, hung.ErrorMsg)
	}
	if next.State != "error" && next.State != "done" {
		t.Fatalf("queue did not advance: next item still %q", next.State)
	}
}

// newQueueTestRepos opens a migrated temp DB and returns the library and queue repos.
func newQueueTestRepos(t *testing.T) (*repository.LibraryRepo, *repository.FrameMatchQueueRepo) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrations, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrations); err != nil {
		t.Fatal(err)
	}
	return repository.NewLibraryRepo(conn), repository.NewFrameMatchQueueRepo(conn)
}

// Cancelling the root context mid-match (shutdown) must still leave the row in a terminal state:
// the failure write uses a detached context, so it no longer stays "running" forever.
func TestQueueShutdownMidMatchRecordsInterruptedError(t *testing.T) {
	lib, qr := newQueueTestRepos(t)
	ctx := context.Background()
	thumb := "x.jpg"
	itemID, err := lib.Create(ctx, &models.LibraryItem{Title: "x", Filename: "x.mp4", Path: "x.mp4", Status: "completed", Thumbnail: &thumb})
	if err != nil {
		t.Fatal(err)
	}
	qid, err := qr.Create(ctx, itemID, "x", "current")
	if err != nil {
		t.Fatal(err)
	}

	ffmpeg := useFake(t, "hang")
	rctx, cancel := context.WithCancel(ctx)
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		RunQueue(rctx, QueueDeps{
			QueueRepo: qr, LibraryRepo: lib,
			YtDlp:        &downloader.YtDlpService{FFmpegPath: ffmpeg},
			FFProbePath:  "ffprobe-does-not-exist",
			MediaRoot:    t.TempDir(),
			ImagesRoot:   t.TempDir(),
			MatchTimeout: time.Minute,
		})
	}()

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if row, _ := qr.Get(ctx, qid); row.State == "running" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if row, _ := qr.Get(ctx, qid); row.State != "running" {
		t.Fatalf("item never started running (state %q)", row.State)
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(30 * time.Second):
		t.Fatal("RunQueue did not return after cancel")
	}

	row, err := qr.Get(ctx, qid)
	if err != nil {
		t.Fatal(err)
	}
	if row.State != "error" || row.ErrorMsg == nil || *row.ErrorMsg != InterruptedMessage {
		t.Fatalf("row after shutdown: state %q err %v, want error %q", row.State, row.ErrorMsg, InterruptedMessage)
	}
}
