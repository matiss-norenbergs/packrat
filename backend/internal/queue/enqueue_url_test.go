package queue

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

func TestEnqueueRejectsNonHTTPURL(t *testing.T) {
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	downloads := repository.NewDownloadsRepo(conn)
	mgr := NewDownloadManager("", "", "", nil, downloads, nil, nil, nil, nil, nil, nil, nil, nil, nil, NewProgressStore(), ws.NoopBroadcaster{})

	for _, u := range []string{"-example", "file:///etc/hosts", "", "ftp://example.test/x", "https://"} {
		_, err := mgr.Enqueue(context.Background(), models.Download{URL: u, DownloadType: "video", Quality: "best"})
		if !errors.Is(err, ErrInvalidURL) {
			t.Errorf("Enqueue(%q) err = %v, want ErrInvalidURL", u, err)
		}
	}
	rows, err := downloads.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected no download rows, got %d", len(rows))
	}
}
