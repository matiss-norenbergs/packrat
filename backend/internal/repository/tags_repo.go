package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"

	"packrat/backend/internal/models"
)

// ErrTagNameInUse is returned by Create/Rename when another tag already
// uses the requested name (tags.name is UNIQUE). A separate sentinel from
// ErrDuplicateName (collections) since reusing that one's message would be
// misleading here.
var ErrTagNameInUse = errors.New("tag name already in use")

type TagsRepo struct {
	db dbtx

	// rawDB is always the real connection pool, never a WithTx substitution —
	// SetForLibraryItem/SetForLibraryItems open their own subordinate
	// transaction and SQLite doesn't support nesting one inside another, so
	// those two methods must always start from a real *sql.DB.
	rawDB *sql.DB

	// mu serializes every check-then-write name-uniqueness sequence
	// (Create, Rename, GetOrCreateByNames) — same race CollectionsRepo.mu
	// prevents (see its doc comment in collections_repo.go): tag name
	// uniqueness is enforced at the app layer via nameInUse, not purely by
	// the DB constraint, so concurrent requests could otherwise both see a
	// name as free and both create it. A pointer so WithTx copies share the
	// same lock as the original.
	mu *sync.Mutex

	// lockHeld is true only on copies made by WithLockedTx: the creator already
	// holds mu (see LockForRestore), so this copy must not take it again.
	lockHeld bool
}

func NewTagsRepo(db *sql.DB) *TagsRepo {
	return &TagsRepo{db: db, rawDB: db, mu: &sync.Mutex{}}
}

// WithTx returns a copy of r whose queries run against tx instead of the
// underlying connection pool, so its writes commit or roll back together
// with whatever else the caller does on tx. Shares r's mutex, so uniqueness
// locking still applies across both the original and the copy.
func (r *TagsRepo) WithTx(tx *sql.Tx) *TagsRepo {
	cp := *r
	cp.db = tx
	return &cp
}

// WithLockedTx is WithTx for a caller that already holds r's mutex through
// lk (see LockForRestore): the returned copy skips taking the mutex, which is
// not reentrant. It panics if lk does not hold r's mutex, so it can't be
// used to silently bypass the uniqueness lock.
func (r *TagsRepo) WithLockedTx(tx *sql.Tx, lk *RestoreLock) *TagsRepo {
	if !lk.holds(r.mu) {
		panic("repository: TagsRepo.WithLockedTx called without holding its lock")
	}
	cp := *r
	cp.db = tx
	cp.lockHeld = true
	return &cp
}

// lock takes r.mu unless this copy was made by WithLockedTx; use as
// `defer r.lock()()`.
func (r *TagsRepo) lock() func() { return lockOrSkip(r.mu, r.lockHeld) }

// nameInUse checks name uniqueness globally — unlike collections, tags have
// no parent scoping.
func (r *TagsRepo) nameInUse(ctx context.Context, name string, excludeID int64) (bool, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `SELECT id FROM tags WHERE name = ? AND id != ?`, name, excludeID).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking tag name uniqueness: %w", err)
	}
	return true, nil
}

func (r *TagsRepo) Create(ctx context.Context, name string, isPrivate bool) (*models.Tag, error) {
	defer r.lock()()
	return r.createLocked(ctx, name, isPrivate)
}

