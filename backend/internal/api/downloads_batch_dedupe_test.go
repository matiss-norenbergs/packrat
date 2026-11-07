package api

import (
	"context"
	"testing"

	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

func runBatch(t *testing.T, f *privacyFixture, entries []batchEntry, skip bool) EnqueueResultResponse {
	t.Helper()
	mgr := queue.NewDownloadManager(f.mediaRoot, t.TempDir(), "", nil, f.downloads, f.library, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	res, err := enqueueBatch(context.Background(), mgr, f.collections, f.settings, f.library, repository.NewHistoryRepo(f.conn), f.responder(), entries, skip)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func entry(url, videoID string) batchEntry {
	return batchEntry{req: CreateDownloadRequest{URL: url, DownloadType: "video"}, videoID: videoID}
}

func TestEnqueueBatchSkipsDuplicatesWithinTheRequest(t *testing.T) {
	cases := []struct {
		name    string
		entries []batchEntry
	}{
		{"same URL twice", []batchEntry{entry("https://example.test/a", ""), entry("https://example.test/a", "")}},
		{"same URL, different case/slash/fragment", []batchEntry{entry("https://Example.test/a", ""), entry("https://example.test/a/#t=5", "")}},
		{"same video id, different URLs", []batchEntry{entry("https://example.test/a", "vid1"), entry("https://example.test/a?x=1", "vid1")}},
		{"playlist repeating an entry", []batchEntry{entry("https://example.test/a", "vid1"), entry("https://example.test/b", "vid2"), entry("https://example.test/a", "vid1")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newPrivacyFixture(t)
			res := runBatch(t, f, tc.entries, true)
			wantQueued := len(tc.entries) - 1
			if tc.name == "playlist repeating an entry" {
				wantQueued = 2
			}
			if len(res.Queued) != wantQueued || len(res.Skipped) != 1 || len(res.Failed) != 0 {
				t.Fatalf("queued=%d skipped=%d failed=%d (%+v)", len(res.Queued), len(res.Skipped), len(res.Failed), res)
			}
			s := res.Skipped[0]
			if s.Reason != skipReasonDuplicateInBatch || s.LibraryItemID != nil {
				t.Fatalf("skipped = %+v, want reason %q and no library item", s, skipReasonDuplicateInBatch)
			}
			var n int
			if err := f.conn.QueryRow(`SELECT COUNT(*) FROM history WHERE status = 'duplicate' AND error_message = 'Duplicate within this request'`).Scan(&n); err != nil || n != 1 {
				t.Fatalf("duplicate history rows = %d (%v), want 1", n, err)
			}
		})
	}
}

func TestEnqueueBatchWithoutSkipDuplicatesQueuesEverything(t *testing.T) {
	f := newPrivacyFixture(t)
	res := runBatch(t, f, []batchEntry{entry("https://example.test/a", "v"), entry("https://example.test/a", "v")}, false)
	if len(res.Queued) != 2 || len(res.Skipped) != 0 {
		t.Fatalf("queued=%d skipped=%d, want 2/0", len(res.Queued), len(res.Skipped))
	}
}

func TestEnqueueBatchLibraryDuplicateKeepsItsReason(t *testing.T) {
	f := newPrivacyFixture(t)
	sc := f.scenario()
	plain := f.withURL(sc.plain, "https://example.test/lib")
	res := runBatch(t, f, []batchEntry{entry(*plain.OriginalURL, ""), entry("https://example.test/new", "")}, true)
	if len(res.Queued) != 1 || len(res.Skipped) != 1 {
		t.Fatalf("queued=%d skipped=%d", len(res.Queued), len(res.Skipped))
	}
	s := res.Skipped[0]
	if s.Reason != skipReasonInLibrary || s.LibraryItemID == nil || *s.LibraryItemID != sc.plain {
		t.Fatalf("skipped = %+v, want in_library pointing at item %d", s, sc.plain)
	}
}
