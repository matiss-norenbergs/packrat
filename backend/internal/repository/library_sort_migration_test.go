package repository

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
)

// Migration 000051 removes the retired global Library sort setting and leaves other settings alone.
func TestMigrationDropsLibrarySortSetting(t *testing.T) {
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	for _, kv := range [][2]string{{"library_sort", "title:asc"}, {"library_view", "grid"}} {
		if _, err := conn.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)`, kv[0], kv[1]); err != nil {
			t.Fatal(err)
		}
	}
	up, err := os.ReadFile(filepath.Join(dir, "000051_drop_library_sort_setting.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	var n int
	conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM settings WHERE key = 'library_sort'`).Scan(&n)
	if n != 0 {
		t.Fatalf("library_sort survived the migration")
	}
	conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM settings WHERE key = 'library_view'`).Scan(&n)
	if n != 1 {
		t.Fatalf("other settings must stay, got %d", n)
	}
}
