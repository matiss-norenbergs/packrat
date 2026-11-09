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

func TestIsThumbTmpName(t *testing.T) {
	yes := []string{".packrat-thumb-123456.jpg", ".packrat-thumb-1.png", ".packrat-thumb-ab12Cd.webp"}
	no := []string{"Video.jpg", ".packrat-thumb-.jpg", ".packrat-thumb-12-3.jpg", ".packrat-thumb-123", "x.packrat-thumb-1.jpg", "packrat-thumb-1.jpg", ".packrat-thumb-1/2.jpg"}
	for _, n := range yes {
		if !IsThumbTmpName(n) || !IsInternalTmpName(n) {
			t.Errorf("%q should be a thumb temp name", n)
		}
	}
	for _, n := range no {
		if IsThumbTmpName(n) {
			t.Errorf("IsThumbTmpName(%q) = true, want false", n)
		}
	}
	if IsThumbTmpName(".packrat-embed-1.mp4") || !IsInternalTmpName(".packrat-embed-1.mp4") {
		t.Error("embed names are internal temp names but not thumb temp names")
	}
}

// A crash between creating the sidecar copy and renaming it leaves a .packrat-thumb-* file.
func TestCleanStaleEmbedTempsRemovesAbandonedThumbTemps(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "show")
	os.MkdirAll(sub, 0o755)
	old := time.Now().Add(-time.Hour)
	mk := func(p string, age time.Time) string {
		os.WriteFile(p, []byte("x"), 0o644)
		os.Chtimes(p, age, age)
		return p
	}
	stale := mk(filepath.Join(sub, ".packrat-thumb-4242.jpg"), old)
	fresh := mk(filepath.Join(sub, ".packrat-thumb-7.jpg"), time.Now())
	sidecar := mk(filepath.Join(sub, "Video.jpg"), old)
	lookalike := mk(filepath.Join(sub, "my.packrat-thumb-1.jpg"), old)
	dir := filepath.Join(root, ".packrat-thumb-9.png")
	os.MkdirAll(dir, 0o755)

	if n := CleanStaleEmbedTemps(root, 5*time.Minute); n != 1 {
		t.Fatalf("removed %d, want 1", n)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("stale thumb temp should be gone")
	}
	for _, p := range []string{fresh, sidecar, lookalike, dir} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should remain: %v", p, err)
		}
	}
}
