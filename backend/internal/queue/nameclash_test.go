package queue

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/ws"
)

// S4-4

func vidURL(id string) string { return "https://example.test/watch?vid=" + id }

// runDownload runs one download of video vid and returns the id and its library row.
func (e *ghostEnv) runDownload(vid, filename string) (int64, *models.LibraryItem) {
	e.t.Helper()
	id := e.newDownload(models.Download{URL: vidURL(vid), Filename: filename})
	e.mgr.runOne(context.Background(), id)
	for _, it := range e.items() {
		if it.DownloadID != nil && *it.DownloadID == id {
			it := it
			return id, &it
		}
	}
	e.t.Fatalf("no library row for download %d", id)
	return 0, nil
}

func TestDisambiguatedName(t *testing.T) {
	cases := []struct {
		base    string
		def     bool
		videoID string
		attempt int
		want    string
	}{
		{"Fake_Title", true, "abc", 1, "Fake_Title [abc]"},
		{"Fake_Title", true, "abc", 2, "Fake_Title (2)"},
		{"Fake_Title", true, "abc", 3, "Fake_Title (3)"},
		{"Fake_Title", true, "", 1, "Fake_Title (2)"},
		{"Fake_Title", true, "", 2, "Fake_Title (3)"},
		{"Clip", false, "abc", 1, "Clip (2)"},
		{"Clip", false, "abc", 2, "Clip (3)"},
	}
	for _, c := range cases {
		if got := disambiguatedName(c.base, c.def, c.videoID, c.attempt); got != c.want {
			t.Errorf("disambiguatedName(%q, %v, %q, %d) = %q, want %q", c.base, c.def, c.videoID, c.attempt, got, c.want)
		}
	}
}

func TestSameDefaultNameDifferentVideosGetIdSuffix(t *testing.T) {
	e := newGhostEnv(t)
	idA, a := e.runDownload("A", "")
	first := filepath.Join(e.mediaRoot, filepath.FromSlash(a.Path))
	firstBytes := readFile(t, first)
	idB, b := e.runDownload("B", "")

	for _, id := range []int64{idA, idB} {
		if e.download(id).Status != models.StatusCompleted {
			t.Fatalf("download %d status = %s", id, e.download(id).Status)
		}
	}
	if a.Path == b.Path {
		t.Fatalf("both rows share path %q", a.Path)
	}
	if a.Path != "Fake_Title.mp4" || b.Path != "Fake_Title [B].mp4" {
		t.Fatalf("paths = %q, %q", a.Path, b.Path)
	}
	if got := readFile(t, first); got != firstBytes || got != "data:A\n" {
		t.Fatalf("first file changed: %q", got)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, b.Path)); got != "data:B\n" {
		t.Fatalf("second file content = %q", got)
	}
	if b.Filename != "Fake_Title [B].mp4" {
		t.Fatalf("second row filename = %q", b.Filename)
	}
	if len(e.items()) != 2 {
		t.Fatalf("want 2 rows, got %d", len(e.items()))
	}
}

