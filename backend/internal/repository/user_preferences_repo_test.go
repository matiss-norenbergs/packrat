package repository

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
)

func TestUserPreferencesRepo(t *testing.T) {
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
	users, repo := NewUsersRepo(conn), NewUserPreferencesRepo(conn)
	a, _ := users.Create(ctx, "a", "h")
	b, _ := users.Create(ctx, "b", "h")

	got, err := repo.GetAll(ctx, a.ID)
	if err != nil || got["theme"] != "system" || got["accent"] != "default" {
		t.Fatalf("defaults: %v %v", got, err)
	}
	if err := repo.Set(ctx, a.ID, map[string]string{"theme": "dark"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Set(ctx, a.ID, map[string]string{"theme": "light", "accent": "green"}); err != nil {
		t.Fatal(err)
	}
	got, _ = repo.GetAll(ctx, a.ID)
	if got["theme"] != "light" || got["accent"] != "green" {
		t.Fatalf("after upsert: %v", got)
	}
	if got, _ = repo.GetAll(ctx, b.ID); got["theme"] != "system" {
		t.Fatalf("other user leaked: %v", got)
	}
	// ON DELETE CASCADE: foreign keys are on, so deleting the user removes the rows.
	if _, err := conn.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, a.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_preferences`).Scan(&n)
	if n != 0 {
		t.Fatalf("preferences survived user delete: %d", n)
	}
}
