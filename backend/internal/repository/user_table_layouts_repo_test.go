package repository

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func TestUserTableLayoutsRepo(t *testing.T) {
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
	users, repo := NewUsersRepo(conn), NewUserTableLayoutsRepo(conn)
	a, _ := users.Create(ctx, "a", "h")
	b, _ := users.Create(ctx, "b", "h")

	got, err := repo.GetAll(ctx, a.ID)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("empty: %v %v", got, err)
	}
	if err := repo.Set(ctx, a.ID, "artists", `{"v":1}`); err != nil {
		t.Fatal(err)
	}
	if err := repo.Set(ctx, a.ID, "artists", `{"v":1,"hidden":["usage"]}`); err != nil {
		t.Fatal(err)
	}
	if err := repo.Set(ctx, a.ID, "tags", `{"v":1}`); err != nil {
		t.Fatal(err)
	}
	got, _ = repo.GetAll(ctx, a.ID)
	if len(got) != 2 || got["artists"] != `{"v":1,"hidden":["usage"]}` {
		t.Fatalf("after upsert: %v", got)
	}
	if got, _ = repo.GetAll(ctx, b.ID); len(got) != 0 {
		t.Fatalf("other user leaked: %v", got)
	}

	if err := repo.Delete(ctx, a.ID, "tags"); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, a.ID, "tags"); err != nil { // idempotent
		t.Fatal(err)
	}
	if got, _ = repo.GetAll(ctx, a.ID); len(got) != 1 {
		t.Fatalf("after delete: %v", got)
	}

	// ON DELETE CASCADE: foreign keys are on, so deleting the user removes the rows.
	if _, err := conn.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, a.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_table_layouts`).Scan(&n)
	if n != 0 {
		t.Fatalf("layouts survived user delete: %d", n)
	}
}

func TestUserTableLayoutsRepoCap(t *testing.T) {
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
	users, repo := NewUsersRepo(conn), NewUserTableLayoutsRepo(conn)
	a, _ := users.Create(ctx, "a", "h")
	b, _ := users.Create(ctx, "b", "h")

	for i := 0; i < models.MaxTableLayoutsPerUser; i++ {
		if err := repo.Set(ctx, a.ID, fmt.Sprintf("t%d", i), `{"v":1}`); err != nil {
			t.Fatalf("layout %d: %v", i, err)
		}
	}
	if err := repo.Set(ctx, a.ID, "one-more", `{"v":1}`); !errors.Is(err, ErrTooManyTableLayouts) {
		t.Fatalf("over the cap: %v", err)
	}
	// Updating an existing one is always allowed, and the cap is per account.
	if err := repo.Set(ctx, a.ID, "t0", `{"v":1,"hidden":["x"]}`); err != nil {
		t.Fatalf("update at the cap: %v", err)
	}
	if err := repo.Set(ctx, b.ID, "one-more", `{"v":1}`); err != nil {
		t.Fatalf("other account: %v", err)
	}
	// Freeing a slot lets a new table in again.
	if err := repo.Delete(ctx, a.ID, "t1"); err != nil {
		t.Fatal(err)
	}
	if err := repo.Set(ctx, a.ID, "one-more", `{"v":1}`); err != nil {
		t.Fatalf("after freeing a slot: %v", err)
	}
}
