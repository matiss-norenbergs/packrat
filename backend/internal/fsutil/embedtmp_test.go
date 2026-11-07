package fsutil

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIsEmbedTmpName(t *testing.T) {
	yes := []string{".packrat-embed-123456.mp4", ".packrat-embed-1.mkv", "Movie.packrat-tmp.mp4", "a b.packrat-tmp.webm"}
	no := []string{"Movie.mp4", ".packrat-embed-.mp4", ".packrat-embed-12ab.mp4", ".packrat-embed-123", ".packrat-tmp", ".packrat-tmp.mp4", "x.packrat-tmpfoo.mp4", "x.packrat-embed-1.mp4"}
	for _, n := range yes {
		if !IsEmbedTmpName(n) {
			t.Errorf("IsEmbedTmpName(%q) = false, want true", n)
		}
	}
	for _, n := range no {
		if IsEmbedTmpName(n) {
			t.Errorf("IsEmbedTmpName(%q) = true, want false", n)
		}
	}
}

func TestCleanStaleEmbedTemps(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "show")
	os.MkdirAll(sub, 0o755)
	old := time.Now().Add(-time.Hour)
	mk := func(p string, age time.Time) string {
		os.WriteFile(p, []byte("x"), 0o644)
		os.Chtimes(p, age, age)
		return p
	}
	staleNew := mk(filepath.Join(sub, ".packrat-embed-42.mp4"), old)
	staleLegacy := mk(filepath.Join(root, "A.packrat-tmp.mp4"), old)
	fresh := mk(filepath.Join(root, ".packrat-embed-7.mp4"), time.Now())
	real := mk(filepath.Join(root, "A.mp4"), old)
	// A directory that happens to match the file pattern must survive.
	dir := filepath.Join(root, ".packrat-embed-9.mp4")
	os.MkdirAll(dir, 0o755)

	if n := CleanStaleEmbedTemps(root, 5*time.Minute); n != 2 {
		t.Fatalf("removed %d, want 2", n)
	}
	for _, p := range []string{staleNew, staleLegacy} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s should be gone", p)
		}
	}
	for _, p := range []string{fresh, real, dir} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should remain: %v", p, err)
		}
	}
}