func TestSameExplicitNameGetsNumberedSuffix(t *testing.T) {
	e := newGhostEnv(t)
	var paths []string
	for _, vid := range []string{"A", "B", "C"} {
		id, it := e.runDownload(vid, "Clip")
		if e.download(id).Status != models.StatusCompleted {
			t.Fatalf("video %s status = %s", vid, e.download(id).Status)
		}
		paths = append(paths, it.Path)
		if got := readFile(t, filepath.Join(e.mediaRoot, it.Path)); got != "data:"+vid+"\n" {
			t.Fatalf("video %s file content = %q", vid, got)
		}
	}
	if strings.Join(paths, "|") != "Clip.mp4|Clip (2).mp4|Clip (3).mp4" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestNameClashAllAttemptsFail(t *testing.T) {
	e := newGhostEnv(t)
	names := []string{"Clip.mp4"}
	for n := 2; n <= 6; n++ {
		names = append(names, "Clip ("+itoa(int64(n))+").mp4")
	}
	for _, n := range names {
		e.addCompletedItem(n, n)
		writeFile(t, filepath.Join(e.mediaRoot, n), "other:"+n)
	}
	id := e.newDownload(models.Download{URL: vidURL("Z"), Filename: "Clip"})
	e.mgr.runOne(context.Background(), id)

	d := e.download(id)
	if d.Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", d.Status)
	}
	if d.ErrorMessage == nil || !strings.Contains(*d.ErrorMessage, "no free name") {
		t.Fatalf("error = %v", d.ErrorMessage)
	}
	for _, n := range names {
		if got := readFile(t, filepath.Join(e.mediaRoot, n)); got != "other:"+n {
			t.Errorf("%s was modified: %q", n, got)
		}
	}
	if exists(filepath.Join(e.mediaRoot, "Clip (7).mp4")) {
		t.Error("more attempts than the cap were made")
	}
	for _, it := range e.items() {
		if it.Status == "completed" && it.DownloadID != nil {
			t.Fatalf("a library row was created for the failed download: %+v", it)
		}
	}
	if len(e.items()) != len(names)+1 { // the others plus this run's ghost
		t.Fatalf("items = %d", len(e.items()))
	}
}

func TestUntrackedLeftoverIsStillAdopted(t *testing.T) {
	e := newGhostEnv(t)
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.mp4"), "leftover")
	id, it := e.runDownload("A", "Clip")

	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if it.Path != "Clip.mp4" {
		t.Fatalf("path = %q, want the leftover adopted", it.Path)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Clip.mp4")); got != "leftover" {
		t.Fatalf("leftover changed: %q", got)
	}
	if exists(filepath.Join(e.mediaRoot, "Clip (2).mp4")) {
		t.Fatal("untracked leftover was treated as a clash")
	}
}

func TestLibraryWriteFailureKeepsAdoptedFile(t *testing.T) {
	e := newGhostEnv(t)
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.mp4"), "leftover")
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.jpg"), "sidecar")
	e.bc.onEvt = func(ev ws.Event) {
		if ev.Type == ws.EventLibraryChanged && ev.Payload.(ws.LibraryChangedPayload).Reason == "ghost_created" {
			e.failLibraryWrites()
		}
	}
	id := e.newDownload(models.Download{URL: vidURL("A"), Filename: "Clip"})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", e.download(id).Status)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Clip.mp4")); got != "leftover" {
		t.Fatalf("adopted file was removed or changed: %q", got)
	}
	if !exists(filepath.Join(e.mediaRoot, "Clip.jpg")) {
		t.Fatal("adopted file's sidecar was removed")
	}
}

func TestLibraryWriteFailureDoesNotTouchOtherItemsFile(t *testing.T) {
	e := newGhostEnv(t)
	e.addCompletedItem("Other", "Clip.mp4")
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.mp4"), "other-bytes")
	writeFile(t, filepath.Join(e.mediaRoot, "Clip.jpg"), "other-thumb")
	e.bc.onEvt = func(ev ws.Event) {
		if ev.Type == ws.EventLibraryChanged && ev.Payload.(ws.LibraryChangedPayload).Reason == "ghost_created" {
			e.failLibraryWrites()
		}
	}
	id := e.newDownload(models.Download{URL: vidURL("A"), Filename: "Clip"})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", e.download(id).Status)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Clip.mp4")); got != "other-bytes" {
		t.Fatalf("other item's file changed: %q", got)
	}
	if got := readFile(t, filepath.Join(e.mediaRoot, "Clip.jpg")); got != "other-thumb" {
		t.Fatalf("other item's thumbnail changed: %q", got)
	}
	// This run's own fresh file (under the disambiguated name) is still cleaned up.
	if exists(filepath.Join(e.mediaRoot, "Clip (2).mp4")) {
		t.Fatal("the run's own file should have been removed")
	}
}
