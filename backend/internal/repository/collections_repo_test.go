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

func mkCol(t *testing.T, repo *CollectionsRepo, name, root string, parent *int64) int64 {
	t.Helper()
	id, err := repo.Create(context.Background(), &models.Collection{
		Name: name, RootPath: root, ParentID: parent, DefaultQuality: "best", DefaultDownloadType: "video",
	})
	if err != nil {
		t.Fatalf("Create %q: %v", name, err)
	}
	return id
}

func TestCollectionsRepo_CreateRefusesSiblingFolder(t *testing.T) {
	ctx := context.Background()
	repo := NewCollectionsRepo(openTestDB(t).db)
	a := mkCol(t, repo, "A", "Concerts", nil)
	other := mkCol(t, repo, "B", "Other", nil)

	for _, root := range []string{"Concerts", "concerts", "CONCERTS"} {
		_, err := repo.Create(ctx, &models.Collection{Name: "N-" + root, RootPath: root, DefaultQuality: "best", DefaultDownloadType: "video"})
		if !errors.Is(err, ErrDuplicateRootPath) {
			t.Fatalf("top-level %q: expected ErrDuplicateRootPath, got %v", root, err)
		}
	}
	// Different folder name: fine. Same folder name under a different parent: fine,
	// and top-level siblings are not compared with children of other parents.
	mkCol(t, repo, "C", "Fresh", nil)
	mkCol(t, repo, "child", "Concerts", &other)
	mkCol(t, repo, "child2", "Concerts", &a)
	// Under a parent, siblings are checked against each other.
	_, err := repo.Create(ctx, &models.Collection{Name: "dup", RootPath: "concerts", ParentID: &a, DefaultQuality: "best", DefaultDownloadType: "video"})
	if !errors.Is(err, ErrDuplicateRootPath) {
		t.Fatalf("child: expected ErrDuplicateRootPath, got %v", err)
	}
	// A name clash is still reported as a name clash.
	_, err = repo.Create(ctx, &models.Collection{Name: "A", RootPath: "Concerts", DefaultQuality: "best", DefaultDownloadType: "video"})
	if !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("expected ErrDuplicateName, got %v", err)
	}
}

func TestCollectionsRepo_UpdateFolderRules(t *testing.T) {
	ctx := context.Background()
	conn := openTestDB(t).db
	repo := NewCollectionsRepo(conn)
	a := mkCol(t, repo, "A", "Alpha", nil)
	b := mkCol(t, repo, "B", "Beta", nil)
	upd := func(id int64, name, root string, private bool) error {
		return repo.Update(ctx, id, &models.Collection{Name: name, RootPath: root, IsPrivate: private, DefaultQuality: "best", DefaultDownloadType: "video"})
	}

	if err := upd(b, "B", "alpha", false); !errors.Is(err, ErrDuplicateRootPath) {
		t.Fatalf("expected ErrDuplicateRootPath, got %v", err)
	}
	if err := upd(b, "B", "Beta", true); err != nil { // re-submit own folder
		t.Fatalf("re-submit: %v", err)
	}
	if err := upd(b, "B", "BETA", true); err != nil { // case-only change of itself
		t.Fatalf("case-only: %v", err)
	}
	if err := upd(b, "B", "Gamma", true); err != nil {
		t.Fatalf("different folder: %v", err)
	}

	// Pre-existing pair, inserted directly: unrelated edits keep working.
	if _, err := conn.ExecContext(ctx, `UPDATE collections SET root_path = 'Alpha' WHERE id = ?`, b); err != nil {
		t.Fatal(err)
	}
	if err := upd(b, "B renamed", "Alpha", true); err != nil {
		t.Fatalf("unrelated edit of pre-existing pair: %v", err)
	}
	if err := upd(a, "A", "Alpha", true); err != nil {
		t.Fatalf("unrelated edit of other half of pair: %v", err)
	}
	// ...but moving to a sibling's folder is still refused.
	c := mkCol(t, repo, "C", "Cee", nil)
	if err := upd(c, "C", "alpha", false); !errors.Is(err, ErrDuplicateRootPath) {
		t.Fatalf("expected ErrDuplicateRootPath, got %v", err)
	}
}

func TestCollectionsRepo_EnsureChainReusesCaseVariant(t *testing.T) {
	ctx := context.Background()
	repo := NewCollectionsRepo(openTestDB(t).db)
	top := mkCol(t, repo, "Display Name", "Concerts", nil)
	sub := mkCol(t, repo, "Live", "Live", &top)

	for i := 0; i < 2; i++ { // exact chain, twice
		got, err := repo.EnsureChain(ctx, []string{"Concerts", "Live"})
		if err != nil || got == nil || *got != sub {
			t.Fatalf("exact chain: id=%v err=%v", got, err)
		}
	}
	got, err := repo.EnsureChain(ctx, []string{"concerts", "LIVE"})
	if err != nil || got == nil || *got != sub {
		t.Fatalf("case-variant chain: id=%v err=%v", got, err)
	}
	if list, _ := repo.List(ctx); len(list) != 2 {
		t.Fatalf("expected no new collections, got %d", len(list))
	}
	// A genuinely new segment is still created under the matched parent.
	got, err = repo.EnsureChain(ctx, []string{"CONCERTS", "New"})
	if err != nil || got == nil || *got == sub {
		t.Fatalf("new child: id=%v err=%v", got, err)
	}
}

func TestFindChildByRootPath_PrefersExactMatch(t *testing.T) {
	cols := []models.Collection{{ID: 1, RootPath: "concerts"}, {ID: 2, RootPath: "Concerts"}}
	if c := FindChildByRootPath(cols, nil, "Concerts"); c == nil || c.ID != 2 {
		t.Fatalf("expected exact match id 2, got %+v", c)
	}
	if c := FindChildByRootPath(cols, nil, "CONCERTS"); c == nil || c.ID != 1 {
		t.Fatalf("expected first case-variant id 1, got %+v", c)
	}
}
