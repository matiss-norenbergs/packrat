package queue

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool { _, err := os.Stat(path); return err == nil }

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func (e *ghostEnv) historyStatuses(downloadID int64) []string {
	e.t.Helper()
	all, err := repository.NewHistoryRepo(e.conn).List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	var out []string
	for _, h := range all {
		if h.DownloadID != nil && *h.DownloadID == downloadID {
			out = append(out, h.Status)
		}
	}
	return out
}

func (e *ghostEnv) execSQL(q string) {
	e.t.Helper()
	if _, err := e.conn.Exec(q); err != nil {
		e.t.Fatal(err)
	}
}

// failLibraryWrites makes every INSERT/UPDATE on the library table abort.
func (e *ghostEnv) failLibraryWrites() {
	e.execSQL(`CREATE TRIGGER fail_lib_update BEFORE UPDATE ON library BEGIN SELECT RAISE(ABORT, 'injected'); END`)
	e.execSQL(`CREATE TRIGGER fail_lib_insert BEFORE INSERT ON library BEGIN SELECT RAISE(ABORT, 'injected'); END`)
}

func (e *ghostEnv) addCompletedItem(title, rel string) int64 {
	e.t.Helper()
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: title, Filename: filepath.Base(rel), Path: rel, Status: "completed",
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// S4-2

func TestCleanupOrphanedThumbnailArtifactsOnlyKnownSiblings(t *testing.T) {
	dir := t.TempDir()
	final := filepath.Join(dir, "Clip.mp4")
	keep := []string{"Clip.mp4", "Clip.jpg", "Clip.nfo", "Clip.en.srt", "Clip._Part_2.mp4", "Clip.mkv", "Song e.mp4", "Song e.nfo", "Song [Live].mp4"}
	gone := []string{"Clip.webp", "Clip.avif", "Clip.png"}
	for _, n := range append(append([]string{}, keep...), gone...) {
		writeFile(t, filepath.Join(dir, n), "x")
	}
	cleanupOrphanedThumbnailArtifacts(final)
	for _, n := range keep {
		if !exists(filepath.Join(dir, n)) {
			t.Errorf("%s must not be removed", n)
		}
	}
	for _, n := range gone {
		if exists(filepath.Join(dir, n)) {
			t.Errorf("%s should have been removed", n)
		}
	}

	// Bracketed final name: the old glob treated [Live] as a character class.
	cleanupOrphanedThumbnailArtifacts(filepath.Join(dir, "Song [Live].mp4"))
	for _, n := range []string{"Song e.mp4", "Song e.nfo", "Song [Live].mp4"} {
		if !exists(filepath.Join(dir, n)) {
			t.Errorf("%s must not be removed by a bracketed base", n)
		}
	}
}

func TestNonZeroExitKeepsSiblingFiles(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("exitafter", true)
	for n, c := range map[string]string{
		"Clip.nfo": "nfo", "Clip.en.srt": "srt", "Clip._Part_2.mp4": "part2",
		"Clip.webp": "w", "Clip.avif": "a",
	} {
		writeFile(t, filepath.Join(e.mediaRoot, n), c)
	}
	id := e.newDownload(models.Download{Filename: "Clip"})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	for _, n := range []string{"Clip.mp4", "Clip.nfo", "Clip.en.srt", "Clip._Part_2.mp4"} {
		if !exists(filepath.Join(e.mediaRoot, n)) {
			t.Errorf("%s must survive", n)
		}
	}
	for _, n := range []string{"Clip.webp", "Clip.avif"} {
		if exists(filepath.Join(e.mediaRoot, n)) {
			t.Errorf("%s leftover should be removed", n)
		}
	}
}

// S4-3

func TestGhostFillDoesNotOverwriteOtherItemsFile(t *testing.T) {
	e := newGhostEnv(t)
	other := e.addCompletedItem("Other", "Trailer.mp4")
	writeFile(t, filepath.Join(e.mediaRoot, "Trailer.mp4"), "other-bytes")
	ghost := e.makeGhost("Trailer")
	title := "Trailer"
	id := e.newDownload(models.Download{TargetLibraryItemID: &ghost, OverrideTitle: &title})
	e.mgr.runOne(context.Background(), id)

	if got := readFile(t, filepath.Join(e.mediaRoot, "Trailer.mp4")); got != "other-bytes" {
		t.Fatalf("other item's file was overwritten: %q", got)
	}
	g, err := e.library.Get(context.Background(), ghost)
	if err != nil {
		t.Fatal(err)
	}
	if g.Filename != "Trailer (2).mp4" || g.Path != "Trailer (2).mp4" || g.Status != "completed" {
		t.Fatalf("ghost row = %+v", g)
	}
	if !exists(filepath.Join(e.mediaRoot, "Trailer (2).mp4")) {
		t.Fatal("new file missing")
	}
	o, _ := e.library.Get(context.Background(), other)
	if o.Path != "Trailer.mp4" {
		t.Fatalf("other row changed: %+v", o)
	}
	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("status = %s", e.download(id).Status)
	}
}

