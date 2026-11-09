package repository

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// seedDownloads inserts n downloads with big tails. created_at is spread over
// n/3 distinct seconds so there are deliberate ties (the tiebreak is by id).
func seedDownloads(t *testing.T, repo *DownloadsRepo, n int) {
	t.Helper()
	ctx := context.Background()
	tail := strings.Repeat("x", 8000)
	for i := 0; i < n; i++ {
		id, err := repo.Create(ctx, &models.Download{URL: fmt.Sprintf("https://example.com/%d", i), DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
		if err != nil {
			t.Fatal(err)
		}
		ts := fmt.Sprintf("2026-01-%02d 10:%02d:%02d", 1+(i/3600)%28, (i/60)%60, i%60/3*3)
		if _, err := repo.db.ExecContext(ctx, `UPDATE downloads SET created_at = ?, ytdlp_command = 'yt-dlp x', stdout_tail = ?, stderr_tail = ? WHERE id = ?`, ts, tail, tail, id); err != nil {
			t.Fatal(err)
		}
	}
}

func ids(rows []models.Download) []int64 {
	out := make([]int64, 0, len(rows))
	for _, d := range rows {
		out = append(out, d.ID)
	}
	return out
}

func TestDownloadsRepo_ListRecent(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)
	seedDownloads(t, repo, 30)

	got, err := repo.ListRecent(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 10 {
		t.Fatalf("got %d rows, want 10", len(got))
	}
	// Newest created_at first; ties (3 rows share a second) break by id DESC.
	for i := 1; i < len(got); i++ {
		a, b := got[i-1], got[i]
		if a.CreatedAt.Before(b.CreatedAt) || (a.CreatedAt.Equal(b.CreatedAt) && a.ID < b.ID) {
			t.Fatalf("rows %d,%d out of order: %v/%d then %v/%d", i-1, i, a.CreatedAt, a.ID, b.CreatedAt, b.ID)
		}
	}
	if got[0].ID != 30 {
		t.Errorf("newest row is %d, want 30 (highest id in the newest second)", got[0].ID)
	}
	// Same as the unbounded List, truncated (List's order within a tie is
	// unspecified, so compare as sets of the boundary-safe prefix).
	all, _ := repo.List(ctx)
	if got[0].StdoutTail == nil || len(*got[0].StdoutTail) != 8000 || got[0].YtDlpCommand == nil {
		t.Errorf("ListRecent must keep the tails and command")
	}
	if len(all) != 30 {
		t.Fatalf("List returned %d", len(all))
	}

	// Smaller table than the limit: everything, no error.
	small, err := repo.ListRecent(ctx, 500)
	if err != nil || len(small) != 30 {
		t.Fatalf("limit above table size: %d rows, err %v", len(small), err)
	}
	if none, err := repo.ListRecent(ctx, 0); err != nil || len(none) != 0 {
		t.Fatalf("limit 0: %d rows, err %v", len(none), err)
	}
}

func TestDownloadsRepo_ListLightMatchesListWithoutTails(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)
	seedDownloads(t, repo, 20)

	full, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	light, err := repo.ListLight(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(light) != len(full) {
		t.Fatalf("light has %d rows, List %d (the queue must never truncate)", len(light), len(full))
	}
	byID := map[int64]models.Download{}
	for _, d := range full {
		byID[d.ID] = d
	}
	for _, l := range light {
		if l.StdoutTail != nil || l.StderrTail != nil || l.YtDlpCommand != nil {
			t.Fatalf("download %d still carries a heavy column", l.ID)
		}
		want := byID[l.ID]
		want.StdoutTail, want.StderrTail, want.YtDlpCommand = nil, nil, nil
		if !reflect.DeepEqual(want, l) {
			t.Fatalf("download %d differs beyond the nulled columns:\nwant %+v\ngot  %+v", l.ID, want, l)
		}
	}
	// Order is created_at DESC like List.
	for i := 1; i < len(light); i++ {
		if light[i-1].CreatedAt.Before(light[i].CreatedAt) {
			t.Fatalf("light list not newest-first at %d", i)
		}
	}
}
