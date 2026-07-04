package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path"

	"packrat/backend/internal/models"
)

// ErrDuplicateName is returned by Create/Update when another collection
// already uses the requested name (collections.name is UNIQUE).
var ErrDuplicateName = errors.New("collection name already in use")

// ErrHasChildren is returned by Delete when the collection still has child
// collections nested under it — callers must move or delete those first.
var ErrHasChildren = errors.New("collection has child collections")

type CollectionsRepo struct {
	db *sql.DB
}

func NewCollectionsRepo(db *sql.DB) *CollectionsRepo {
	return &CollectionsRepo{db: db}
}

// nameInUse checks name uniqueness scoped to parentID (nil meaning a
// root-level collection) — collections at different branches of the tree
// may share a name, only siblings under the same parent may not.
func (r *CollectionsRepo) nameInUse(ctx context.Context, name string, parentID *int64, excludeID int64) (bool, error) {
	var id int64
	var err error
	if parentID == nil {
		err = r.db.QueryRowContext(ctx,
			`SELECT id FROM collections WHERE name = ? AND parent_id IS NULL AND id != ?`,
			name, excludeID).Scan(&id)
	} else {
		err = r.db.QueryRowContext(ctx,
			`SELECT id FROM collections WHERE name = ? AND parent_id = ? AND id != ?`,
			name, *parentID, excludeID).Scan(&id)
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking collection name uniqueness: %w", err)
	}
	return true, nil
}

func (r *CollectionsRepo) Create(ctx context.Context, c *models.Collection) (int64, error) {
	if c.ParentID != nil {
		if _, err := r.Get(ctx, *c.ParentID); err != nil {
			return 0, err
		}
	}
	inUse, err := r.nameInUse(ctx, c.Name, c.ParentID, 0)
	if err != nil {
		return 0, err
	}
	if inUse {
		return 0, ErrDuplicateName
	}

	res, err := r.db.ExecContext(ctx, `
		INSERT INTO collections (name, parent_id, root_path, default_quality, default_download_type, is_private)
		VALUES (?, ?, ?, ?, ?, ?)`,
		c.Name, c.ParentID, c.RootPath, c.DefaultQuality, c.DefaultDownloadType, c.IsPrivate,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting collection: %w", err)
	}
	return res.LastInsertId()
}

func (r *CollectionsRepo) Get(ctx context.Context, id int64) (*models.Collection, error) {
	row := r.db.QueryRowContext(ctx, collectionSelectColumns+` WHERE id = ?`, id)
	c, err := scanCollection(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return c, err
}

func (r *CollectionsRepo) List(ctx context.Context) ([]models.Collection, error) {
	rows, err := r.db.QueryContext(ctx, collectionSelectColumns+` ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("listing collections: %w", err)
	}
	defer rows.Close()

	var out []models.Collection
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// Update overwrites name/root_path/default_quality/default_download_type/
// is_private for id. Callers apply partial-update semantics before calling
// this (fetch, merge, write) — this method always writes all five columns.
func (r *CollectionsRepo) Update(ctx context.Context, id int64, c *models.Collection) error {
	existing, err := r.Get(ctx, id)
	if err != nil {
		return err
	}

	inUse, err := r.nameInUse(ctx, c.Name, existing.ParentID, id)
	if err != nil {
		return err
	}
	if inUse {
		return ErrDuplicateName
	}

	res, err := r.db.ExecContext(ctx, `
		UPDATE collections
		SET name = ?, root_path = ?, default_quality = ?, default_download_type = ?, is_private = ?, updated_at = datetime('now')
		WHERE id = ?`,
		c.Name, c.RootPath, c.DefaultQuality, c.DefaultDownloadType, c.IsPrivate, id,
	)
	if err != nil {
		return fmt.Errorf("updating collection: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CollectionsRepo) Delete(ctx context.Context, id int64) error {
	var childCount int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM collections WHERE parent_id = ?`, id).Scan(&childCount); err != nil {
		return fmt.Errorf("checking collection children: %w", err)
	}
	if childCount > 0 {
		return ErrHasChildren
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM collections WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting collection: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ResolvePath returns the collection's full path from the root of the tree
// down to itself, e.g. "Shows/Anime", by walking the parent_id chain and
// joining each ancestor's own root_path segment.
func (r *CollectionsRepo) ResolvePath(ctx context.Context, id int64) (string, error) {
	var segments []string
	currentID := &id
	for currentID != nil {
		c, err := r.Get(ctx, *currentID)
		if err != nil {
			return "", err
		}
		segments = append([]string{c.RootPath}, segments...)
		currentID = c.ParentID
	}
	return path.Join(segments...), nil
}

// IsPrivate reports whether the collection identified by id, or any of its
// ancestors, is marked private — privacy inherits down the tree, so marking
// a top-level collection private covers every collection nested under it
// too. Used for single-item responses where fetching the whole collections
// list (see effectivePrivacyMap in the api package) would be overkill.
func (r *CollectionsRepo) IsPrivate(ctx context.Context, id int64) (bool, error) {
	currentID := &id
	for currentID != nil {
		c, err := r.Get(ctx, *currentID)
		if err != nil {
			return false, err
		}
		if c.IsPrivate {
			return true, nil
		}
		currentID = c.ParentID
	}
	return false, nil
}

// FindChildByRootPath returns the collection among cols whose parent is
// parentID and whose own root_path segment matches segment, or nil if none
// exists. Used to walk a scanned file's on-disk folder chain against an
// already-fetched List() result, so only the segments that don't already
// have a matching collection need to be created.
func FindChildByRootPath(cols []models.Collection, parentID *int64, segment string) *models.Collection {
	for i := range cols {
		c := &cols[i]
		if c.RootPath != segment {
			continue
		}
		if (c.ParentID == nil) != (parentID == nil) {
			continue
		}
		if c.ParentID != nil && parentID != nil && *c.ParentID != *parentID {
			continue
		}
		return c
	}
	return nil
}

const collectionSelectColumns = `
	SELECT id, name, parent_id, root_path, default_quality, default_download_type, filename_template,
	       jellyfin_library, is_private, created_at, updated_at
	FROM collections`

func scanCollection(row rowScanner) (*models.Collection, error) {
	var c models.Collection
	var createdAt, updatedAt string

	err := row.Scan(
		&c.ID, &c.Name, &c.ParentID, &c.RootPath, &c.DefaultQuality, &c.DefaultDownloadType, &c.FilenameTemplate,
		&c.JellyfinLibrary, &c.IsPrivate, &createdAt, &updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning collection: %w", err)
	}

	c.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	c.UpdatedAt, err = parseSQLiteTime(updatedAt)
	if err != nil {
		return nil, err
	}

	return &c, nil
}
