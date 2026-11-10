package queue

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

// A genuine failure that is reported while the server is shutting down (the root context already
// cancelled) must still be written: the row ends up failed with its message and history entry.
func TestFinishErrorRecordsFailureAfterRootCancelled(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	parent, cancel := context.WithCancel(context.Background())
	cancel()
	runCtx := context.Background() // the run itself was not cancelled: this is a real failure

	e.mgr.finishError(parent, runCtx, id, "https://example.test/watch?v=1", "boom", "", "")

	if got := e.download(id); got.Status != models.StatusFailed {
		t.Fatalf("status = %q, want %q (terminal write lost with the cancelled context)", got.Status, models.StatusFailed)
	}
}

// A run cut short by the shutdown itself is not a user cancel: the row is left for startup recovery
// to mark interrupted, never recorded as "cancelled by user".
func TestFinishErrorLeavesShutdownInterruptedRunAlone(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})
	if err := e.downloads.UpdateStatus(context.Background(), id, models.StatusDownloading, nil); err != nil {
		t.Fatal(err)
	}

	parent, cancel := context.WithCancel(context.Background())
	cancel()
	runCtx, runCancel := context.WithCancel(parent) // derived, so cancelled too
	defer runCancel()

	e.mgr.finishError(parent, runCtx, id, "https://example.test/watch?v=1", "context canceled", "", "")

	if got := e.download(id); got.Status != models.StatusDownloading {
		t.Fatalf("status = %q, want %q left for startup recovery", got.Status, models.StatusDownloading)
	}
}

// A completion write that has to wait for the database's write lock longer than the 5 s failure-
// bookkeeping bound (a restore or a big delete holding it) must still succeed: failing it
// would send the run down the error path that deletes the file it just downloaded.
func TestCompletionSurvivesSlowDatabase(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs the fake yt-dlp shell script")
	}
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	// Once the run has recorded the yt-dlp command (just before its completion writes begin), take the
	// write lock and sit on it past the old 5 s bound.
	go func() {
		for i := 0; i < 5000; i++ {
			var cmd sql.NullString
			if err := e.conn.QueryRow(`SELECT ytdlp_command FROM downloads WHERE id = ?`, id).Scan(&cmd); err == nil && cmd.Valid && cmd.String != "" {
				break
			}
			time.Sleep(time.Millisecond)
		}
		tx, err := e.conn.BeginTx(context.Background(), nil)
		if err != nil {
			return
		}
		time.Sleep(8 * time.Second)
		tx.Rollback()
	}()
	e.mgr.runOne(context.Background(), id)

	if got := e.download(id).Status; got != models.StatusCompleted {
		t.Fatalf("download status = %q, want completed", got)
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "completed" || items[0].Path == "" {
		t.Fatalf("library item not completed: %+v", items)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, filepath.FromSlash(items[0].Path))); err != nil {
		t.Fatalf("the downloaded file was removed: %v", err)
	}
}

// Like the test above, but the wait outlasts the database's busy timeout (shortened here to
// 200 ms; it is 15 s in production): the first attempt of a completion write fails with
// "database is locked", and the run must retry it rather than treat it as a failure, which would
// delete the file it just downloaded.
func TestCompletionSurvivesBusyTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs the fake yt-dlp shell script")
	}
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	// The run's pool shrinks to one connection with a short busy timeout; the lock is held from a
	// second pool on the same file, so the holder never competes for that connection.
	e.conn.SetMaxOpenConns(1)
	if _, err := e.conn.Exec(`PRAGMA busy_timeout = 200`); err != nil {
		t.Fatal(err)
	}
	var seq int
	var name, file string
	if err := e.conn.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &file); err != nil {
		t.Fatal(err)
	}
	holderDB, err := db.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer holderDB.Close()

	held := make(chan struct{})
	go func() {
		defer close(held)
		for i := 0; i < 5000; i++ {
			var cmd sql.NullString
			if err := e.conn.QueryRow(`SELECT ytdlp_command FROM downloads WHERE id = ?`, id).Scan(&cmd); err == nil && cmd.Valid && cmd.String != "" {
				break
			}
			time.Sleep(time.Millisecond)
		}
		tx, err := holderDB.BeginTx(context.Background(), nil)
		if err != nil {
			return
		}
		time.Sleep(2 * time.Second) // ten times the busy timeout
		tx.Rollback()
	}()
	e.mgr.runOne(context.Background(), id)
	<-held

	if got := e.download(id).Status; got != models.StatusCompleted {
		t.Fatalf("download status = %q, want completed", got)
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "completed" || items[0].Path == "" {
		t.Fatalf("library item not completed: %+v", items)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, filepath.FromSlash(items[0].Path))); err != nil {
		t.Fatalf("the downloaded file was removed: %v", err)
	}
}
