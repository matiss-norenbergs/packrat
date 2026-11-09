package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func seedBigDownloads(t *testing.T, f *privacyFixture, n int) {
	t.Helper()
	tail := strings.Repeat("y", 8000)
	for i := 0; i < n; i++ {
		id, err := f.downloads.Create(f.ctx, &models.Download{URL: fmt.Sprintf("https://example.com/%d", i), DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
		if err != nil {
			t.Fatal(err)
		}
		// Distinct, increasing seconds so the order is unambiguous.
		ts := fmt.Sprintf("2026-02-%02d %02d:%02d:%02d", 1+i/1440%28, i/60%24, i%60, 0)
		if _, err := f.conn.ExecContext(f.ctx, `UPDATE downloads SET created_at = ?, ytdlp_command = 'yt-dlp --x', stdout_tail = ?, stderr_tail = ? WHERE id = ?`, ts, tail+fmt.Sprint(i), tail, id); err != nil {
			t.Fatal(err)
		}
	}
}

// GET /api/logs returns the 200 newest rows, newest first, tails included —
// the same as the old "List everything, keep the first 200".
func TestGetLogsSameAsOldFullScan(t *testing.T) {
	f := newPrivacyFixture(t)
	seedBigDownloads(t, f, 500)

	old, err := f.downloads.List(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	old = old[:200]
	want := make([]LogEntryResponse, 0, len(old))
	for _, d := range old {
		want = append(want, toLogEntryResponse(d, false))
	}

	mount := func(r *gin.Engine) { r.GET("/api/logs", GetLogs(f.downloads, f.settings)) }
	var got []LogEntryResponse
	w := serve(t, mount, http.MethodGet, "/api/logs", &got)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if len(got) != 200 {
		t.Fatalf("got %d rows, want 200", len(got))
	}
	for i := range want {
		if got[i].ID != want[i].ID || got[i].CreatedAt != want[i].CreatedAt {
			t.Fatalf("row %d: got id %d (%s), want id %d (%s)", i, got[i].ID, got[i].CreatedAt, want[i].ID, want[i].CreatedAt)
		}
		if got[i].StdoutTail == nil || len(*got[i].StdoutTail) < 8000 || got[i].StderrTail == nil || got[i].YtDlpCommand == nil {
			t.Fatalf("row %d lost its tails/command", i)
		}
		if *got[i].StdoutTail != *want[i].StdoutTail {
			t.Fatalf("row %d stdout tail differs", i)
		}
	}
}

// The queue list answers the same rows/fields as before; its response never
// exposed the tails or the command, so nothing visible changes.
func TestListDownloadsSameAsFullList(t *testing.T) {
	f := newPrivacyFixture(t)
	seedBigDownloads(t, f, 60)
	conn := repository.NewDownloadsRepo(f.conn)
	mgr := queue.NewDownloadManager("", "", "", nil, conn, f.library, f.collections, nil, nil, f.tags, f.settings, nil, nil, nil, queue.NewProgressStore(), nil)

	full, err := conn.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := make([]DownloadResponse, 0, len(full))
	for _, d := range full {
		want = append(want, toDownloadResponse(d, nil, false))
	}

	mount := func(r *gin.Engine) {
		r.GET("/api/downloads", ListDownloads(mgr, conn, f.collections, f.tags, f.artists, f.settings))
	}
	var got []DownloadResponse
	serve(t, mount, http.MethodGet, "/api/downloads", &got)
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d", len(got), len(want))
	}
	for i := range want {
		if fmt.Sprintf("%+v", got[i]) != fmt.Sprintf("%+v", want[i]) {
			t.Fatalf("row %d differs:\nwant %+v\ngot  %+v", i, want[i], got[i])
		}
	}
}