// createLocked performs the actual check-then-insert; callers must already
// hold r.mu.
func (r *TagsRepo) createLocked(ctx context.Context, name string, isPrivate bool) (*models.Tag, error) {
	inUse, err := r.nameInUse(ctx, name, 0)
	if err != nil {
		return nil, err
	}
	if inUse {
		return nil, ErrTagNameInUse
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO tags (name, is_private) VALUES (?, ?)`, name, isPrivate)
	if err != nil {
		return nil, fmt.Errorf("inserting tag: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *TagsRepo) Get(ctx context.Context, id int64) (*models.Tag, error) {
	var t models.Tag
	var createdAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, name, is_private, created_at FROM tags WHERE id = ?`, id).
		Scan(&t.ID, &t.Name, &t.IsPrivate, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning tag: %w", err)
	}
	t.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// List returns every tag with how many library items currently have it,
// ordered by name — used by the Tags management page.
func (r *TagsRepo) List(ctx context.Context) ([]models.TagWithCount, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.id, t.name, t.is_private, t.created_at, COUNT(lt.library_id) AS usage_count
		FROM tags t
		LEFT JOIN library_tags lt ON lt.tag_id = t.id
		GROUP BY t.id
		ORDER BY t.name`)
	if err != nil {
		return nil, fmt.Errorf("listing tags: %w", err)
	}
	defer rows.Close()

	var out []models.TagWithCount
	for rows.Next() {
		var t models.TagWithCount
		var createdAt string
		if err := rows.Scan(&t.ID, &t.Name, &t.IsPrivate, &createdAt, &t.UsageCount); err != nil {
			return nil, fmt.Errorf("scanning tag: %w", err)
		}
		t.CreatedAt, err = parseSQLiteTime(createdAt)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Update renames a tag and sets its privacy flag in one write — a tag
// marked private blurs every library item it's attached to, the same way a
// private collection blurs everything inside it (see effectivePrivacyMap /
// PrivateTagNames).
func (r *TagsRepo) Update(ctx context.Context, id int64, newName string, isPrivate bool) error {
	defer r.lock()()

	if _, err := r.Get(ctx, id); err != nil {
		return err
	}
	inUse, err := r.nameInUse(ctx, newName, id)
	if err != nil {
		return err
	}
	if inUse {
		return ErrTagNameInUse
	}

	res, err := r.db.ExecContext(ctx, `UPDATE tags SET name = ?, is_private = ? WHERE id = ?`, newName, isPrivate, id)
	if err != nil {
		return fmt.Errorf("updating tag: %w", err)
	}
	return checkRowsAffected(res)
}

// Delete removes a tag; ON DELETE CASCADE on library_tags.tag_id cleans up
// every item's association with it automatically.
func (r *TagsRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting tag: %w", err)
	}
	return checkRowsAffected(res)
}

// GetOrCreateByNames resolves each name to a tag id, creating any tag that
// doesn't already exist, and returns the resolved ids (input order,
// deduplicated by exact match — tags.name has no case-folding).
func (r *TagsRepo) GetOrCreateByNames(ctx context.Context, names []string) ([]int64, error) {
	defer r.lock()()

	seen := make(map[string]bool, len(names))
	ids := make([]int64, 0, len(names))
	for _, raw := range names {
		name := strings.TrimSpace(raw)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true

		var id int64
		err := r.db.QueryRowContext(ctx, `SELECT id FROM tags WHERE name = ?`, name).Scan(&id)
		if err == sql.ErrNoRows {
			tag, err := r.createLocked(ctx, name, false)
			if err != nil {
				return nil, fmt.Errorf("creating tag %q: %w", name, err)
			}
			id = tag.ID
		} else if err != nil {
			return nil, fmt.Errorf("looking up tag %q: %w", name, err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// SetForLibraryItem replaces every tag association for libraryID with
// exactly tagIDs.
func (r *TagsRepo) SetForLibraryItem(ctx context.Context, libraryID int64, tagIDs []int64) error {
	tx, err := r.rawDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning tag update transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM library_tags WHERE library_id = ?`, libraryID); err != nil {
		return fmt.Errorf("clearing existing tags: %w", err)
	}
	for _, tagID := range tagIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO library_tags (library_id, tag_id) VALUES (?, ?)`, libraryID, tagID); err != nil {
			return fmt.Errorf("attaching tag %d: %w", tagID, err)
		}
	}
	return tx.Commit()
}

// SetForLibraryItems replaces every tag association for each id in
// libraryIDs with exactly tagIDs, in a single transaction — the batched
// counterpart to SetForLibraryItem, used by bulk tag assignment so a large
// selection is applied atomically rather than as N separate transactions.
// Ids that no longer exist (e.g. deleted by another action mid-selection)
// are silently skipped rather than failing the whole batch — library_tags
// has an ON DELETE CASCADE FK to library.id, so inserting against a missing
// id would otherwise abort the transaction.
func (r *TagsRepo) SetForLibraryItems(ctx context.Context, libraryIDs []int64, tagIDs []int64) error {
	if len(libraryIDs) == 0 {
		return nil
	}

	tx, err := r.rawDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning bulk tag update transaction: %w", err)
	}
	defer tx.Rollback()

	// Chunked inside the one transaction so atomicity is unchanged.
	var existingIDs []int64
	err = inChunks(libraryIDs, inChunkSize, func(chunk []int64) error {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM library WHERE id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return fmt.Errorf("resolving existing library ids: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return fmt.Errorf("scanning library id: %w", err)
			}
			existingIDs = append(existingIDs, id)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	if len(existingIDs) == 0 {
		return nil
	}

	err = inChunks(existingIDs, inChunkSize, func(chunk []int64) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM library_tags WHERE library_id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...); err != nil {
			return fmt.Errorf("clearing existing tags: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	for _, libraryID := range existingIDs {
		for _, tagID := range tagIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO library_tags (library_id, tag_id) VALUES (?, ?)`, libraryID, tagID); err != nil {
				return fmt.Errorf("attaching tag %d to item %d: %w", tagID, libraryID, err)
			}
		}
	}
	return tx.Commit()
}

