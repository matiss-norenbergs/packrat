package api

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"testing"

	"packrat/backend/internal/models"
)

// redownloadCase is one library item shape; the download the redownload
// enqueues for it must carry wantType/wantFormat.
type redownloadCase struct {
	name       string
	filename   string
	mediaType  *string
	wantType   string
	wantFormat string // "" = no audio format on the download
}

// redownloadItem inserts a library item with a source URL and a real file.
// origRow, when non-nil, is inserted as the item's original downloads row.
func (e *bkEnv) redownloadItem(c redownloadCase, origRow *models.Download) int64 {
	e.t.Helper()
	writeFile(e.t, filepath.Join(e.mediaRoot, c.filename))
	url := "https://example.test/" + c.name
	item := &models.LibraryItem{
		Title: c.name, Filename: c.filename, Path: c.filename, Status: "completed",
		MediaType: c.mediaType, OriginalURL: &url,
	}
	if origRow != nil {
		id, err := e.downloads.Create(context.Background(), origRow)
		if err != nil {
			e.t.Fatal(err)
		}
		item.DownloadID = &id
	}
	id, err := e.library.Create(context.Background(), item)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// enqueuedFor returns the (single) download queued as a redownload of itemID.
func (e *bkEnv) enqueuedFor(itemID int64) models.Download {
	e.t.Helper()
	all, err := e.downloads.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	var found []models.Download
	for _, d := range all {
		if d.TargetLibraryItemID != nil && *d.TargetLibraryItemID == itemID {
			found = append(found, d)
		}
	}
	if len(found) != 1 {
		e.t.Fatalf("item %d: %d redownloads enqueued, want 1", itemID, len(found))
	}
	return found[0]
}

func (e *bkEnv) checkRedownload(c redownloadCase, itemID int64) {
	e.t.Helper()
	d := e.enqueuedFor(itemID)
	format := ""
	if d.AudioFormat != nil {
		format = *d.AudioFormat
	}
	if d.DownloadType != c.wantType || format != c.wantFormat {
		e.t.Fatalf("%s: enqueued type=%q audioFormat=%q, want type=%q audioFormat=%q", c.name, d.DownloadType, format, c.wantType, c.wantFormat)
	}
}

// With the original downloads row gone (never had one / cleared / swept), the
// type and audio format come from the item itself — through all three
// redownload entry points.
func TestRedownload_WithoutDownloadsRow_UsesItemMediaType(t *testing.T) {
	cases := []redownloadCase{
		{name: "song-mp3", filename: "song.mp3", mediaType: strp("audio"), wantType: "audio", wantFormat: "mp3"},
		{name: "song-m4a", filename: "song.m4a", mediaType: strp("audio"), wantType: "audio", wantFormat: "m4a"},
		{name: "song-flac", filename: "song.flac", mediaType: strp("audio"), wantType: "audio", wantFormat: "flac"},
		{name: "pic", filename: "pic.jpg", mediaType: strp("image"), wantType: "image"},
		{name: "clip", filename: "clip.mp4", mediaType: strp("video"), wantType: "video"},
		{name: "legacy-m4a", filename: "legacy.m4a", mediaType: nil, wantType: "audio", wantFormat: "m4a"},
		{name: "legacy-png", filename: "legacy.png", mediaType: nil, wantType: "image"},
		{name: "legacy-mkv", filename: "legacy.mkv", mediaType: nil, wantType: "video"},
	}
	entry := []struct {
		name string
		call func(e *bkEnv, id int64) int
	}{
		{"single", func(e *bkEnv, id int64) int {
			return e.post(fmt.Sprintf("/library/%d/redownload", id), "").Code
		}},
		{"bulk", func(e *bkEnv, id int64) int {
			return e.post("/library/bulk-redownload", fmt.Sprintf(`{"itemIds":[%d]}`, id)).Code
		}},
		{"from-url", func(e *bkEnv, id int64) int {
			return e.post(fmt.Sprintf("/library/%d/redownload/from-url", id), `{"url":"https://example.test/other","overwriteFields":["title"]}`).Code
		}},
	}
	for _, ep := range entry {
		t.Run(ep.name, func(t *testing.T) {
			e := newBkEnv(t)
			for _, c := range cases {
				id := e.redownloadItem(c, nil)
				code := ep.call(e, id)
				want := http.StatusCreated
				if ep.name == "bulk" {
					want = http.StatusOK
				}
				if code != want {
					t.Fatalf("%s: status = %d, want %d", c.name, code, want)
				}
				e.checkRedownload(c, id)
			}
		})
	}
}

// A downloads row that was deleted after the item was created (the FK is
// cleared) behaves like no row at all.
func TestRedownload_DeletedDownloadsRow_UsesItemMediaType(t *testing.T) {
	e := newBkEnv(t)
	c := redownloadCase{name: "gone", filename: "gone.m4a", mediaType: strp("audio"), wantType: "audio", wantFormat: "m4a"}
	id := e.redownloadItem(c, &models.Download{URL: "https://example.test/gone", DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
	it, _ := e.library.Get(context.Background(), id)
	if _, err := e.conn.Exec(`DELETE FROM downloads WHERE id = ?`, *it.DownloadID); err != nil {
		t.Fatal(err)
	}
	e.want(e.post(fmt.Sprintf("/library/%d/redownload", id), ""), http.StatusCreated)
	e.checkRedownload(c, id)
}

// With the original row present nothing changes: its type, quality and audio
// format win, even when they disagree with the item's file.
func TestRedownload_WithDownloadsRow_KeepsRowValues(t *testing.T) {
	e := newBkEnv(t)
	af := "flac"
	c := redownloadCase{name: "withrow", filename: "withrow.m4a", mediaType: strp("audio"), wantType: "audio", wantFormat: "flac"}
	id := e.redownloadItem(c, &models.Download{
		URL: "https://example.test/withrow", DownloadType: "audio", Quality: "720", AudioFormat: &af, Status: models.StatusCompleted,
	})
	e.want(e.post(fmt.Sprintf("/library/%d/redownload", id), ""), http.StatusCreated)
	e.checkRedownload(c, id)
	if d := e.enqueuedFor(id); d.Quality != "720" {
		t.Fatalf("quality = %q, want the original row's 720", d.Quality)
	}

	// A video row on an item whose file extension looks like audio still wins.
	c2 := redownloadCase{name: "rowwins", filename: "rowwins.mp3", mediaType: strp("audio"), wantType: "video"}
	id2 := e.redownloadItem(c2, &models.Download{
		URL: "https://example.test/rowwins", DownloadType: "video", Quality: "best", Status: models.StatusCompleted,
	})
	e.want(e.post("/library/bulk-redownload", fmt.Sprintf(`{"itemIds":[%d]}`, id2)), http.StatusOK)
	e.checkRedownload(c2, id2)
}
