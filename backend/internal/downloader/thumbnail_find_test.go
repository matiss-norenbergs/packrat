package downloader

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindThumbnailFile(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Bracketed name: the media file and an unrelated look-alike must never be returned.
	write("Song [Live].mp4")
	write("Song e.jpg") // what the glob "Song [Live].*" would have matched
	if got := findThumbnailFile(dir, "Song [Live]"); got != "" {
		t.Fatalf("no thumbnail written, got %q", got)
	}

	write("Song [Live].webp")
	if got, want := findThumbnailFile(dir, "Song [Live]"), filepath.Join(dir, "Song [Live].webp"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	// .jpg is preferred over other image formats.
	write("Song [Live].jpg")
	if got, want := findThumbnailFile(dir, "Song [Live]"), filepath.Join(dir, "Song [Live].jpg"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	// Other metacharacters are literal.
	write("a*b?.png")
	write("axb1.png")
	if got, want := findThumbnailFile(dir, "a*b?"), filepath.Join(dir, "a*b?.png"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