// TagsByLibraryIDs batch-fetches tag names for every id, keyed by library
// id — used by list responses so building N responses costs one query, not
// N (mirrors the effectivePrivacyMap lookup-map idiom in the api package).
func (r *TagsRepo) TagsByLibraryIDs(ctx context.Context, ids []int64) (map[int64][]string, error) {
	out := make(map[int64][]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	// Each library id lands in exactly one chunk, so its tags stay in the
	// per-query ORDER BY t.name order.
	err := inChunks(ids, inChunkSize, func(chunk []int64) error {
		rows, err := r.db.QueryContext(ctx, `
			SELECT lt.library_id, t.name
			FROM library_tags lt
			JOIN tags t ON t.id = lt.tag_id
			WHERE lt.library_id IN (`+placeholderList(len(chunk))+`)
			ORDER BY t.name`, anySlice(chunk)...)
		if err != nil {
			return fmt.Errorf("batch-fetching tags: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var libraryID int64
			var name string
			if err := rows.Scan(&libraryID, &name); err != nil {
				return fmt.Errorf("scanning tag: %w", err)
			}
			out[libraryID] = append(out[libraryID], name)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// PrivateTagNames returns the set of tag names currently marked private —
// fetched once per list request and cross-referenced against each item's
// own tag names (already in hand via TagsByLibraryIDs), the same
// fetch-once-then-lookup shape effectivePrivacyMap uses for collections.
func (r *TagsRepo) PrivateTagNames(ctx context.Context) (map[string]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT name FROM tags WHERE is_private = 1`)
	if err != nil {
		return nil, fmt.Errorf("listing private tags: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scanning private tag: %w", err)
		}
		out[name] = true
	}
	return out, rows.Err()
}

// TagsForLibraryItem is a single-item convenience wrapper around
// TagsByLibraryIDs for call sites that already have exactly one id.
func (r *TagsRepo) TagsForLibraryItem(ctx context.Context, id int64) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.name FROM library_tags lt
		JOIN tags t ON t.id = lt.tag_id
		WHERE lt.library_id = ?
		ORDER BY t.name`, id)
	if err != nil {
		return nil, fmt.Errorf("fetching tags for library item: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scanning tag: %w", err)
		}
		out = append(out, name)
	}
	return out, rows.Err()
}
