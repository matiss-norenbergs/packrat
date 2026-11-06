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
		MatchTimeout: 400 * time.Millisecond,
	})

	var hung, next models.FrameMatchQueueItem
	deadline := time.Now().Add(20 * time.Second)
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
	if next.ErrorMsg != nil && strings.Contains(*next.ErrorMsg, "timed out") {
		t.Fatalf("second item should not have timed out: %s", *next.ErrorMsg)
	}
}
