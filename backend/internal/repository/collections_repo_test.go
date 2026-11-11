package repository

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"

	"packrat/backend/internal/models"
)

func TestCollectionsRepo_CRUD(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewCollectionsRepo(downloadsRepo.db)

	id, err := repo.Create(ctx, &models.Collection{
		Name: "Music", RootPath: "Music", DefaultQuality: "best", DefaultDownloadType: "audio",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == 0 {
		t.Fatalf("expected nonzero id")
	}

	got, err := repo.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != "Music" || got.RootPath != "Music" || got.DefaultDownloadType != "audio" {
		t.Fatalf("unexpected row: %+v", got)
	}

	if _, err := repo.Get(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 row, got %d", len(list))
	}

	if _, err := repo.Create(ctx, &models.Collection{Name: "Music", RootPath: "Music2", DefaultQuality: "best", DefaultDownloadType: "video"}); !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("expected ErrDuplicateName, got %v", err)
	}

	id2, err := repo.Create(ctx, &models.Collection{Name: "Videos", RootPath: "Videos", DefaultQuality: "1080p", DefaultDownloadType: "video"})
	if err != nil {
		t.Fatalf("Create second: %v", err)
	}

	if err := repo.Update(ctx, id2, &models.Collection{Name: "Music", RootPath: "Videos", DefaultQuality: "1080p", DefaultDownloadType: "video"}); !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("expected ErrDuplicateName on rename collision, got %v", err)
	}

	if err := repo.Update(ctx, id2, &models.Collection{Name: "Videos", RootPath: "Videos2", DefaultQuality: "720p", DefaultDownloadType: "video"}); err != nil {
		t.Fatalf("Update with unchanged name: %v", err)
	}
	updated, err := repo.Get(ctx, id2)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if updated.RootPath != "Videos2" || updated.DefaultQuality != "720p" {
		t.Fatalf("update did not persist: %+v", updated)
	}

	if err := repo.Update(ctx, 99999, &models.Collection{Name: "X", RootPath: "X", DefaultQuality: "best", DefaultDownloadType: "video"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound updating unknown id, got %v", err)
	}

	if err := repo.Delete(ctx, id); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Get(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	if err := repo.Delete(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound deleting unknown id, got %v", err)
	}
}

// racingDB runs the real query and then, once, calls hook: it lets a test put
// a child collection in place between Delete's child count and its DELETE.
type racingDB struct {
	dbtx
	hook func()
}

func (r *racingDB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	row := r.dbtx.QueryRowContext(ctx, query, args...)
	if r.hook != nil {
		h := r.hook
		r.hook = nil
		h()
	}
	return row
}

// A child that appears after the count but before the DELETE is refused by the
// parent_id foreign key; Delete must answer ErrHasChildren (409), not an
// opaque error (500).
func TestCollectionsRepo_DeleteChildAppearsAfterCount(t *testing.T) {
	ctx := context.Background()
	conn := openTestDB(t).db
	repo := NewCollectionsRepo(conn)
	parent, err := repo.Create(ctx, &models.Collection{Name: "Parent", RootPath: "Parent", DefaultQuality: "best", DefaultDownloadType: "video"})
	if err != nil {
		t.Fatal(err)
	}

	racing := &CollectionsRepo{db: &racingDB{dbtx: conn, hook: func() {
		_, err := conn.ExecContext(ctx, `INSERT INTO collections (name, root_path, parent_id, default_quality, default_download_type) VALUES ('Child', 'Child', ?, 'best', 'video')`, parent)
		if err != nil {
			t.Errorf("inserting the racing child: %v", err)
		}
	}}, mu: &sync.Mutex{}}
	err = racing.Delete(ctx, parent)
	if !errors.Is(err, ErrHasChildren) {
		t.Fatalf("Delete = %v, want ErrHasChildren", err)
	}
	if _, err := repo.Get(ctx, parent); err != nil {
		t.Errorf("the parent must still exist: %v", err)
	}
}
