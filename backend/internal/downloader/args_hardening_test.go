package downloader

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

func TestBuildArgsEndsOptionsBeforeURL(t *testing.T) {
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	s := &YtDlpService{SettingsRepo: repository.NewSettingsRepo(conn)}
	for _, u := range []string{"https://example.test/v", "-example"} {
		args := s.BuildArgs(context.Background(), DownloadJob{URL: u, DestDir: t.TempDir(), DownloadType: "video", Quality: "best"})
		n := len(args)
		if n < 2 || args[n-1] != u || args[n-2] != "--" {
			t.Fatalf("want ... -- %q at the end, got %v", u, args[max(0, n-3):])
		}
	}
}
