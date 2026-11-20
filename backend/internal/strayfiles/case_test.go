package strayfiles

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// On a case-insensitive mount a file may differ from its database path only in letter case; it is
// the same file and must neither be reported nor deleted.
func TestImagesDifferentCaseIsStillReferenced(t *testing.T) {
	e := newEnv(t)
	small := "library/1/small/Abc.webp"
	e.libraryItem(t, "a.mp4", nil, &small)
	e.put(t, RootImages, "library/1/small/abc.WEBP", false)   // differs only in case: referenced
	e.put(t, RootImages, "library/1/small/Abc.webp", false)   // exact match: referenced
	e.put(t, RootImages, "library/1/small/other.webp", false) // truly unreferenced

	got := e.scan(t)
	notWant(t, got, "images:library/1/small/abc.WEBP")
	notWant(t, got, "images:library/1/small/Abc.webp")
	want(t, got, "images:library/1/small/other.webp", ReasonUnreferenced)
	if len(got) != 1 {
		t.Fatalf("expected only other.webp, got %v", keys(got))
	}

	// Delete uses the same matching: the case-variant is skipped, the real stray is removed.
	deleted, skipped, err := Delete(context.Background(), e.cfg, []Ref{
		{RootImages, "library/1/small/abc.WEBP"},
		{RootImages, "library/1/small/Abc.webp"},
		{RootImages, "library/1/small/other.webp"},
	}, e.now)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 || skipped != 2 {
		t.Fatalf("deleted/skipped = %d/%d, want 1/2", deleted, skipped)
	}
	for _, p := range []string{"library/1/small/abc.WEBP", "library/1/small/Abc.webp"} {
		if _, err := os.Stat(filepath.Join(e.cfg.ImagesRoot, p)); err != nil {
			t.Errorf("%s should remain: %v", p, err)
		}
	}
}

func TestMediaSidecarOfDifferentCaseRowIsNotFlagged(t *testing.T) {
	e := newEnv(t)
	thumb := "Music/Ghost.jpg"
	e.libraryItem(t, "Music/Ghost.mp4", &thumb, nil)
	e.put(t, RootMedia, "music/ghost.nfo", false) // same stem as the row, other case
	e.put(t, RootMedia, "MUSIC/GHOST.JPG", false) // the row's thumbnail, other case
	e.put(t, RootMedia, "Music/gone.nfo", false)  // genuinely orphaned

	got := e.scan(t)
	notWant(t, got, "media:music/ghost.nfo")
	notWant(t, got, "media:MUSIC/GHOST.JPG")
	want(t, got, "media:Music/gone.nfo", ReasonOrphanNFO)
	if len(got) != 1 {
		t.Fatalf("expected only gone.nfo, got %v", keys(got))
	}
}
