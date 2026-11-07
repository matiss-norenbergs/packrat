package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanSkipsEmbedTempFiles(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "Show")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		filepath.Join(sub, "Ep1.mp4"),
		filepath.Join(sub, ".packrat-embed-123456.mp4"), // current temp name
		filepath.Join(sub, "Ep1.packrat-tmp.mp4"),       // legacy temp name
		filepath.Join(root, ".packrat-embed-9.mkv"),
	} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := Scan(root, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].RelPath != "Show/Ep1.mp4" {
		t.Fatalf("scan = %+v, want only Show/Ep1.mp4", got)
	}
}