func TestSameExtensionRedownloadReplacesOwnFileInPlace(t *testing.T) {
	e := newGhostEnv(t)
	item := e.addCompletedItem("Same", "Same.mp4")
	writeFile(t, filepath.Join(e.mediaRoot, "Same.mp4"), "old")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item})
	e.mgr.runOne(context.Background(), id)

	if got := readFile(t, filepath.Join(e.mediaRoot, "Same.mp4")); got != "data\n" {
		t.Fatalf("own file not replaced, content %q", got)
	}
	if exists(filepath.Join(e.mediaRoot, "Same (2).mp4")) {
		t.Fatal("a same-extension redownload must not get a suffix")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Same.mp4" || it.Filename != "Same.mp4" {
		t.Fatalf("row = %+v", it)
	}
}

func TestImageConversionDoesNotOverwriteExistingTarget(t *testing.T) {
	e := newGhostEnv(t)
	ffmpeg := filepath.Join(e.binDir, "ffmpeg")
	// Fake ffmpeg: copy the -i input to the last argument.
	writeFile(t, ffmpeg, `#!/bin/sh
prev=""; src=""
for a in "$@"; do [ "$prev" = "-i" ] && src="$a"; prev="$a"; last="$a"; done
cp "$src" "$last"
`)
	os.Chmod(ffmpeg, 0o755)
	e.mgr.ytdlp.FFmpegPath = ffmpeg

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("png-bytes"))
	}))
	defer srv.Close()

	writeFile(t, filepath.Join(e.mediaRoot, "Cat.jpg"), "other-cat")
	id := e.newDownload(models.Download{DownloadType: "image", URL: srv.URL + "/Cat.png"})
	e.mgr.runOne(context.Background(), id)

	if got := readFile(t, filepath.Join(e.mediaRoot, "Cat.jpg")); got != "other-cat" {
		t.Fatalf("existing Cat.jpg overwritten: %q", got)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Cat (2).jpg")); got != "png-bytes" {
		t.Fatalf("converted file = %q", got)
	}
	items := e.items()
	if len(items) != 1 || items[0].Path != "Cat (2).jpg" {
		t.Fatalf("items = %+v", items)
	}
}

// S4-6

func TestLibraryWriteFailureFailsDownloadAndRemovesFiles(t *testing.T) {
	e := newGhostEnv(t)
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.jpg"), "sidecar") // stands in for the run's thumbnail
	e.bc.onEvt = func(ev ws.Event) {
		if ev.Type == ws.EventLibraryChanged && ev.Payload.(ws.LibraryChangedPayload).Reason == "ghost_created" {
			e.failLibraryWrites()
		}
	}
	id := e.newDownload(models.Download{Filename: "Clip"})
	e.mgr.runOne(context.Background(), id)

	d := e.download(id)
	if d.Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", d.Status)
	}
	if d.ErrorMessage == nil || !strings.Contains(*d.ErrorMessage, "creating library item") {
		t.Fatalf("error = %v", d.ErrorMessage)
	}
	for _, s := range e.historyStatuses(id) {
		if s == "completed" {
			t.Fatal("a completed history entry was written")
		}
	}
	if got := e.historyStatuses(id); len(got) != 1 || got[0] != "failed" {
		t.Fatalf("history = %v", got)
	}
	for _, n := range []string{"Clip.mp4", "Clip.jpg"} {
		if exists(filepath.Join(e.mediaRoot, n)) {
			t.Errorf("%s should have been removed", n)
		}
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "ghost" {
		t.Fatalf("ghost should remain: %+v", items)
	}
}

func TestRedownloadApplyFailureKeepsOldFileAndRow(t *testing.T) {
	e := newGhostEnv(t)
	item := e.addCompletedItem("Old", "Old.webm")
	writeFile(t, filepath.Join(e.mediaRoot, "Old.webm"), "old-bytes")
	e.failLibraryWrites()
	id := e.newDownload(models.Download{TargetLibraryItemID: &item})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Old.webm")); got != "old-bytes" {
		t.Fatalf("old file changed: %q", got)
	}
	if exists(filepath.Join(e.mediaRoot, "Old.mp4")) {
		t.Fatal("new file should have been removed")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Old.webm" || it.Filename != "Old.webm" {
		t.Fatalf("row = %+v", it)
	}
	if got := e.historyStatuses(id); len(got) != 1 || got[0] != "failed" {
		t.Fatalf("history = %v", got)
	}
}

func TestRedownloadExtensionChangeRemovesOldFileAfterApply(t *testing.T) {
	e := newGhostEnv(t)
	item := e.addCompletedItem("Old", "Old.webm")
	writeFile(t, filepath.Join(e.mediaRoot, "Old.webm"), "old-bytes")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item})
	e.mgr.runOne(context.Background(), id)

	if exists(filepath.Join(e.mediaRoot, "Old.webm")) || !exists(filepath.Join(e.mediaRoot, "Old.mp4")) {
		t.Fatal("old file should be replaced by the new one")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Old.mp4" || e.download(id).Status != models.StatusCompleted {
		t.Fatalf("row = %+v", it)
	}
}

// S4-10

func TestExitZeroWithoutOutputPathFails(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("nopath", true)
	id := e.newDownload(models.Download{})
	e.mgr.runOne(context.Background(), id)

	d := e.download(id)
	if d.Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", d.Status)
	}
	if d.ErrorMessage == nil || !strings.Contains(*d.ErrorMessage, "without reporting an output file") {
		t.Fatalf("error = %v", d.ErrorMessage)
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "ghost" {
		t.Fatalf("only the ghost should exist: %+v", items)
	}
	for _, s := range e.historyStatuses(id) {
		if s == "completed" {
			t.Fatal("completed history entry written")
		}
	}
}
